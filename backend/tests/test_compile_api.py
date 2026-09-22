"""Real compiler API, consent, durable history and conservative failure semantics."""

import asyncio
import hashlib
from pathlib import Path
from threading import Event
from unittest.mock import AsyncMock

import pytest
from httpx import AsyncClient

from edge_comparator import api
from edge_comparator.compilation_models import CompilerObservation
from edge_comparator.demos import make_demo
from edge_comparator.evidence_store import RunStore, StoreCapacityError, StoreError

HEADERS = {"Content-Type": "application/octet-stream", "X-Retain-Evidence": "true"}


@pytest.mark.integration
async def test_compile_history_artifacts_and_deletion(
    async_client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("EDGE_COMPARATOR_DATA_DIR", str(tmp_path / "evidence"))
    model = make_demo("supported-cnn")
    response = await async_client.post("/api/compile", content=model, headers=HEADERS)
    assert response.status_code == 200, response.text
    run = response.json()
    assert run["status"] == "compiled_unverified"
    assert run["evidence_type"] == "compiler_reported"
    assert run["configuration"]["worker_command"] == list(api.COMPILER_COMMAND)
    assert run["configuration"]["wall_time_limit_seconds"] == 60.0
    assert run["model"]["sha256"] == hashlib.sha256(model).hexdigest()
    run_url = f"/api/runs/{run['id']}"
    assert (await async_client.get(run_url)).json() == run
    assert (await async_client.get(run_url)).headers["cache-control"] == "no-store"
    history = (await async_client.get("/api/runs")).json()
    assert history[0]["id"] == run["id"]
    for artifact in run["artifacts"]:
        download = await async_client.get(f"{run_url}/artifacts/{artifact['name']}")
        assert download.status_code == 200
        assert hashlib.sha256(download.content).hexdigest() == artifact["sha256"]
    assert (await async_client.delete(run_url)).status_code == 204
    assert (await async_client.get(run_url)).status_code == 404
    assert (await async_client.get("/api/runs")).json() == []


async def test_compile_requires_consent_and_preflight(
    async_client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = tmp_path / "evidence"
    monkeypatch.setenv("EDGE_COMPARATOR_DATA_DIR", str(root))
    response = await async_client.post(
        "/api/compile",
        content=make_demo("supported-cnn"),
        headers={"Content-Type": "application/octet-stream"},
    )
    assert response.status_code == 400
    assert not root.exists()
    response = await async_client.post("/api/compile", content=b"bad", headers=HEADERS)
    assert response.status_code == 422
    assert not root.exists()


@pytest.mark.integration
async def test_custom_op_is_a_retained_compiler_rejection(
    async_client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("EDGE_COMPARATOR_DATA_DIR", str(tmp_path / "evidence"))
    demo = await async_client.get("/api/demos/unsupported-op")
    assert demo.status_code == 200
    response = await async_client.post("/api/compile", content=demo.content, headers=HEADERS)
    assert response.status_code == 200
    run = response.json()
    assert run["status"] == "compile_failed"
    assert run["stage"] == "import"
    assert "MysteryActivation" in run["diagnostics"]
    assert "No conversion rule" in run["diagnostics"]
    assert (await async_client.get("/api/demos/unknown")).status_code == 404


@pytest.mark.parametrize(
    "failure", ["invalid", "wrong-hash", "exit", "timeout", "spawn", "overflow"]
)
async def test_compiler_transport_failures_are_inconclusive(
    monkeypatch: pytest.MonkeyPatch, failure: str
) -> None:
    payload = make_demo("supported-cnn")
    process = AsyncMock()
    process.returncode = 9 if failure == "exit" else 0
    monkeypatch.setattr(asyncio, "create_subprocess_exec", AsyncMock(return_value=process))
    stdout = b"not json"
    if failure == "wrong-hash":
        stdout = (
            CompilerObservation(status="inconclusive", stage="worker", model_sha256="a" * 64)
            .model_dump_json()
            .encode()
        )
    capture = AsyncMock(return_value=(stdout, b"actual stderr"))
    if failure == "timeout":
        capture.side_effect = TimeoutError
    elif failure == "overflow":
        capture.side_effect = api.WorkerFailure("Worker exceeded its output limit")
    elif failure == "spawn":
        monkeypatch.setattr(asyncio, "create_subprocess_exec", AsyncMock(side_effect=OSError))
    monkeypatch.setattr(api, "_capture_output", capture)
    result, raw_stdout, raw_stderr = await api._run_compiler(payload)
    assert result.status == "inconclusive"
    assert result.stage == "worker"
    assert result.diagnostics
    if failure in ("invalid", "wrong-hash", "exit"):
        assert raw_stdout == stdout
        assert raw_stderr == b"actual stderr"


@pytest.mark.parametrize("failure", [StoreError("corrupt"), StoreCapacityError("full"), OSError()])
async def test_storage_failure_is_not_a_successful_durable_result(
    async_client: AsyncClient, monkeypatch: pytest.MonkeyPatch, failure: Exception
) -> None:
    def broken_store() -> None:
        raise failure

    monkeypatch.setattr(api, "RunStore", broken_store)
    result = await async_client.get("/api/runs")
    assert result.status_code == (507 if isinstance(failure, StoreCapacityError) else 503)


async def test_no_compilation_without_provenance(
    async_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    def missing_lock() -> bytes:
        raise FileNotFoundError

    monkeypatch.setattr(api, "_dependency_lock", missing_lock)
    response = await async_client.post(
        "/api/compile", content=make_demo("supported-cnn"), headers=HEADERS
    )
    assert response.status_code == 503


async def test_cancelled_storage_waiter_does_not_release_active_writer(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("EDGE_COMPARATOR_DATA_DIR", str(tmp_path / "evidence"))
    started = asyncio.Event()
    release = Event()
    loop = asyncio.get_running_loop()

    def writing(_store: RunStore) -> None:
        loop.call_soon_threadsafe(started.set)
        if not release.wait(timeout=5):
            raise RuntimeError("Test did not release writer")

    task = asyncio.create_task(api._store_call(writing))
    await asyncio.wait_for(started.wait(), timeout=2)
    task.cancel()
    try:
        await asyncio.sleep(0)
        assert api._store_lock.locked()
    finally:
        release.set()
    with pytest.raises(asyncio.CancelledError):
        await task
    await api._store_call(lambda _store: None)
    assert not api._store_lock.locked()
