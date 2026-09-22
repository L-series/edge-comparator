"""Tiny original ONNX fixtures, without external weights or downloads."""

from onnx import TensorProto, helper


def make_demo(name: str) -> bytes:
    inputs = [helper.make_tensor_value_info("image", TensorProto.FLOAT, [1, 3, 16, 16])]
    if name == "supported-cnn":
        nodes = [
            helper.make_node("Conv", ["image", "kernel"], ["conv"], name="convolution"),
            helper.make_node("Relu", ["conv"], ["relu"], name="activation"),
            helper.make_node("GlobalAveragePool", ["relu"], ["pooled"], name="pooling"),
            helper.make_node("Flatten", ["pooled"], ["features"], name="flatten"),
            helper.make_node("Gemm", ["features", "weights"], ["scores"], name="classifier"),
        ]
        initializers = [
            helper.make_tensor("kernel", TensorProto.FLOAT, [4, 3, 3, 3], [0.125] * 108),
            helper.make_tensor("weights", TensorProto.FLOAT, [4, 2], [0.25] * 8),
        ]
        outputs = [helper.make_tensor_value_info("scores", TensorProto.FLOAT, [1, 2])]
        opsets = [helper.make_opsetid("", 17)]
    elif name == "unsupported-op":
        nodes = [
            helper.make_node(
                "MysteryActivation", ["image"], ["scores"], name="custom", domain="com.edge.demo"
            )
        ]
        initializers = []
        outputs = [helper.make_tensor_value_info("scores", TensorProto.FLOAT, [1, 3, 16, 16])]
        opsets = [helper.make_opsetid("", 17), helper.make_opsetid("com.edge.demo", 1)]
    else:
        raise ValueError(f"Unknown generated demo: {name}")
    graph = helper.make_graph(nodes, name, inputs, outputs, initializer=initializers)
    model = helper.make_model(
        graph, opset_imports=opsets, ir_version=9, producer_name="edge-comparator-demo"
    )
    return model.SerializeToString()
