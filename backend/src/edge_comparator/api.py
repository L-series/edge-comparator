"""FastAPI application for the Edge-AI Hardware Comparator preflight prototype."""

import asyncio
import hashlib
import logging
import sys
import tempfile
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, status
from pydantic import TypeAdapter, ValidationError

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
    description="Reversible local preflight prototype for edge-AI hardware comparison",
    version="0.1.0",
)

PARSER_TIMEOUT_SECONDS = 10.0
UPLOAD_TIMEOUT_SECONDS = 10.0
# ponytail: one upload/parser per API process; shared services need isolated job scheduling.
_parse_lock = asyncio.Lock()
logger = logging.getLogger(__name__)
_worker_result: TypeAdapter[WorkerResult] = TypeAdapter(WorkerResult)

SRC_DIR = str(Path(__file__).resolve().parent.parent)

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
        name="Intel Core Processor",
        vendor="Intel",
        accelerator="Intel CPU with OpenVINO",
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
            raise WorkerFailure("Parser worker exceeded its output limit")
    return bytes(data)


async def _send_input(stream: asyncio.StreamWriter, data: bytes) -> None:
    try:
        stream.write(data)
        await stream.drain()
    finally:
        stream.close()


async def _communicate(proc: asyncio.subprocess.Process, data: bytes) -> bytes:
    tasks: list[asyncio.Task[bytes] | asyncio.Task[None]] = []
    try:
        if proc.stdin is None or proc.stdout is None or proc.stderr is None:
            raise WorkerFailure("Parser worker pipes are unavailable")
        stdout = asyncio.create_task(_read_bounded(proc.stdout, MAX_METADATA_BYTES))
        tasks = [
            stdout,
            asyncio.create_task(_read_bounded(proc.stderr, 65_536)),
            asyncio.create_task(_send_input(proc.stdin, data)),
        ]
        async with asyncio.timeout(PARSER_TIMEOUT_SECONDS):
            await asyncio.gather(*tasks)
            await proc.wait()
        return stdout.result()
    finally:
        if proc.returncode is None:
            try:
                proc.kill()
            except ProcessLookupError:
                logger.info("Parser exited during cancellation cleanup")
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


@app.post("/api/inspect", response_model=InspectResponse)
async def inspect_model(request: Request) -> InspectResponse:
    """Inspect raw ONNX model and return preflight assessment."""
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

    async with _parse_lock:
        content_length = request.headers.get("content-length")
        if content_length is not None:
            if not content_length.isascii() or not content_length.isdecimal():
                raise HTTPException(status_code=400, detail="Invalid Content-Length header")
            normalized_length = content_length.lstrip("0") or "0"
            if (
                len(normalized_length) > len(str(MAX_UPLOAD_BYTES))
                or int(normalized_length) > MAX_UPLOAD_BYTES
            ):
                raise HTTPException(
                    status_code=413, detail="Uploaded model exceeds the 16 MiB limit"
                )
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
        try:
            model_meta = await _run_parser_subprocess(bytes(raw_bytes))
        except (WorkerFailure, OSError) as exc:
            detail = str(exc) if isinstance(exc, WorkerFailure) else "Parser worker process failed"
            logger.warning("Model inspector unavailable: %s", detail)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=detail,
            ) from exc

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
