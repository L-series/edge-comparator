"""Test fixtures and ONNX model generators using official onnx.helper."""

from collections.abc import AsyncGenerator

import onnx
import pytest
from httpx import ASGITransport, AsyncClient
from onnx import TensorProto, helper

from edge_comparator.api import app


@pytest.fixture
def valid_relu_model_bytes() -> bytes:
    """Generate a valid minimal Relu ONNX model."""
    x = helper.make_tensor_value_info("input", TensorProto.FLOAT, [1, 3, 224, 224])
    y = helper.make_tensor_value_info("output", TensorProto.FLOAT, [1, 3, 224, 224])
    node = helper.make_node("Relu", ["input"], ["output"], name="Relu_0")
    graph = helper.make_graph([node], "relu_graph", [x], [y])
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)])
    onnx.checker.check_model(model)
    return model.SerializeToString()


@pytest.fixture
def dynamic_shape_model_bytes() -> bytes:
    """Generate an ONNX model with symbolic and unknown (None) dimensions."""
    x = helper.make_tensor_value_info("input", TensorProto.FLOAT, ["batch", None, 224])
    y = helper.make_tensor_value_info("output", TensorProto.FLOAT, ["batch", None, 224])
    node = helper.make_node("Relu", ["input"], ["output"], name="Relu_dyn")
    graph = helper.make_graph([node], "dynamic_graph", [x], [y])
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)])
    onnx.checker.check_model(model)
    return model.SerializeToString()


@pytest.fixture
def scalar_model_bytes() -> bytes:
    """Generate an ONNX model with scalar tensor inputs and outputs (zero dims)."""
    x = helper.make_tensor_value_info("scalar_in", TensorProto.FLOAT, [])
    y = helper.make_tensor_value_info("scalar_out", TensorProto.FLOAT, [])
    node = helper.make_node("Relu", ["scalar_in"], ["scalar_out"], name="Relu_scalar")
    graph = helper.make_graph([node], "scalar_graph", [x], [y])
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)])
    onnx.checker.check_model(model)
    return model.SerializeToString()


@pytest.fixture
def custom_domain_model_bytes() -> bytes:
    """Generate an ONNX model with a custom operator domain."""
    x = helper.make_tensor_value_info("x", TensorProto.FLOAT, [1, 4])
    y = helper.make_tensor_value_info("y", TensorProto.FLOAT, [1, 4])
    node = helper.make_node("CustomOp", ["x"], ["y"], name="Custom_0", domain="com.vendor.custom")
    graph = helper.make_graph([node], "custom_graph", [x], [y])
    model = helper.make_model(
        graph,
        opset_imports=[
            helper.make_opsetid("", 17),
            helper.make_opsetid("com.vendor.custom", 1),
        ],
    )
    onnx.checker.check_model(model)
    return model.SerializeToString()


@pytest.fixture
def external_data_model_bytes() -> bytes:
    """Generate an ONNX model with external tensor data in initializers."""
    x = helper.make_tensor_value_info("input", TensorProto.FLOAT, [1, 2])
    y = helper.make_tensor_value_info("output", TensorProto.FLOAT, [1, 2])
    tensor = onnx.TensorProto()
    tensor.name = "weights"
    tensor.data_type = TensorProto.FLOAT
    tensor.dims.extend([1, 2])
    tensor.data_location = TensorProto.DataLocation.EXTERNAL
    entry = tensor.external_data.add()
    entry.key = "location"
    entry.value = "external_weights.bin"

    node = helper.make_node("Add", ["input", "weights"], ["output"], name="Add_0")
    graph = helper.make_graph([node], "ext_data_graph", [x], [y], initializer=[tensor])
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)])
    return model.SerializeToString()


@pytest.fixture
def attribute_external_data_model_bytes() -> bytes:
    """Generate an ONNX model with external tensor data in a node attribute."""
    y = helper.make_tensor_value_info("output", TensorProto.FLOAT, [1])
    attr_tensor = onnx.TensorProto()
    attr_tensor.name = "attr_t"
    attr_tensor.data_type = TensorProto.FLOAT
    attr_tensor.dims.extend([1])
    attr_tensor.data_location = TensorProto.DataLocation.EXTERNAL
    entry = attr_tensor.external_data.add()
    entry.key = "location"
    entry.value = "attr_weights.bin"

    node = helper.make_node("Constant", [], ["output"], name="Const_0", value=attr_tensor)
    graph = helper.make_graph([node], "attr_ext_graph", [], [y])
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)])
    return model.SerializeToString()


@pytest.fixture
def nested_graph_model_bytes() -> bytes:
    """Generate an ONNX model with nested subgraphs (e.g., If control flow)."""
    cond = helper.make_tensor_value_info("cond", TensorProto.BOOL, [])
    y = helper.make_tensor_value_info("output", TensorProto.FLOAT, [1])

    sub_out = helper.make_tensor_value_info("sub_out", TensorProto.FLOAT, [1])
    c1 = helper.make_node(
        "Constant",
        [],
        ["sub_out"],
        value=helper.make_tensor("c1", TensorProto.FLOAT, [1], [1.0]),
    )
    then_graph = helper.make_graph([c1], "then_branch", [], [sub_out])

    c2 = helper.make_node(
        "Constant",
        [],
        ["sub_out"],
        value=helper.make_tensor("c2", TensorProto.FLOAT, [1], [2.0]),
    )
    else_graph = helper.make_graph([c2], "else_branch", [], [sub_out])

    if_node = helper.make_node(
        "If",
        ["cond"],
        ["output"],
        name="If_0",
        then_branch=then_graph,
        else_branch=else_graph,
    )
    graph = helper.make_graph([if_node], "if_graph", [cond], [y])
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)])
    onnx.checker.check_model(model)
    return model.SerializeToString()


@pytest.fixture
def local_function_model_bytes() -> bytes:
    """Generate an ONNX model containing local function definitions."""
    func_node = helper.make_node("Relu", ["X"], ["Y"])
    func = helper.make_function(
        "custom_domain",
        "MyFunc",
        ["X"],
        ["Y"],
        [func_node],
        [helper.make_opsetid("", 17)],
    )

    x = helper.make_tensor_value_info("in", TensorProto.FLOAT, [1])
    y = helper.make_tensor_value_info("out", TensorProto.FLOAT, [1])
    node = helper.make_node("MyFunc", ["in"], ["out"], name="FuncCall_0", domain="custom_domain")
    graph = helper.make_graph([node], "func_graph", [x], [y])
    model = helper.make_model(
        graph,
        opset_imports=[
            helper.make_opsetid("", 17),
            helper.make_opsetid("custom_domain", 1),
        ],
        functions=[func],
    )
    onnx.checker.check_model(model)
    return model.SerializeToString()


@pytest.fixture
def sparse_model_bytes() -> bytes:
    """Generate an ONNX model containing sparse initializers."""
    values = helper.make_tensor("values", TensorProto.FLOAT, [2], [1.0, 2.0])
    indices = helper.make_tensor("indices", TensorProto.INT64, [2], [0, 3])
    sparse = helper.make_sparse_tensor(values, indices, [4])

    x = helper.make_tensor_value_info("in", TensorProto.FLOAT, [4])
    y = helper.make_tensor_value_info("out", TensorProto.FLOAT, [4])
    node = helper.make_node("Identity", ["in"], ["out"], name="Id_0")
    graph = helper.make_graph([node], "sparse_graph", [x], [y], sparse_initializer=[sparse])
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)])
    onnx.checker.check_model(model)
    return model.SerializeToString()


@pytest.fixture
def sequence_io_model_bytes() -> bytes:
    """Generate an ONNX model with non-tensor (sequence) inputs and outputs."""
    seq_in = helper.make_tensor_sequence_value_info("seq_in", TensorProto.FLOAT, [1, 2])
    seq_out = helper.make_tensor_sequence_value_info("seq_out", TensorProto.FLOAT, [1, 2])
    node = helper.make_node("Identity", ["seq_in"], ["seq_out"], name="SeqId_0")
    graph = helper.make_graph([node], "seq_graph", [seq_in], [seq_out])
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)])
    onnx.checker.check_model(model)
    return model.SerializeToString()


@pytest.fixture
async def async_client() -> AsyncGenerator[AsyncClient, None]:
    """Async test client using httpx ASGITransport."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client
