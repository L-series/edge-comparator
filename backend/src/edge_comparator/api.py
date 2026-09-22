"""Local ONNX preflight and consented OpenVINO CPU compilation evidence."""

import asyncio
import hashlib
import logging
import platform
import sys
import tempfile
import threading
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID, uuid4

from fastapi import FastAPI, HTTPException, Request, Response, status
from pydantic import TypeAdapter, ValidationError
from starlette.middleware.base import RequestResponseEndpoint

from edge_comparator.compilation_models import (
    ArtifactName,
    CompilationRun,
    CompilerConfiguration,
    CompilerObservation,
    RunSummary,
    evaluation_key,
)
from edge_comparator.demos import make_demo
from edge_comparator.evidence_store import (
    ARTIFACT_MEDIA_TYPES,
    RunNotFound,
    RunStore,
    StoreCapacityError,
    StoreError,
)
from edge_comparator.models import (
    MAX_METADATA_BYTES,
    MAX_UPLOAD_BYTES,
    HealthResponse,
    InspectResponse,
    InspectTargetResult,
    ModelMetadata,
    TargetCatalogEntry,
    WorkerRejection,
    WorkerResult,
)

app = FastAPI(
    title="Edge-AI Hardware Comparator Backend",
    description="Local ONNX preflight and compiler evidence; no inference or acceleration claims",
    version="0.1.0",
)

PARSER_TIMEOUT_SECONDS = 10.0
COMPILER_TIMEOUT_SECONDS = 60.0
COMPILER_COMMAND = (sys.executable, "-m", "edge_comparator.compiler_worker")
UPLOAD_TIMEOUT_SECONDS = 10.0
# ponytail: one upload/parser per API process; shared services need isolated job scheduling.
_parse_lock = asyncio.Lock()
_store_lock = threading.Lock()
logger = logging.getLogger(__name__)
_worker_result: TypeAdapter[WorkerResult] = TypeAdapter(WorkerResult)

SRC_DIR = str(Path(__file__).resolve().parent.parent)


@app.middleware("http")
async def private_responses(request: Request, call_next: RequestResponseEndpoint) -> Response:
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


TARGET_CATALOG: list[TargetCatalogEntry] = [
    TargetCatalogEntry(
        id="nvidia-jetson-orin-nano",
        name="NVIDIA Jetson Orin Nano Developer Kit",
        vendor="NVIDIA",
        accelerator="NVIDIA Ampere GPU",
        source_url="https://docs.nvidia.com/jetson/orin-nano-devkit/user-guide/latest/index.html",
        configuration_status="catalog_only",
    ),
    TargetCatalogEntry(
        id="intel-openvino-cpu",
        name="Local CPU via OpenVINO",
        vendor="Local host (OpenVINO by Intel)",
        accelerator="CPU only; actual processor recorded per run",
        source_url=(
            "https://docs.openvino.ai/2026/openvino-workflow/"
            "running-inference/inference-devices-and-modes/cpu-device.html"
        ),
        configuration_status="catalog_only",
    ),
    TargetCatalogEntry(
        id="nxp-imx93-ethos-u65",
        name="NXP i.MX 93 Applications Processor",
        vendor="NXP",
        accelerator="Arm Ethos-U65 microNPU",
        source_url="https://www.nxp.com/products/i.MX93",
        configuration_status="catalog_only",
    ),
]


class WorkerFailure(RuntimeError):
    """Worker infrastructure failed; this is not a model compatibility result."""


async def _read_bounded(stream: asyncio.StreamReader, limit: int) -> bytes:
    data = bytearray()
    while chunk := await stream.read(min(65_536, limit + 1 - len(data))):
        data.extend(chunk)
        if len(data) > limit:
            raise WorkerFailure("Worker exceeded its output limit")
    return bytes(data)


async def _send_input(stream: asyncio.StreamWriter, data: bytes) -> None:
    try:
        stream.write(data)
        await stream.drain()
    finally:
        stream.close()


async def _communicate(proc: asyncio.subprocess.Process, data: bytes) -> bytes:
    async with asyncio.timeout(PARSER_TIMEOUT_SECONDS):
        stdout, _stderr = await _capture_output(proc, data)
    return stdout


async def _capture_output(proc: asyncio.subprocess.Process, data: bytes) -> tuple[bytes, bytes]:
    tasks: list[asyncio.Task[bytes] | asyncio.Task[None]] = []
    try:
        if proc.stdin is None or proc.stdout is None or proc.stderr is None:
            raise WorkerFailure("Worker pipes are unavailable")
        stdout = asyncio.create_task(_read_bounded(proc.stdout, MAX_METADATA_BYTES))
        stderr = asyncio.create_task(_read_bounded(proc.stderr, 65_536))
        tasks = [
            stdout,
            stderr,
            asyncio.create_task(_send_input(proc.stdin, data)),
        ]
        await asyncio.gather(*tasks)
        await proc.wait()
        return stdout.result(), stderr.result()
    finally:
        if proc.returncode is None:
            try:
                proc.kill()
            except ProcessLookupError:
                logger.info("Worker exited during cancellation cleanup")
        for task in tasks:
            task.cancel()
        # Collect cancelled pipe readers before draining/reaping the terminated process.
        await asyncio.gather(*tasks, return_exceptions=True)
        await proc.communicate()


async def _run_parser_subprocess(raw_bytes: bytes) -> ModelMetadata:
    child_env = {
        "PYTHONPATH": SRC_DIR,
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONUNBUFFERED": "1",
        "OPENBLAS_NUM_THREADS": "1",
        "OMP_NUM_THREADS": "1",
        "MKL_NUM_THREADS": "1",
        "NUMEXPR_NUM_THREADS": "1",
    }

    with tempfile.TemporaryDirectory(prefix="edge-comparator-") as directory:
        proc = await asyncio.create_subprocess_exec(
            sys.executable,
            "-m",
            "edge_comparator.parser_worker",
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=directory,
            env=child_env,
        )
        try:
            stdout = await _communicate(proc, raw_bytes)
        except TimeoutError as exc:
            raise WorkerFailure("Parser worker timed out") from exc
    if proc.returncode != 0:
        raise WorkerFailure(f"Parser worker exited with code {proc.returncode}")
    try:
        result = _worker_result.validate_json(stdout, strict=True)
    except ValidationError as exc:
        raise WorkerFailure("Parser worker returned invalid metadata") from exc
    if isinstance(result, WorkerRejection):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=result.error,
        )
    if result.data.sha256 != hashlib.sha256(raw_bytes).hexdigest():
        raise WorkerFailure("Parser worker metadata does not match the uploaded artifact")
    return result.data


@app.get("/api/health", response_model=HealthResponse)
async def get_health() -> HealthResponse:
    """Return health status."""
    return HealthResponse(status="ok")


@app.get("/api/targets", response_model=list[TargetCatalogEntry])
async def get_targets() -> list[TargetCatalogEntry]:
    """Return catalog-only targets, without implying evaluated support."""
    return TARGET_CATALOG


def _check_admission(request: Request) -> None:
    content_type = request.headers.get("content-type", "")
    media_type = content_type.split(";")[0].strip().lower()
    if media_type != "application/octet-stream":
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Content-Type must be application/octet-stream",
        )

    if _parse_lock.locked():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Parser is busy with another request; "
                "concurrent parsing is disabled in preview prototype"
            ),
        )


async def _read_upload(request: Request) -> bytes:
    content_length = request.headers.get("content-length")
    if content_length is not None:
        if not content_length.isascii() or not content_length.isdecimal():
            raise HTTPException(status_code=400, detail="Invalid Content-Length header")
        normalized_length = content_length.lstrip("0") or "0"
        if (
            len(normalized_length) > len(str(MAX_UPLOAD_BYTES))
            or int(normalized_length) > MAX_UPLOAD_BYTES
        ):
            raise HTTPException(status_code=413, detail="Uploaded model exceeds the 16 MiB limit")
    raw_bytes = bytearray()
    try:
        async with asyncio.timeout(UPLOAD_TIMEOUT_SECONDS):
            async for chunk in request.stream():
                if len(raw_bytes) + len(chunk) > MAX_UPLOAD_BYTES:
                    raise HTTPException(
                        status_code=413, detail="Uploaded model exceeds the 16 MiB limit"
                    )
                raw_bytes.extend(chunk)
    except TimeoutError as exc:
        raise HTTPException(status_code=408, detail="Model upload timed out") from exc
    if not raw_bytes:
        raise HTTPException(status_code=422, detail="Uploaded model is empty (0 bytes)")
    return bytes(raw_bytes)


async def _preflight(raw_bytes: bytes) -> ModelMetadata:
    try:
        return await _run_parser_subprocess(raw_bytes)
    except (WorkerFailure, OSError) as exc:
        detail = str(exc) if isinstance(exc, WorkerFailure) else "Parser worker process failed"
        logger.warning("Model inspector unavailable: %s", detail)
        raise HTTPException(status_code=503, detail=detail) from exc


@app.post("/api/inspect", response_model=InspectResponse)
async def inspect_model(request: Request) -> InspectResponse:
    """Inspect raw ONNX without retaining it or invoking a compiler."""
    _check_admission(request)
    async with _parse_lock:
        model_meta = await _preflight(await _read_upload(request))
    base_reason = (
        "Preflight inspection only; no exact compiler/runtime configuration "
        "executed on target hardware or SDK toolchain."
    )
    vela_reason = (
        "Preflight inspection only; no exact compiler/runtime configuration executed. "
        "Vela compilation requires an explicit separate quantized TFLite conversion variant; "
        "ONNX intake alone does not provide Vela support."
    )

    results = [
        InspectTargetResult(
            target_id="nvidia-jetson-orin-nano",
            status="not_tested",
            reason=base_reason,
        ),
        InspectTargetResult(
            target_id="intel-openvino-cpu",
            status="not_tested",
            reason=base_reason,
        ),
        InspectTargetResult(
            target_id="nxp-imx93-ethos-u65",
            status="not_tested",
            reason=vela_reason,
        ),
    ]

    return InspectResponse(
        evidence_type="static_inferred",
        stage="preflight",
        model=model_meta,
        results=results,
    )


async def _store_call[T](operation: Callable[[RunStore], T]) -> T:
    def work() -> T:
        # The thread owns serialization even if its HTTP waiter is cancelled.
        with _store_lock:
            try:
                return operation(RunStore())
            except RunNotFound as exc:
                raise HTTPException(status_code=404, detail=str(exc)) from exc
            except StoreCapacityError as exc:
                raise HTTPException(status_code=507, detail=str(exc)) from exc
            except (StoreError, OSError) as exc:
                logger.warning("Local evidence store unavailable: %s", type(exc).__name__)
                detail = (
                    str(exc) if isinstance(exc, StoreError) else "Local evidence storage failed"
                )
                raise HTTPException(status_code=503, detail=detail) from exc

    return await asyncio.to_thread(work)


async def _run_compiler(raw_bytes: bytes) -> tuple[CompilerObservation, bytes, bytes]:
    observed = CompilerObservation(
        status="inconclusive",
        stage="worker",
        model_sha256=hashlib.sha256(raw_bytes).hexdigest(),
    )
    stdout = stderr = b""
    try:
        with tempfile.TemporaryDirectory(prefix="edge-compiler-") as directory:
            home = Path(directory)
            model_path = home / "model.onnx"
            model_path.write_bytes(raw_bytes)
            model_path.chmod(0o600)
            (home / "intel").mkdir(mode=0o700)
            opt_out = home / "intel" / "openvino_telemetry"
            opt_out.write_text("0", encoding="utf-8")
            opt_out.chmod(0o600)
            proc = await asyncio.create_subprocess_exec(
                *COMPILER_COMMAND,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=directory,
                env={
                    "PYTHONPATH": SRC_DIR,
                    "PYTHONDONTWRITEBYTECODE": "1",
                    "PYTHONUNBUFFERED": "1",
                    "HOME": directory,
                    "CI": "true",
                    "OPENBLAS_NUM_THREADS": "1",
                    "OMP_NUM_THREADS": "1",
                    "MKL_NUM_THREADS": "1",
                },
            )
            async with asyncio.timeout(COMPILER_TIMEOUT_SECONDS):
                stdout, stderr = await _capture_output(proc, b"")
        if proc.returncode != 0:
            raise WorkerFailure(f"Compiler worker exited with code {proc.returncode}")
        result = CompilerObservation.model_validate_json(stdout)
        if result.model_sha256 != observed.model_sha256:
            raise WorkerFailure("Compiler observation does not match the uploaded artifact")
        return result, stdout, stderr
    except TimeoutError:
        observed.diagnostics = "Compiler deadline exceeded; complete worker output is unavailable"
    except (WorkerFailure, ValidationError, OSError) as exc:
        observed.diagnostics = (
            str(exc)
            if isinstance(exc, WorkerFailure)
            else "Compiler worker output unavailable/invalid"
        )
    logger.warning("Compiler evidence inconclusive: %s", observed.diagnostics)
    return observed, stdout, stderr


def _dependency_lock() -> bytes:
    packaged = Path(__file__).with_name("uv.lock")
    source = Path(__file__).resolve().parents[2] / "uv.lock"
    return (packaged if packaged.is_file() else source).read_bytes()


@app.post("/api/compile", response_model=CompilationRun)
async def compile_model(request: Request) -> CompilationRun:
    """Compile one preflighted model and retain explicitly consented local evidence."""
    if request.headers.get("x-retain-evidence") != "true":
        raise HTTPException(
            status_code=400, detail="Explicit local evidence-retention consent required"
        )
    _check_admission(request)
    async with _parse_lock:
        raw_bytes = await _read_upload(request)
        model = await _preflight(raw_bytes)
        try:
            lock_bytes = _dependency_lock()
            adapter_hash = hashlib.sha256(
                Path(__file__).with_name("compiler_worker.py").read_bytes()
            ).hexdigest()
        except OSError as exc:
            logger.warning("Compiler provenance files unavailable")
            raise HTTPException(status_code=503, detail="Compiler provenance unavailable") from exc
        observation, stdout, stderr = await _run_compiler(raw_bytes)
        configuration = CompilerConfiguration(
            compiler_version=observation.compiler_version,
            compiler_build=observation.compiler_build,
            plugin_version=observation.plugin_version,
            device_name=observation.device_name,
            os=platform.platform(),
            architecture=platform.machine(),
            python_version=platform.python_version(),
            worker_command=list(COMPILER_COMMAND),
            wall_time_limit_seconds=COMPILER_TIMEOUT_SECONDS,
            adapter_sha256=adapter_hash,
            dependency_lock_sha256=hashlib.sha256(lock_bytes).hexdigest(),
        )
        summaries = {
            "compiled_unverified": "CPU compiled; execution and acceleration remain unverified.",
            "compile_failed": "Vendor frontend/compiler rejected this model configuration.",
            "inconclusive": "No reliable compilation conclusion; inspect retained diagnostics.",
        }
        run = CompilationRun(
            id=uuid4(),
            created_at=datetime.now(UTC),
            model=model,
            status=observation.status,
            stage=observation.stage,
            evidence_type=(
                "infrastructure_observed"
                if observation.status == "inconclusive"
                else "compiler_reported"
            ),
            summary=summaries[observation.status],
            diagnostics=observation.diagnostics,
            configuration=configuration,
            evaluation_key=evaluation_key(model.sha256, configuration),
            query_placements=observation.query_placements,
        )
        artifacts: dict[ArtifactName, bytes] = {
            "model.onnx": raw_bytes,
            "worker.stdout.json": stdout,
            "worker.stderr.txt": stderr,
            "diagnostics.txt": run.diagnostics.encode("utf-8"),
            "uv.lock": lock_bytes,
        }
        return await _store_call(lambda store: store.save(run, artifacts))


@app.get("/api/runs", response_model=list[RunSummary])
async def list_runs() -> list[RunSummary]:
    runs = await _store_call(lambda store: store.list_runs())
    return [
        RunSummary(
            id=run.id,
            created_at=run.created_at,
            model_sha256=run.model.sha256,
            status=run.status,
            compiler_version=run.configuration.compiler_version,
            device_name=run.configuration.device_name,
            evaluation_key=run.evaluation_key,
            summary=run.summary,
        )
        for run in runs
    ]


@app.get("/api/runs/{run_id}", response_model=CompilationRun)
async def get_run(run_id: UUID) -> CompilationRun:
    return await _store_call(lambda store: store.get(run_id))


@app.delete("/api/runs/{run_id}", status_code=204)
async def delete_run(run_id: UUID) -> Response:
    await _store_call(lambda store: store.delete(run_id))
    return Response(status_code=204)


@app.get("/api/runs/{run_id}/artifacts/{name}")
async def get_artifact(run_id: UUID, name: ArtifactName) -> Response:
    data = await _store_call(lambda store: store.artifact_path(run_id, name).read_bytes())
    return Response(
        content=data,
        media_type=ARTIFACT_MEDIA_TYPES[name],
        headers={
            "Content-Disposition": f'attachment; filename="{name}"',
            "Cache-Control": "no-store",
        },
    )


@app.get("/api/demos/{name}")
async def get_demo(name: str) -> Response:
    if name not in ("supported-cnn", "unsupported-op"):
        raise HTTPException(status_code=404, detail="Unknown generated demo")
    return Response(
        content=make_demo(name),
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{name}.onnx"'},
    )
