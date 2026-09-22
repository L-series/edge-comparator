"""Versioned local compiler evidence; see Proposed ADR-0006."""

import hashlib
import json
from datetime import datetime
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from edge_comparator.models import ModelMetadata

OPENVINO_VERSION = "2026.4.0"
TELEMETRY_VERSION = "2025.2.0"
COMPILER_OPTIONS: dict[str, str | int] = {
    "INFERENCE_PRECISION_HINT": "f32",
    "INFERENCE_NUM_THREADS": 1,
    "NUM_STREAMS": 1,
    "PERFORMANCE_HINT": "LATENCY",
}

Hash = Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]
Outcome = Literal["compiled_unverified", "compile_failed", "inconclusive"]
Stage = Literal["environment", "import", "query", "compile", "worker"]
ArtifactName = Literal[
    "model.onnx", "worker.stdout.json", "worker.stderr.txt", "diagnostics.txt", "uv.lock"
]


class CompilerConfiguration(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    adapter: Literal["openvino-cpu"] = "openvino-cpu"
    adapter_version: Literal["1"] = "1"
    requested_version: str = Field(default=OPENVINO_VERSION, min_length=1)
    compiler_version: str | None = None
    compiler_build: str | None = None
    plugin_version: str | None = None
    device: Literal["CPU"] = "CPU"
    reader: Literal["onnx_frontend"] = "onnx_frontend"
    cpu_affinity: Literal["one_allowed_logical_cpu"] = "one_allowed_logical_cpu"
    device_name: str | None = None
    precision: Literal["f32"] = "f32"
    options: dict[str, str | int] = Field(default_factory=lambda: dict(COMPILER_OPTIONS))
    fallback_policy: Literal["none"] = "none"
    os: str
    architecture: str
    python_version: str
    worker_command: list[str] | None = None
    wall_time_limit_seconds: float | None = Field(default=None, gt=0)
    adapter_sha256: Hash
    dependency_lock_sha256: Hash
    container_digest: Annotated[str, Field(pattern=r"^sha256:[a-f0-9]{64}$")] | None = None
    telemetry: Literal["disabled"] = "disabled"

    @model_validator(mode="after")
    def fixed_configuration(self) -> Self:
        if self.options != COMPILER_OPTIONS:
            raise ValueError("Only the recorded CPU/f32 compiler options are supported")
        return self


def evaluation_key(model_sha256: str, configuration: CompilerConfiguration) -> str:
    payload = {"model_sha256": model_sha256, "configuration": configuration.model_dump(mode="json")}
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(canonical.encode()).hexdigest()


class QueryPlacement(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    name: str
    operation: str
    device: str | None


class CompilerObservation(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    status: Outcome
    stage: Stage
    model_sha256: Hash
    compiler_version: str | None = None
    compiler_build: str | None = None
    plugin_version: str | None = None
    device_name: str | None = None
    diagnostics: str = Field(default="", max_length=65_536)
    query_placements: list[QueryPlacement] = Field(default_factory=list, max_length=20_000)

    @model_validator(mode="after")
    def complete_observation(self) -> Self:
        if self.status == "compiled_unverified" and (
            self.stage != "compile"
            or self.compiler_version != OPENVINO_VERSION
            or not self.compiler_build
            or not self.plugin_version
            or not self.device_name
        ):
            raise ValueError(
                "Successful worker observation requires its exact compiler/device identity"
            )
        if self.status == "compile_failed" and (
            self.stage not in ("import", "query", "compile") or not self.diagnostics
        ):
            raise ValueError("Compiler rejection requires stage and diagnostics")
        return self


class EvidenceArtifact(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    name: ArtifactName
    sha256: Hash
    size_bytes: int = Field(ge=0)
    media_type: str


class CompilationRun(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    schema_version: Literal[1] = 1
    id: UUID
    created_at: datetime
    model: ModelMetadata
    target_id: Literal["intel-openvino-cpu"] = "intel-openvino-cpu"
    status: Outcome
    stage: Stage
    evidence_type: Literal["compiler_reported", "infrastructure_observed"]
    summary: str
    diagnostics: str = Field(default="", max_length=65_536)
    configuration: CompilerConfiguration
    evaluation_key: Hash
    placement_scope: Literal["openvino_imported_graph_query"] = "openvino_imported_graph_query"
    query_placements: list[QueryPlacement] = Field(default_factory=list, max_length=20_000)
    artifacts: list[EvidenceArtifact] = Field(default_factory=list, max_length=5)

    @model_validator(mode="after")
    def truthful_evidence(self) -> Self:
        if self.evaluation_key != evaluation_key(self.model.sha256, self.configuration):
            raise ValueError("Evaluation identity does not match the model and configuration")
        if self.status == "compiled_unverified" and (
            self.stage != "compile"
            or self.evidence_type != "compiler_reported"
            or not self.configuration.compiler_version
            or not self.configuration.compiler_build
        ):
            raise ValueError("Compilation success requires observed compiler identity and stage")
        if self.status == "compile_failed" and (
            self.stage not in ("import", "query", "compile")
            or self.evidence_type != "compiler_reported"
            or not self.diagnostics
        ):
            raise ValueError("Compiler rejection requires its actual stage and diagnostic")
        if self.created_at.tzinfo is None:
            raise ValueError("Evidence timestamps must be timezone-aware")
        if len({artifact.name for artifact in self.artifacts}) != len(self.artifacts):
            raise ValueError("Artifact names must be unique")
        return self


class RunSummary(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    id: UUID
    created_at: datetime
    model_sha256: Hash
    status: Outcome
    compiler_version: str | None
    device_name: str | None
    evaluation_key: Hash
    summary: str
