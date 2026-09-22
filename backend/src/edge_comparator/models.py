"""Pydantic schemas for the Edge-AI Comparator API contract."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

MAX_UPLOAD_BYTES = 16 * 1024 * 1024
MAX_METADATA_BYTES = 4 * 1024 * 1024


class HealthResponse(BaseModel):
    """Response schema for GET /api/health."""

    model_config = ConfigDict(extra="forbid")
    status: Literal["ok"] = "ok"


class TargetCatalogEntry(BaseModel):
    """Catalog entry schema for GET /api/targets."""

    model_config = ConfigDict(extra="forbid")
    id: str
    name: str
    vendor: str
    accelerator: str
    source_url: str
    configuration_status: Literal["catalog_only"] = "catalog_only"


class ModelInputOutput(BaseModel):
    """Schema for individual model input/output tensor."""

    model_config = ConfigDict(extra="forbid")
    name: str
    dtype: str
    shape: list[int | str | None]


class ModelOperation(BaseModel):
    """Schema for individual operator in graph node inventory."""

    model_config = ConfigDict(extra="forbid")
    index: int
    name: str
    domain: str
    op_type: str


class ModelMetadata(BaseModel):
    """Extracted ONNX model metadata and structural inventory."""

    model_config = ConfigDict(extra="forbid", strict=True)
    sha256: str
    format: Literal["onnx"] = "onnx"
    ir_version: int
    opsets: dict[str, int]
    inputs: list[ModelInputOutput]
    outputs: list[ModelInputOutput]
    operations: list[ModelOperation]
    node_count: int


class WorkerSuccess(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    status: Literal["success"] = "success"
    data: ModelMetadata


class WorkerRejection(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    status: Literal["rejected"] = "rejected"
    error: str = Field(min_length=1, max_length=1000)


WorkerResult = Annotated[WorkerSuccess | WorkerRejection, Field(discriminator="status")]


class InspectTargetResult(BaseModel):
    """Preflight target assessment result."""

    model_config = ConfigDict(extra="forbid")
    target_id: str
    status: Literal["not_tested"] = "not_tested"
    reason: str


class InspectResponse(BaseModel):
    """Full response schema for POST /api/inspect."""

    model_config = ConfigDict(extra="forbid")
    evidence_type: Literal["static_inferred"] = "static_inferred"
    stage: Literal["preflight"] = "preflight"
    model: ModelMetadata
    results: list[InspectTargetResult]
