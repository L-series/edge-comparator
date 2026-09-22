"""The evidence contract cannot promote compilation into measured acceleration."""

from datetime import UTC, datetime
from uuid import uuid4

import pytest
from pydantic import ValidationError

from edge_comparator.compilation_models import (
    CompilationRun,
    CompilerConfiguration,
    CompilerObservation,
    evaluation_key,
)
from edge_comparator.parser_worker import parse_and_validate


def configuration() -> CompilerConfiguration:
    return CompilerConfiguration(
        compiler_version="2026.4.0",
        compiler_build="test-build",
        device_name="Test CPU",
        os="Test Linux",
        architecture="x86_64",
        python_version="3.12.13",
        adapter_sha256="a" * 64,
        dependency_lock_sha256="b" * 64,
    )


def test_fingerprint_is_exact_and_configuration_sensitive() -> None:
    config = configuration()
    key = evaluation_key("c" * 64, config)
    assert key == evaluation_key("c" * 64, config)
    assert key != evaluation_key("d" * 64, config)
    changed = config.model_copy(update={"compiler_build": "another-build"})
    assert key != evaluation_key("c" * 64, changed)
    assert config.container_digest is None
    assert config.device == "CPU"
    assert config.fallback_policy == "none"


def test_compile_evidence_never_claims_acceleration(valid_relu_model_bytes: bytes) -> None:
    parsed = parse_and_validate(valid_relu_model_bytes)
    assert parsed.status == "success"
    config = configuration()
    run = CompilationRun(
        id=uuid4(),
        created_at=datetime.now(UTC),
        model=parsed.data,
        status="compiled_unverified",
        stage="compile",
        evidence_type="compiler_reported",
        summary="CPU compilation completed; execution is unverified.",
        configuration=config,
        evaluation_key=evaluation_key(parsed.data.sha256, config),
    )
    assert CompilationRun.model_validate_json(run.model_dump_json()) == run
    data = run.model_dump()
    for status in ("fully_accelerated", "measured", "success"):
        with pytest.raises(ValidationError):
            CompilationRun.model_validate({**data, "status": status})
    with pytest.raises(ValidationError):
        CompilationRun.model_validate({**data, "stage": "import"})
    with pytest.raises(ValidationError):
        CompilationRun.model_validate({**data, "evaluation_key": "0" * 64})


def test_worker_cannot_claim_success_without_compiler_identity() -> None:
    with pytest.raises(ValidationError):
        CompilerObservation(
            status="compiled_unverified", stage="environment", model_sha256="a" * 64
        )


def test_configuration_rejects_unrecorded_options_and_fake_image_digest() -> None:
    original = configuration().model_dump()
    for changes in (
        {"options": {"NUM_STREAMS": 4}},
        {"container_digest": "latest"},
        {"container_digest": "sha256:not-a-digest"},
    ):
        with pytest.raises(ValidationError):
            CompilerConfiguration.model_validate(original | changes)
