"""Tests for POST /api/inspect endpoint, covering all behaviors, schemas, and error codes."""

import hashlib
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

from edge_comparator.api import WorkerFailure, _run_parser_subprocess


@pytest.mark.asyncio
async def test_inspect_valid_relu_model(
    async_client: AsyncClient,
    valid_relu_model_bytes: bytes,
) -> None:
    """Test full inspect flow with a valid tiny Relu model."""
    expected_sha256 = hashlib.sha256(valid_relu_model_bytes).hexdigest()

    response = await async_client.post(
        "/api/inspect",
        content=valid_relu_model_bytes,
        headers={"Content-Type": "application/octet-stream"},
    )
    assert response.status_code == 200
    data = response.json()

    # Evidence and stage contracts
    assert data["evidence_type"] == "static_inferred"
    assert data["stage"] == "preflight"

    # Model metadata
    model_meta = data["model"]
    assert model_meta["sha256"] == expected_sha256
    assert model_meta["format"] == "onnx"
    assert isinstance(model_meta["ir_version"], int)
    assert model_meta["node_count"] == 1

    # Opsets: empty string key represents ai.onnx default domain
    assert "" in model_meta["opsets"]
    assert model_meta["opsets"][""] == 17

    # Inputs and Outputs
    assert len(model_meta["inputs"]) == 1
    inp = model_meta["inputs"][0]
    assert inp["name"] == "input"
    assert inp["dtype"] == "FLOAT"
    assert inp["shape"] == [1, 3, 224, 224]

    assert len(model_meta["outputs"]) == 1
    out = model_meta["outputs"][0]
    assert out["name"] == "output"
    assert out["dtype"] == "FLOAT"
    assert out["shape"] == [1, 3, 224, 224]

    # Operations inventory
    assert len(model_meta["operations"]) == 1
    op = model_meta["operations"][0]
    assert op["index"] == 0
    assert op["name"] == "Relu_0"
    assert op["domain"] == ""
    assert op["op_type"] == "Relu"

    # Results: exactly 3 entries, all ALWAYS not_tested
    results = data["results"]
    assert len(results) == 3
    result_ids = [r["target_id"] for r in results]
    assert result_ids == [
        "nvidia-jetson-orin-nano",
        "intel-openvino-cpu",
        "nxp-imx93-ethos-u65",
    ]

    for r in results:
        assert r["status"] == "not_tested"
        reason = r["reason"].lower()
        assert "no exact compiler/runtime configuration executed" in reason
        assert "accelerated" not in reason

    # Vela-specific explanation
    nxp_result = next(r for r in results if r["target_id"] == "nxp-imx93-ethos-u65")
    nxp_reason = nxp_result["reason"].lower()
    assert "vela" in nxp_reason
    assert "tflite" in nxp_reason


@pytest.mark.asyncio
async def test_inspect_dynamic_shapes(
    async_client: AsyncClient,
    dynamic_shape_model_bytes: bytes,
) -> None:
    """Preserve symbolic dimensions vs unknown (None) dimensions."""
    response = await async_client.post(
        "/api/inspect",
        content=dynamic_shape_model_bytes,
        headers={"Content-Type": "application/octet-stream"},
    )
    assert response.status_code == 200
    data = response.json()

    inp = data["model"]["inputs"][0]
    assert inp["shape"] == ["batch", None, 224]

    out = data["model"]["outputs"][0]
    assert out["shape"] == ["batch", None, 224]


@pytest.mark.asyncio
async def test_inspect_scalar_tensor_zero_dims(
    async_client: AsyncClient,
    scalar_model_bytes: bytes,
) -> None:
    """Preserve scalar tensor with zero dimensions (empty list)."""
    response = await async_client.post(
        "/api/inspect",
        content=scalar_model_bytes,
        headers={"Content-Type": "application/octet-stream"},
    )
    assert response.status_code == 200
    data = response.json()

    inp = data["model"]["inputs"][0]
    assert inp["shape"] == []

    out = data["model"]["outputs"][0]
    assert out["shape"] == []


@pytest.mark.asyncio
async def test_inspect_custom_operator_domain(
    async_client: AsyncClient,
    custom_domain_model_bytes: bytes,
) -> None:
    """Custom operator domains remain inventoried without assuming kernels."""
    response = await async_client.post(
        "/api/inspect",
        content=custom_domain_model_bytes,
        headers={"Content-Type": "application/octet-stream"},
    )
    assert response.status_code == 200
    data = response.json()

    assert "com.vendor.custom" in data["model"]["opsets"]
    assert data["model"]["opsets"]["com.vendor.custom"] == 1

    op = data["model"]["operations"][0]
    assert op["domain"] == "com.vendor.custom"
    assert op["op_type"] == "CustomOp"


@pytest.mark.asyncio
async def test_inspect_rejects_bad_media_415(
    async_client: AsyncClient,
    valid_relu_model_bytes: bytes,
) -> None:
    """Reject requests with Content-Type other than application/octet-stream with 415."""
    for bad_ct in [
        "application/json",
        "multipart/form-data",
        "text/plain",
        "application/x-protobuf",
    ]:
        response = await async_client.post(
            "/api/inspect",
            content=valid_relu_model_bytes,
            headers={"Content-Type": bad_ct},
        )
        assert response.status_code == 415
        assert "application/octet-stream" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_inspect_rejects_oversized_payload_413(
    async_client: AsyncClient,
) -> None:
    """Reject payloads larger than 16 MiB with 413."""
    sixteen_mib_plus_one = (16 * 1024 * 1024) + 1
    oversized_data = b"0" * sixteen_mib_plus_one

    response = await async_client.post(
        "/api/inspect",
        content=oversized_data,
        headers={"Content-Type": "application/octet-stream"},
    )
    assert response.status_code == 413
    assert "exceeds" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_inspect_rejects_empty_payload_422(
    async_client: AsyncClient,
) -> None:
    """Reject empty 0-byte upload with 422."""
    response = await async_client.post(
        "/api/inspect",
        content=b"",
        headers={"Content-Type": "application/octet-stream"},
    )
    assert response.status_code == 422
    assert "empty" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_inspect_rejects_malformed_onnx_422(
    async_client: AsyncClient,
) -> None:
    """Reject corrupt/non-ONNX bytes with 422."""
    corrupt_bytes = b"NOT_A_VALID_ONNX_MODEL_HEADER_CORRUPT_BYTES"
    response = await async_client.post(
        "/api/inspect",
        content=corrupt_bytes,
        headers={"Content-Type": "application/octet-stream"},
    )
    assert response.status_code == 422
    detail = response.json()["detail"].lower()
    assert "error" in detail or "failed" in detail


@pytest.mark.asyncio
async def test_inspect_rejects_external_tensor_data_422(
    async_client: AsyncClient,
    external_data_model_bytes: bytes,
) -> None:
    """Reject external tensor data in initializers with 422 (ingestion limitation)."""
    response = await async_client.post(
        "/api/inspect",
        content=external_data_model_bytes,
        headers={"Content-Type": "application/octet-stream"},
    )
    assert response.status_code == 422
    detail = response.json()["detail"].lower()
    assert "external" in detail
    assert "ingestion limitation" in detail


@pytest.mark.asyncio
async def test_inspect_rejects_attribute_external_tensor_data_422(
    async_client: AsyncClient,
    attribute_external_data_model_bytes: bytes,
) -> None:
    """Reject external tensor data in node attributes with 422 (ingestion limitation)."""
    response = await async_client.post(
        "/api/inspect",
        content=attribute_external_data_model_bytes,
        headers={"Content-Type": "application/octet-stream"},
    )
    assert response.status_code == 422
    detail = response.json()["detail"].lower()
    assert "external" in detail
    assert "ingestion limitation" in detail


@pytest.mark.asyncio
async def test_inspect_rejects_nested_subgraphs_422(
    async_client: AsyncClient,
    nested_graph_model_bytes: bytes,
) -> None:
    """Reject nested subgraphs/control flow with 422 (ingestion limitation)."""
    response = await async_client.post(
        "/api/inspect",
        content=nested_graph_model_bytes,
        headers={"Content-Type": "application/octet-stream"},
    )
    assert response.status_code == 422
    detail = response.json()["detail"].lower()
    assert "nested graph" in detail or "subgraph" in detail
    assert "ingestion limitation" in detail


@pytest.mark.asyncio
async def test_inspect_rejects_local_function_bodies_422(
    async_client: AsyncClient,
    local_function_model_bytes: bytes,
) -> None:
    """Reject local function definitions with 422 (ingestion limitation)."""
    response = await async_client.post(
        "/api/inspect",
        content=local_function_model_bytes,
        headers={"Content-Type": "application/octet-stream"},
    )
    assert response.status_code == 422
    detail = response.json()["detail"].lower()
    assert "function" in detail
    assert "ingestion limitation" in detail


@pytest.mark.asyncio
async def test_inspect_rejects_sparse_initializers_422(
    async_client: AsyncClient,
    sparse_model_bytes: bytes,
) -> None:
    """Reject sparse initializers with 422 (ingestion limitation)."""
    response = await async_client.post(
        "/api/inspect",
        content=sparse_model_bytes,
        headers={"Content-Type": "application/octet-stream"},
    )
    assert response.status_code == 422
    detail = response.json()["detail"].lower()
    assert "sparse" in detail
    assert "ingestion limitation" in detail


@pytest.mark.asyncio
async def test_inspect_rejects_non_tensor_io_422(
    async_client: AsyncClient,
    sequence_io_model_bytes: bytes,
) -> None:
    """Reject non-tensor (e.g. sequence) IO with 422."""
    response = await async_client.post(
        "/api/inspect",
        content=sequence_io_model_bytes,
        headers={"Content-Type": "application/octet-stream"},
    )
    assert response.status_code == 422
    detail = response.json()["detail"].lower()
    assert "non-tensor" in detail
    assert "ingestion limitation" in detail


@pytest.mark.asyncio
async def test_inspect_concurrency_busy_503(
    async_client: AsyncClient,
    valid_relu_model_bytes: bytes,
) -> None:
    """Single active parse limit returns explicit 503 when worker is busy."""
    from edge_comparator.api import _parse_lock

    # Lock the parser mutex to simulate an in-flight parse
    await _parse_lock.acquire()
    try:
        response = await async_client.post(
            "/api/inspect",
            content=valid_relu_model_bytes,
            headers={"Content-Type": "application/octet-stream"},
        )
        assert response.status_code == 503
        assert "busy" in response.json()["detail"].lower()
    finally:
        _parse_lock.release()


@pytest.mark.asyncio
async def test_inspect_parser_timeout_503(
    async_client: AsyncClient,
    valid_relu_model_bytes: bytes,
) -> None:
    """Parser worker wall timeout triggers 503 Service Unavailable."""
    with patch("edge_comparator.api.PARSER_TIMEOUT_SECONDS", 0.001):
        # Force timeout by patching timeout to 1ms
        response = await async_client.post(
            "/api/inspect",
            content=valid_relu_model_bytes,
            headers={"Content-Type": "application/octet-stream"},
        )
        assert response.status_code == 503
        assert "timed out" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_inspect_worker_crash_503(
    async_client: AsyncClient,
    valid_relu_model_bytes: bytes,
) -> None:
    """Worker process crashing or returning invalid JSON returns 503."""
    with patch("edge_comparator.api._run_parser_subprocess") as mock_run:
        mock_run.side_effect = WorkerFailure("Parser worker process failed")
        response = await async_client.post(
            "/api/inspect",
            content=valid_relu_model_bytes,
            headers={"Content-Type": "application/octet-stream"},
        )
        assert response.status_code == 503
        assert "failed" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_inspect_content_length_header_oversized_413(
    async_client: AsyncClient,
) -> None:
    """Explicit Content-Length header exceeding limit is rejected immediately with 413."""
    response = await async_client.post(
        "/api/inspect",
        content=b"tiny",
        headers={
            "Content-Type": "application/octet-stream",
            "Content-Length": str(20 * 1024 * 1024),
        },
    )
    assert response.status_code == 413
    assert "exceeds" in response.json()["detail"].lower()


@pytest.mark.parametrize(
    ("code", "output", "message"),
    [
        (1, b"", "exited with code 1"),
        (0, b"NOT_VALID_JSON", "invalid metadata"),
        (0, b'{"status":"unknown"}', "invalid metadata"),
        (0, b"[]", "invalid metadata"),
        (0, b'{"status":"success","data":{}}', "invalid metadata"),
    ],
)
async def test_run_parser_subprocess_errors(
    valid_relu_model_bytes: bytes, code: int, output: bytes, message: str
) -> None:
    process = AsyncMock()
    process.returncode = code
    with (
        patch("asyncio.create_subprocess_exec", return_value=process),
        patch("edge_comparator.api._communicate", return_value=output),
        pytest.raises(WorkerFailure, match=message),
    ):
        await _run_parser_subprocess(valid_relu_model_bytes)
