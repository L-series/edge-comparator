"""Unit tests for edge_comparator.parser_worker module directly."""

import io
import json
import os
import subprocess
import sys
from unittest.mock import patch

import onnx
import pytest
from onnx import TensorProto, helper

from edge_comparator.parser_worker import (
    PreviewRejected,
    _apply_resource_limits,
    main,
    parse_and_validate,
)


def test_worker_valid_relu(valid_relu_model_bytes: bytes) -> None:
    """Test parse_and_validate with valid model."""
    result = parse_and_validate(valid_relu_model_bytes).model_dump()
    assert result["status"] == "success"
    data = result["data"]
    assert data["format"] == "onnx"
    assert data["node_count"] == 1
    assert data["opsets"] == {"": 17}
    assert len(data["inputs"]) == 1
    assert len(data["outputs"]) == 1
    assert len(data["operations"]) == 1


def test_worker_dynamic_shape(dynamic_shape_model_bytes: bytes) -> None:
    """Test parse_and_validate with dynamic and None shapes."""
    result = parse_and_validate(dynamic_shape_model_bytes).model_dump()
    assert result["status"] == "success"
    inp = result["data"]["inputs"][0]
    assert inp["shape"] == ["batch", None, 224]


def test_worker_scalar(scalar_model_bytes: bytes) -> None:
    """Test parse_and_validate with scalar tensor zero dims."""
    result = parse_and_validate(scalar_model_bytes).model_dump()
    assert result["status"] == "success"
    assert result["data"]["inputs"][0]["shape"] == []


def test_worker_custom_domain(custom_domain_model_bytes: bytes) -> None:
    """Test parse_and_validate with custom operator domain."""
    result = parse_and_validate(custom_domain_model_bytes).model_dump()
    assert result["status"] == "success"
    assert "com.vendor.custom" in result["data"]["opsets"]


def test_worker_empty_payload() -> None:
    """Test parse_and_validate with empty bytes."""
    result = parse_and_validate(b"").model_dump()
    assert result["status"] == "rejected"
    assert "empty" in result["error"].lower()


def test_worker_corrupt_bytes() -> None:
    """Test parse_and_validate with corrupt payload."""
    result = parse_and_validate(b"corrupt non-onnx bytes").model_dump()
    assert result["status"] == "rejected"
    assert "failed to deserialize" in result["error"].lower()


def test_worker_node_count_exceeded() -> None:
    """Test parse_and_validate rejects graphs with more than 10,000 nodes."""
    x = helper.make_tensor_value_info("t0", TensorProto.FLOAT, [1])
    y = helper.make_tensor_value_info("t10001", TensorProto.FLOAT, [1])
    nodes = [
        helper.make_node("Relu", [f"t{i}"], [f"t{i + 1}"], name=f"Relu_{i}") for i in range(10001)
    ]
    graph = helper.make_graph(nodes, "huge_graph", [x], [y])
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)])
    raw_bytes = model.SerializeToString()

    result = parse_and_validate(raw_bytes).model_dump()
    assert result["status"] == "rejected"
    assert "exceeds maximum limit" in result["error"]


def test_worker_external_data(external_data_model_bytes: bytes) -> None:
    """Test parse_and_validate rejects external initializer data."""
    result = parse_and_validate(external_data_model_bytes).model_dump()
    assert result["status"] == "rejected"
    assert "external tensor data" in result["error"].lower()


def test_worker_attribute_external_data(attribute_external_data_model_bytes: bytes) -> None:
    """Test parse_and_validate rejects external data in attributes."""
    result = parse_and_validate(attribute_external_data_model_bytes).model_dump()
    assert result["status"] == "rejected"
    assert "external tensor data" in result["error"].lower()


def test_worker_attribute_tensors_external_data() -> None:
    """Test parse_and_validate rejects AttributeProto.TENSORS with external data."""
    y = helper.make_tensor_value_info("output", TensorProto.FLOAT, [1])
    attr_tensor = onnx.TensorProto()
    attr_tensor.name = "attr_t"
    attr_tensor.data_type = TensorProto.FLOAT
    attr_tensor.dims.extend([1])
    attr_tensor.data_location = TensorProto.DataLocation.EXTERNAL
    entry = attr_tensor.external_data.add()
    entry.key = "location"
    entry.value = "attr_weights.bin"

    node = helper.make_node("Constant", [], ["output"], name="Const_0", tensors=[attr_tensor])
    graph = helper.make_graph([node], "attr_ext_tensors_graph", [], [y])
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)])
    raw_bytes = model.SerializeToString()

    result = parse_and_validate(raw_bytes).model_dump()
    assert result["status"] == "rejected"
    assert "external tensor data" in result["error"].lower()


def test_worker_nested_graph(nested_graph_model_bytes: bytes) -> None:
    """Test parse_and_validate rejects nested subgraphs."""
    result = parse_and_validate(nested_graph_model_bytes).model_dump()
    assert result["status"] == "rejected"
    assert "nested graph" in result["error"].lower()


def test_worker_local_functions(local_function_model_bytes: bytes) -> None:
    """Test parse_and_validate rejects local function definitions."""
    result = parse_and_validate(local_function_model_bytes).model_dump()
    assert result["status"] == "rejected"
    assert "local function" in result["error"].lower()


def test_worker_sparse_initializer(sparse_model_bytes: bytes) -> None:
    """Test parse_and_validate rejects sparse initializers."""
    result = parse_and_validate(sparse_model_bytes).model_dump()
    assert result["status"] == "rejected"
    assert "sparse initializer" in result["error"].lower()


def test_worker_sparse_attribute() -> None:
    """Test parse_and_validate rejects sparse tensor attributes."""
    values = helper.make_tensor("values", TensorProto.FLOAT, [2], [1.0, 2.0])
    indices = helper.make_tensor("indices", TensorProto.INT64, [2], [0, 3])
    sparse = helper.make_sparse_tensor(values, indices, [4])

    y = helper.make_tensor_value_info("out", TensorProto.FLOAT, [4])
    node = helper.make_node("Constant", [], ["out"], name="SparseConst", sparse_value=sparse)
    graph = helper.make_graph([node], "sparse_attr_graph", [], [y])
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)])
    raw_bytes = model.SerializeToString()

    result = parse_and_validate(raw_bytes).model_dump()
    assert result["status"] == "rejected"
    assert "sparse tensor" in result["error"].lower()


def test_worker_sequence_io(sequence_io_model_bytes: bytes) -> None:
    """Test parse_and_validate rejects non-tensor input/output."""
    result = parse_and_validate(sequence_io_model_bytes).model_dump()
    assert result["status"] == "rejected"
    assert "non-tensor" in result["error"].lower()


def test_worker_undefined_input_elem_type() -> None:
    """Test parse_and_validate rejects inputs with undefined element type."""
    vi = helper.make_tensor_value_info("in", TensorProto.UNDEFINED, [1])
    vo = helper.make_tensor_value_info("out", TensorProto.FLOAT, [1])
    node = helper.make_node("Identity", ["in"], ["out"])
    graph = helper.make_graph([node], "undef_in_graph", [vi], [vo])
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)])
    raw_bytes = model.SerializeToString()

    result = parse_and_validate(raw_bytes).model_dump()
    assert result["status"] == "rejected"
    assert "undefined" in result["error"].lower()


def test_worker_undefined_output_elem_type() -> None:
    """Test parse_and_validate rejects outputs with undefined element type."""
    vi = helper.make_tensor_value_info("in", TensorProto.FLOAT, [1])
    vo = helper.make_tensor_value_info("out", TensorProto.UNDEFINED, [1])
    node = helper.make_node("Identity", ["in"], ["out"])
    graph = helper.make_graph([node], "undef_out_graph", [vi], [vo])
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)])
    raw_bytes = model.SerializeToString()

    result = parse_and_validate(raw_bytes).model_dump()
    assert result["status"] == "rejected"
    assert "undefined" in result["error"].lower()


def test_worker_non_tensor_output() -> None:
    """Test parse_and_validate rejects non-tensor output."""
    vi = helper.make_tensor_value_info("in", TensorProto.FLOAT, [1])
    seq_out = helper.make_tensor_sequence_value_info("seq_out", TensorProto.FLOAT, [1])
    node = helper.make_node("SequenceConstruct", ["in"], ["seq_out"])
    graph = helper.make_graph([node], "non_tensor_out_graph", [vi], [seq_out])
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)])
    raw_bytes = model.SerializeToString()

    result = parse_and_validate(raw_bytes).model_dump()
    assert result["status"] == "rejected"
    assert "non-tensor" in result["error"].lower()


def test_worker_missing_shape() -> None:
    """Unknown rank cannot be represented by the scalar shape []."""
    tt = onnx.TypeProto.Tensor()
    from edge_comparator.parser_worker import _extract_shape

    with pytest.raises(PreviewRejected, match="rank"):
        _extract_shape(tt)


def test_worker_onnx_checker_failure() -> None:
    """Test parse_and_validate captures onnx.checker validation failures."""
    x1 = helper.make_tensor_value_info("x1", TensorProto.FLOAT, [1])
    x2 = helper.make_tensor_value_info("x2", TensorProto.FLOAT, [1])
    y = helper.make_tensor_value_info("y", TensorProto.FLOAT, [1])
    node = helper.make_node("Relu", ["x1", "x2"], ["y"])
    graph = helper.make_graph([node], "invalid_graph", [x1, x2], [y])
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)])
    raw_bytes = model.SerializeToString()

    result = parse_and_validate(raw_bytes).model_dump()
    assert result["status"] == "rejected"
    assert "validation failed" in result["error"].lower()


def test_worker_main_success(valid_relu_model_bytes: bytes) -> None:
    """Test worker main() entrypoint with valid payload via stdin."""
    mock_stdin = io.BytesIO(valid_relu_model_bytes)
    mock_stdout = io.StringIO()

    with (
        patch("edge_comparator.parser_worker._apply_resource_limits"),
        patch("sys.stdin.buffer.read", mock_stdin.read),
        patch("sys.stdout.write", mock_stdout.write),
        patch("sys.stdout.flush"),
        pytest.raises(SystemExit) as exc,
    ):
        main()

    assert exc.value.code == 0
    output = json.loads(mock_stdout.getvalue())
    assert output["status"] == "success"


def test_worker_main_exception() -> None:
    """Infrastructure failures terminate the worker instead of rejecting the model."""
    mock_stdout = io.StringIO()

    with (
        patch("edge_comparator.parser_worker._apply_resource_limits"),
        patch("sys.stdin.buffer.read", side_effect=OSError("Read error")),
        patch("sys.stdout.write", mock_stdout.write),
        patch("sys.stdout.flush"),
        pytest.raises(OSError, match="Read error"),
    ):
        main()

    assert mock_stdout.getvalue() == ""


def test_apply_resource_limits_executes() -> None:
    """Test that _apply_resource_limits runs in a child process without errors."""
    code = (
        "from edge_comparator.parser_worker import _apply_resource_limits; _apply_resource_limits()"
    )
    env = {
        "PYTHONPATH": "src",
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
    }
    res = subprocess.run([sys.executable, "-c", code], capture_output=True, env=env, check=True)
    assert res.returncode == 0


def test_apply_resource_limits_non_linux() -> None:
    """Never silently run an unbounded parser on an unsupported platform."""
    with patch("sys.platform", "win32"), pytest.raises(RuntimeError, match="requires Linux"):
        _apply_resource_limits()
