"""Regressions for resource ownership and truthful worker failure reporting."""

import asyncio
import sys
from collections.abc import AsyncIterator
from pathlib import Path
from unittest.mock import AsyncMock, patch

import onnx
import pytest
from httpx import AsyncClient
from onnx import TensorProto, helper

from edge_comparator import api
from edge_comparator.parser_worker import parse_and_validate


async def test_invalid_content_length_is_a_client_error(async_client: AsyncClient) -> None:
    for length in ("invalid", "-1"):
        response = await async_client.post(
            "/api/inspect",
            content=b"model",
            headers={"Content-Type": "application/octet-stream", "Content-Length": length},
        )
        assert response.status_code == 400


async def test_concurrency_is_bounded_while_uploading(
    async_client: AsyncClient, valid_relu_model_bytes: bytes
) -> None:
    started = asyncio.Event()
    release = asyncio.Event()

    async def slow_body() -> AsyncIterator[bytes]:
        started.set()
        yield b"partial"
        await release.wait()

    task = asyncio.create_task(
        async_client.post(
            "/api/inspect",
            content=slow_body(),
            headers={"Content-Type": "application/octet-stream"},
        )
    )
    try:
        await asyncio.wait_for(started.wait(), timeout=1)
        response = await async_client.post(
            "/api/inspect",
            content=valid_relu_model_bytes,
            headers={"Content-Type": "application/octet-stream"},
        )
        assert response.status_code == 503
    finally:
        release.set()
        await task
    assert not api._parse_lock.locked()


async def test_upload_read_has_a_deadline(
    async_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(api, "UPLOAD_TIMEOUT_SECONDS", 0.01, raising=False)

    async def slow_body() -> AsyncIterator[bytes]:
        await asyncio.sleep(1)
        yield b"model"

    response = await asyncio.wait_for(
        async_client.post(
            "/api/inspect",
            content=slow_body(),
            headers={"Content-Type": "application/octet-stream"},
        ),
        timeout=0.2,
    )
    assert response.status_code == 408
    assert not api._parse_lock.locked()


async def test_malformed_worker_metadata_is_unavailable_not_a_model_rejection(
    async_client: AsyncClient, valid_relu_model_bytes: bytes
) -> None:
    process = AsyncMock()
    process.returncode = 0
    with (
        patch("asyncio.create_subprocess_exec", return_value=process),
        patch("edge_comparator.api._communicate", return_value=b'{"status":"success","data":{}}'),
    ):
        response = await async_client.post(
            "/api/inspect",
            content=valid_relu_model_bytes,
            headers={"Content-Type": "application/octet-stream"},
        )
    assert response.status_code == 503


def test_unknown_rank_is_not_claimed_as_scalar() -> None:
    graph = helper.make_graph(
        [helper.make_node("Identity", ["x"], ["y"])],
        "unknown-rank",
        [helper.make_tensor_value_info("x", TensorProto.FLOAT, None)],
        [helper.make_tensor_value_info("y", TensorProto.FLOAT, [1])],
    )
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)])
    result = parse_and_validate(model.SerializeToString()).model_dump()
    assert result["status"] == "rejected"
    assert "rank" in result["error"].lower()


def test_internal_parser_fault_does_not_become_unsupported_model(
    valid_relu_model_bytes: bytes,
) -> None:
    with (
        patch.object(onnx, "load_model_from_string", side_effect=MemoryError),
        pytest.raises(MemoryError),
    ):
        parse_and_validate(valid_relu_model_bytes)


async def test_cancelling_worker_reaps_child_and_removes_temporary_directory(
    valid_relu_model_bytes: bytes, monkeypatch: pytest.MonkeyPatch
) -> None:
    original_spawn = asyncio.create_subprocess_exec
    started = asyncio.Event()
    children: list[asyncio.subprocess.Process] = []
    directories: list[Path] = []

    async def spawn(
        *_args: str, stdin: int, stdout: int, stderr: int, cwd: str, env: dict[str, str]
    ) -> asyncio.subprocess.Process:
        child = await original_spawn(
            sys.executable,
            "-c",
            "import time; time.sleep(60)",
            stdin=stdin,
            stdout=stdout,
            stderr=stderr,
            cwd=cwd,
            env=env,
        )
        children.append(child)
        directories.append(Path(cwd))
        started.set()
        return child

    monkeypatch.setattr(asyncio, "create_subprocess_exec", spawn)
    task = asyncio.create_task(api._run_parser_subprocess(valid_relu_model_bytes))
    await asyncio.wait_for(started.wait(), timeout=2)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert children[0].returncode is not None
    assert not directories[0].exists()


async def test_worker_output_byte_limit() -> None:
    for size in (4, 5):
        stream = asyncio.StreamReader()
        stream.feed_data(b"x" * size)
        stream.feed_eof()
        if size == 4:
            assert await api._read_bounded(stream, 4) == b"xxxx"
        else:
            with pytest.raises(api.WorkerFailure, match="output limit"):
                await api._read_bounded(stream, 4)


async def test_worker_metadata_cannot_name_a_different_artifact(
    valid_relu_model_bytes: bytes,
) -> None:
    result = parse_and_validate(valid_relu_model_bytes)
    assert result.status == "success"
    result.data.sha256 = "0" * 64
    process = AsyncMock()
    process.returncode = 0
    with (
        patch("asyncio.create_subprocess_exec", return_value=process),
        patch("edge_comparator.api._communicate", return_value=result.model_dump_json().encode()),
        pytest.raises(api.WorkerFailure, match="does not match"),
    ):
        await api._run_parser_subprocess(valid_relu_model_bytes)


async def test_large_metadata_is_an_explicit_ingestion_limit(async_client: AsyncClient) -> None:
    dimension = "n" * (2 * 1024 * 1024)
    graph = helper.make_graph(
        [helper.make_node("Identity", ["x"], ["y"])],
        "large-metadata",
        [helper.make_tensor_value_info("x", TensorProto.FLOAT, [dimension])],
        [helper.make_tensor_value_info("y", TensorProto.FLOAT, [dimension])],
    )
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)])
    response = await async_client.post(
        "/api/inspect",
        content=model.SerializeToString(),
        headers={"Content-Type": "application/octet-stream"},
    )
    assert response.status_code == 422
    assert "Metadata exceeds" in response.json()["detail"]


@pytest.mark.parametrize("feature", ["training", "duplicate-opset"])
def test_additional_unsupported_graph_constructs(
    valid_relu_model_bytes: bytes, feature: str
) -> None:
    model = onnx.load_model_from_string(valid_relu_model_bytes)
    if feature == "training":
        model.training_info.add()
    else:
        model.opset_import.add(domain="", version=17)
    result = parse_and_validate(model.SerializeToString())
    assert result.status == "rejected"
    assert "ingestion limitation" in result.error


async def test_exact_upload_limit_and_dishonest_stream_length(
    async_client: AsyncClient, valid_relu_model_bytes: bytes
) -> None:
    metadata = parse_and_validate(valid_relu_model_bytes)
    assert metadata.status == "success"
    with patch("edge_comparator.api._run_parser_subprocess", return_value=metadata.data):
        response = await async_client.post(
            "/api/inspect",
            content=b"x" * (16 * 1024 * 1024),
            headers={"Content-Type": "application/octet-stream"},
        )
        assert response.status_code == 200

    async def oversized() -> AsyncIterator[bytes]:
        yield b"x" * (16 * 1024 * 1024)
        yield b"x"

    for headers in (
        {"Content-Type": "application/octet-stream"},
        {"Content-Type": "application/octet-stream", "Content-Length": "1"},
    ):
        response = await async_client.post("/api/inspect", content=oversized(), headers=headers)
        assert response.status_code == 413
    assert not api._parse_lock.locked()
