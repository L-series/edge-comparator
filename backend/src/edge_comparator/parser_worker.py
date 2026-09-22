"""Flat ONNX inspection; the executable entrypoint applies Linux resource limits."""

from __future__ import annotations

import hashlib
import sys
from typing import TYPE_CHECKING, NoReturn

from edge_comparator.models import (
    MAX_METADATA_BYTES,
    MAX_UPLOAD_BYTES,
    ModelInputOutput,
    ModelMetadata,
    ModelOperation,
    WorkerRejection,
    WorkerResult,
    WorkerSuccess,
)

if TYPE_CHECKING:
    import onnx


class PreviewRejected(ValueError):
    """An invalid model or explicitly unsupported preview ingestion construct."""


def _apply_resource_limits() -> None:
    if sys.platform != "linux":
        raise RuntimeError("The resource-bounded parser requires Linux")
    import resource

    resource.setrlimit(resource.RLIMIT_CPU, (10, 15))
    memory = 1024 * 1024 * 1024
    resource.setrlimit(resource.RLIMIT_AS, (memory, memory))
    resource.setrlimit(resource.RLIMIT_FSIZE, (0, 0))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))


def _extract_shape(tensor: onnx.TypeProto.Tensor) -> list[int | str | None]:
    if not tensor.HasField("shape"):
        raise PreviewRejected("Unknown tensor rank is an unsupported preview ingestion limitation")
    return [
        dimension.dim_value
        if dimension.HasField("dim_value")
        else dimension.dim_param
        if dimension.HasField("dim_param") and dimension.dim_param
        else None
        for dimension in tensor.shape.dim
    ]


def _tensor_info(value: onnx.ValueInfoProto) -> ModelInputOutput:
    import onnx

    if not value.type.HasField("tensor_type"):
        raise PreviewRejected("Non-tensor input/output is a preview ingestion limitation")
    tensor = value.type.tensor_type
    if tensor.elem_type == onnx.TensorProto.UNDEFINED:
        raise PreviewRejected("Undefined tensor element type is a preview ingestion limitation")
    try:
        dtype = onnx.TensorProto.DataType.Name(tensor.elem_type)
    except ValueError as exc:
        raise PreviewRejected(
            "Unrecognized tensor datatype is a preview ingestion limitation"
        ) from exc
    return ModelInputOutput(name=value.name, dtype=dtype, shape=_extract_shape(tensor))


def _reject_external(tensor: onnx.TensorProto) -> None:
    import onnx

    if tensor.data_location == onnx.TensorProto.EXTERNAL or tensor.external_data:
        raise PreviewRejected("External tensor data references are a preview ingestion limitation")


def _inspect(raw_bytes: bytes) -> ModelMetadata:
    import onnx
    from google.protobuf.message import DecodeError

    if not raw_bytes:
        raise PreviewRejected("Model payload is empty (0 bytes)")
    if len(raw_bytes) > MAX_UPLOAD_BYTES:
        raise PreviewRejected("Model payload exceeds the 16 MiB preview ingestion limit")
    try:
        model = onnx.load_model_from_string(raw_bytes)
    except DecodeError as exc:
        raise PreviewRejected("Failed to deserialize ONNX model") from exc

    if len(model.graph.node) > 10_000:
        raise PreviewRejected("Node count exceeds maximum limit of 10000")
    if model.functions:
        raise PreviewRejected("Local function bodies are a preview ingestion limitation")
    if model.training_info:
        raise PreviewRejected("Training graphs are a preview ingestion limitation")
    if model.graph.sparse_initializer:
        raise PreviewRejected("Sparse initializers are a preview ingestion limitation")
    for tensor in model.graph.initializer:
        _reject_external(tensor)
    for node in model.graph.node:
        for attribute in node.attribute:
            if (
                attribute.type in (onnx.AttributeProto.GRAPH, onnx.AttributeProto.GRAPHS)
                or attribute.HasField("g")
                or attribute.graphs
            ):
                raise PreviewRejected("Nested graphs are a preview ingestion limitation")
            if (
                attribute.type
                in (onnx.AttributeProto.SPARSE_TENSOR, onnx.AttributeProto.SPARSE_TENSORS)
                or attribute.HasField("sparse_tensor")
                or attribute.sparse_tensors
            ):
                raise PreviewRejected("Sparse tensor attributes are a preview ingestion limitation")
            if attribute.HasField("t"):
                _reject_external(attribute.t)
            for tensor in attribute.tensors:
                _reject_external(tensor)

    inputs = [_tensor_info(value) for value in model.graph.input]
    outputs = [_tensor_info(value) for value in model.graph.output]
    try:
        onnx.checker.check_model(model, full_check=False)
    except onnx.checker.ValidationError as exc:
        raise PreviewRejected(f"ONNX validation failed: {str(exc)[:200]}") from exc

    opsets: dict[str, int] = {}
    for opset in model.opset_import:
        if opset.domain in opsets:
            raise PreviewRejected("Duplicate opset declarations are a preview ingestion limitation")
        opsets[opset.domain] = opset.version
    return ModelMetadata(
        sha256=hashlib.sha256(raw_bytes).hexdigest(),
        ir_version=model.ir_version,
        opsets=opsets,
        inputs=inputs,
        outputs=outputs,
        operations=[
            ModelOperation(index=index, name=node.name, domain=node.domain, op_type=node.op_type)
            for index, node in enumerate(model.graph.node)
        ],
        node_count=len(model.graph.node),
    )


def parse_and_validate(raw_bytes: bytes) -> WorkerResult:
    try:
        return WorkerSuccess(data=_inspect(raw_bytes))
    except PreviewRejected as exc:
        return WorkerRejection(error=str(exc))


def main() -> NoReturn:
    _apply_resource_limits()
    result = parse_and_validate(sys.stdin.buffer.read(MAX_UPLOAD_BYTES + 1))
    output = result.model_dump_json()
    if len(output.encode("utf-8")) > MAX_METADATA_BYTES:
        output = WorkerRejection(
            error="Metadata exceeds the preview response limit"
        ).model_dump_json()
    sys.stdout.write(output)
    sys.stdout.flush()
    sys.exit(0)


if __name__ == "__main__":
    main()
