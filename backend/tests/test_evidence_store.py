"""Tests for RunStore and compilation evidence persistence."""

import hashlib
import json
import os
import stat
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import patch
from uuid import UUID, uuid4

import pytest

from edge_comparator.compilation_models import (
    COMPILER_OPTIONS,
    ArtifactName,
    CompilationRun,
    CompilerConfiguration,
    Outcome,
    QueryPlacement,
    Stage,
    evaluation_key,
)
from edge_comparator.evidence_store import (
    RunNotFound,
    RunStore,
    StoreCapacityError,
    StoreCorruptionError,
    StoreError,
    StoreSecurityError,
    default_evidence_root,
)
from edge_comparator.models import ModelInputOutput, ModelMetadata, ModelOperation


def make_test_run(
    run_id: UUID | None = None,
    model_bytes: bytes = b"tiny_test_onnx_model_payload_for_testing",
    status: Outcome = "compiled_unverified",
    stage: Stage = "compile",
    compiler_version: str | None = "2026.4.0",
    compiler_build: str | None = "2026.4.0-18123",
    diagnostics: str = "",
) -> tuple[CompilationRun, dict[ArtifactName, bytes]]:
    """Helper to create a valid CompilationRun and matching 5 artifacts."""
    sha256 = hashlib.sha256(model_bytes).hexdigest()
    uv_lock_bytes = b"# locked dependencies\n"
    dep_lock_sha = hashlib.sha256(uv_lock_bytes).hexdigest()
    diag_text = (
        diagnostics
        if diagnostics
        else ("Compiled successfully" if status == "compiled_unverified" else "Compilation error")
    )
    model_meta = ModelMetadata(
        sha256=sha256,
        format="onnx",
        ir_version=8,
        opsets={"": 17},
        inputs=[ModelInputOutput(name="input", dtype="FLOAT", shape=[1, 3, 224, 224])],
        outputs=[ModelInputOutput(name="output", dtype="FLOAT", shape=[1, 3, 224, 224])],
        operations=[ModelOperation(index=0, name="Relu_0", domain="", op_type="Relu")],
        node_count=1,
    )
    config = CompilerConfiguration(
        adapter="openvino-cpu",
        adapter_version="1",
        requested_version="2026.4.0",
        compiler_version=compiler_version,
        compiler_build=compiler_build,
        plugin_version="2026.4.0",
        device="CPU",
        device_name="Intel(R) Core(TM) i7-1185G7 @ 3.00GHz",
        precision="f32",
        options=dict(COMPILER_OPTIONS),
        fallback_policy="none",
        os="linux",
        architecture="x86_64",
        python_version="3.12.13",
        adapter_sha256="a" * 64,
        dependency_lock_sha256=dep_lock_sha,
        container_digest=None,
        telemetry="disabled",
    )
    eval_key = evaluation_key(sha256, config)
    run = CompilationRun(
        schema_version=1,
        id=run_id or uuid4(),
        created_at=datetime.now(UTC),
        model=model_meta,
        target_id="intel-openvino-cpu",
        status=status,
        stage=stage,
        evidence_type="compiler_reported",
        summary="Local CPU compilation evidence",
        diagnostics=diag_text,
        configuration=config,
        evaluation_key=eval_key,
        placement_scope="openvino_imported_graph_query",
        query_placements=[QueryPlacement(name="Relu_0", operation="Relu", device="CPU")],
        artifacts=[],
    )
    artifacts: dict[ArtifactName, bytes] = {
        "model.onnx": model_bytes,
        "worker.stdout.json": b'{"status": "ok", "imported_nodes": 1}',
        "worker.stderr.txt": b"",
        "diagnostics.txt": diag_text.encode("utf-8"),
        "uv.lock": uv_lock_bytes,
    }
    return run, artifacts


def test_private_root_created_with_0700_permissions(tmp_path: Path) -> None:
    """When the root directory does not exist, it is created with 0700 permissions."""
    store_root = tmp_path / "evidence_root"
    assert not store_root.exists()
    store = RunStore(root=store_root)
    assert store.root.exists()
    mode = stat.S_IMODE(store.root.stat().st_mode)
    assert mode == 0o700


def test_rejects_existing_symlink_root(tmp_path: Path) -> None:
    """Store rejects an existing root that is a symlink."""
    target_dir = tmp_path / "actual_dir"
    target_dir.mkdir(mode=0o700)
    symlink_dir = tmp_path / "symlink_dir"
    symlink_dir.symlink_to(target_dir)

    with pytest.raises(StoreSecurityError, match="symlink"):
        RunStore(root=symlink_dir)


def test_rejects_existing_nonprivate_root(tmp_path: Path) -> None:
    """Store rejects an existing root that has non-private permissions without chmod-ing it."""
    store_root = tmp_path / "open_dir"
    store_root.mkdir(mode=0o755)
    os.chmod(store_root, 0o755)  # noqa: S103

    with pytest.raises(StoreSecurityError, match="non-private"):
        RunStore(root=store_root)

    # Verify no accidental chmod was performed
    assert stat.S_IMODE(store_root.stat().st_mode) == 0o755


def test_rejects_foreign_owner_root(tmp_path: Path) -> None:
    """Store rejects root if owned by a foreign user."""
    store_root = tmp_path / "store_root"
    store_root.mkdir(mode=0o700)

    with (
        patch("os.getuid", return_value=12345),
        pytest.raises(StoreSecurityError, match="owned by current user"),
    ):
        RunStore(root=store_root)


def test_save_and_get_success(tmp_path: Path) -> None:
    """Happy path: save a run and retrieve it, verifying manifest, files, hashes, permissions."""
    store = RunStore(root=tmp_path / "store")
    run, artifacts = make_test_run()

    saved_run = store.save(run, artifacts)
    assert saved_run.id == run.id
    assert len(saved_run.artifacts) == 5

    # Verify each artifact record
    artifact_names = {a.name for a in saved_run.artifacts}
    assert artifact_names == {
        "model.onnx",
        "worker.stdout.json",
        "worker.stderr.txt",
        "diagnostics.txt",
        "uv.lock",
    }
    for a in saved_run.artifacts:
        assert a.sha256 == hashlib.sha256(artifacts[a.name]).hexdigest()
        assert a.size_bytes == len(artifacts[a.name])

    # Check directory and file permissions
    run_dir = store.root / str(run.id)
    assert run_dir.exists()
    assert stat.S_IMODE(run_dir.stat().st_mode) == 0o700

    for item in run_dir.iterdir():
        assert stat.S_IMODE(item.stat().st_mode) == 0o600

    # Verify report.json exists and is not listed in self-artifacts
    report_path = run_dir / "report.json"
    assert report_path.exists()
    assert "report.json" not in artifact_names

    # Retrieve and compare
    retrieved = store.get(run.id)
    assert retrieved.id == run.id
    assert retrieved.evaluation_key == run.evaluation_key
    assert retrieved.model.sha256 == run.model.sha256
    assert len(retrieved.artifacts) == 5


def test_save_rejects_original_hash_mismatch(tmp_path: Path) -> None:
    """Save fails when model.onnx bytes do not match run.model.sha256."""
    store = RunStore(root=tmp_path / "store")
    run, artifacts = make_test_run()
    artifacts["model.onnx"] = b"tampered_model_bytes_that_do_not_match_sha256"

    with pytest.raises(StoreCorruptionError, match="hash"):
        store.save(run, artifacts)

    assert not (store.root / str(run.id)).exists()


def test_save_rejects_missing_or_extra_artifacts(tmp_path: Path) -> None:
    """Store requires all 5 exact artifacts, refusing missing or extra keys."""
    store = RunStore(root=tmp_path / "store")
    run, artifacts = make_test_run()

    incomplete = dict(artifacts)
    del incomplete["uv.lock"]
    with pytest.raises(StoreError, match="artifacts"):
        store.save(run, incomplete)

    extra: dict[str, bytes] = {str(k): v for k, v in artifacts.items()}
    extra["extra.bin"] = b"unexpected"
    with pytest.raises(StoreError, match="artifacts"):
        store.save(run, extra)


def test_save_rejects_overwrite_same_uuid(tmp_path: Path) -> None:
    """Refuse overwriting an existing run UUID."""
    store = RunStore(root=tmp_path / "store")
    run, artifacts = make_test_run()

    store.save(run, artifacts)
    with pytest.raises(StoreError, match="already exists"):
        store.save(run, artifacts)


def test_restart_persistence_new_store_instance(tmp_path: Path) -> None:
    """Data saved by one RunStore instance is readable by a fresh RunStore instance."""
    root = tmp_path / "store"
    store1 = RunStore(root=root)
    run, artifacts = make_test_run()
    store1.save(run, artifacts)

    store2 = RunStore(root=root)
    retrieved = store2.get(run.id)
    assert retrieved.id == run.id
    assert len(retrieved.artifacts) == 5
    assert len(store2.list_runs()) == 1


def test_downloadable_artifact_path(tmp_path: Path) -> None:
    """artifact_path provides validated paths to allowlisted artifacts."""
    store = RunStore(root=tmp_path / "store")
    run, artifacts = make_test_run()
    store.save(run, artifacts)

    for name in artifacts:
        path = store.artifact_path(run.id, name)
        assert path.exists()
        assert path.read_bytes() == artifacts[name]

    # Reject non-allowlisted name
    with pytest.raises(StoreError, match="artifact name"):
        store.artifact_path(run.id, "report.json")

    with pytest.raises(StoreError, match="artifact name"):
        store.artifact_path(run.id, "unauthorized.bin")


def test_delete_only_selected_run(tmp_path: Path) -> None:
    """Deleting a run removes only that run and preserves other runs."""
    store = RunStore(root=tmp_path / "store")
    run1, artifacts1 = make_test_run()
    run2, artifacts2 = make_test_run()

    store.save(run1, artifacts1)
    store.save(run2, artifacts2)
    assert len(store.list_runs()) == 2

    store.delete(run1.id)

    with pytest.raises(RunNotFound):
        store.get(run1.id)

    # run2 remains intact
    assert store.get(run2.id).id == run2.id
    runs = store.list_runs()
    assert len(runs) == 1
    assert runs[0].id == run2.id


def test_delete_nonexistent_run(tmp_path: Path) -> None:
    """Deleting a nonexistent UUID raises RunNotFound."""
    store = RunStore(root=tmp_path / "store")
    with pytest.raises(RunNotFound):
        store.delete(uuid4())


def test_delete_corrupt_owned_run(tmp_path: Path) -> None:
    """Corrupted owned run can be safely deleted."""
    store = RunStore(root=tmp_path / "store")
    run, artifacts = make_test_run()
    store.save(run, artifacts)

    # Corrupt report.json
    report_file = store.root / str(run.id) / "report.json"
    report_file.write_text("corrupted non-json content")

    # get() fails due to corruption
    with pytest.raises(StoreCorruptionError):
        store.get(run.id)

    # delete() successfully cleans it up
    store.delete(run.id)
    assert not (store.root / str(run.id)).exists()


def test_delete_refuses_symlink_in_run(tmp_path: Path) -> None:
    """Refuse to delete run directory if it contains a symlink to prevent escaping."""
    store = RunStore(root=tmp_path / "store")
    run, artifacts = make_test_run()
    store.save(run, artifacts)

    # Create a symlink inside the run directory pointing outside
    external_file = tmp_path / "important_external_file.txt"
    external_file.write_text("critical data")
    run_dir = store.root / str(run.id)
    (run_dir / "link_out").symlink_to(external_file)

    with pytest.raises(StoreSecurityError, match="symlink"):
        store.delete(run.id)

    # External file remains intact
    assert external_file.exists()


def test_quota_max_runs_exceeded(tmp_path: Path) -> None:
    """Store raises StoreCapacityError when max_runs is exceeded."""
    store = RunStore(root=tmp_path / "store", max_runs=2)
    run1, artifacts1 = make_test_run()
    run2, artifacts2 = make_test_run()
    run3, artifacts3 = make_test_run()

    store.save(run1, artifacts1)
    store.save(run2, artifacts2)

    with pytest.raises(StoreCapacityError, match="runs limit"):
        store.save(run3, artifacts3)


def test_quota_max_bytes_exceeded_by_new_run(tmp_path: Path) -> None:
    """Store raises StoreCapacityError when a single new run exceeds max_bytes."""
    # 100 bytes max capacity
    store = RunStore(root=tmp_path / "store", max_bytes=100)
    run, artifacts = make_test_run()

    with pytest.raises(StoreCapacityError, match="bytes limit"):
        store.save(run, artifacts)


def test_quota_max_bytes_aggregate(tmp_path: Path) -> None:
    """Store raises StoreCapacityError when aggregate bytes exceed max_bytes."""
    run1, artifacts1 = make_test_run()
    run2, artifacts2 = make_test_run()

    # Pre-calculate approximate run size (around 1-2KB per run with report)
    store_probe = RunStore(root=tmp_path / "probe")
    store_probe.save(run1, artifacts1)
    report_size = (store_probe.root / str(run1.id) / "report.json").stat().st_size
    one_run_size = sum(len(b) for b in artifacts1.values()) + report_size

    # Cap to exactly 1.5 runs of bytes
    store = RunStore(root=tmp_path / "store", max_bytes=int(one_run_size * 1.5))
    store.save(run1, artifacts1)

    with pytest.raises(StoreCapacityError, match="bytes limit"):
        store.save(run2, artifacts2)


def test_list_runs_fails_if_too_many_runs(tmp_path: Path) -> None:
    """list_runs fails if externally modified to contain more runs than max_runs."""
    store = RunStore(root=tmp_path / "store", max_runs=1)
    run1, artifacts1 = make_test_run()
    run2, artifacts2 = make_test_run()

    # Save run1 with high limit
    store_permissive = RunStore(root=tmp_path / "store", max_runs=10)
    store_permissive.save(run1, artifacts1)
    store_permissive.save(run2, artifacts2)

    # Restrictive store should fail on list_runs rather than silently truncating
    with pytest.raises(StoreCapacityError, match="exceeding maximum"):
        store.list_runs()


def test_list_runs_newest_first(tmp_path: Path) -> None:
    """list_runs returns runs ordered newest first by created_at."""
    store = RunStore(root=tmp_path / "store")
    run1, artifacts1 = make_test_run()
    run2, artifacts2 = make_test_run()

    # Set distinct timestamps
    run1 = run1.model_copy(update={"created_at": datetime(2026, 9, 22, 10, 0, 0, tzinfo=UTC)})
    run2 = run2.model_copy(update={"created_at": datetime(2026, 9, 22, 12, 0, 0, tzinfo=UTC)})

    store.save(run1, artifacts1)
    store.save(run2, artifacts2)

    runs = store.list_runs()
    assert len(runs) == 2
    assert runs[0].id == run2.id
    assert runs[1].id == run1.id


def test_publication_failure_cleanup(tmp_path: Path) -> None:
    """When os.replace fails during publish, staging is cleaned up and StoreError raised."""
    store = RunStore(root=tmp_path / "store")
    run, artifacts = make_test_run()

    with (
        patch("os.replace", side_effect=OSError("Atomic replace disk failure")),
        pytest.raises(StoreError, match="Failed to publish"),
    ):
        store.save(run, artifacts)

    assert not (store.root / str(run.id)).exists()
    # Ensure no leftover staging directories
    staging_dirs = [d for d in store.root.iterdir() if d.name.startswith(".staging-")]
    assert len(staging_dirs) == 0


def test_tampered_artifact_hash_detection(tmp_path: Path) -> None:
    """get() detects and rejects artifact tampering where hash does not match."""
    store = RunStore(root=tmp_path / "store")
    run, artifacts = make_test_run()
    store.save(run, artifacts)

    # Tamper with diagnostics.txt with exact same byte length to trigger hash mismatch
    diag_file = store.root / str(run.id) / "diagnostics.txt"
    original_len = len(artifacts["diagnostics.txt"])
    diag_file.write_bytes(b"X" * original_len)

    with pytest.raises(StoreCorruptionError, match="hash mismatch"):
        store.get(run.id)


def test_tampered_artifact_size_detection(tmp_path: Path) -> None:
    """get() detects and rejects artifact tampering where size does not match."""
    store = RunStore(root=tmp_path / "store")
    run, artifacts = make_test_run()
    store.save(run, artifacts)

    # Truncate worker.stderr.txt
    stderr_file = store.root / str(run.id) / "worker.stderr.txt"
    stderr_file.write_bytes(b"extra bytes added")

    with pytest.raises(StoreCorruptionError, match="size"):
        store.get(run.id)


def test_missing_artifact_file_detection(tmp_path: Path) -> None:
    """get() detects when an artifact file was deleted from disk."""
    store = RunStore(root=tmp_path / "store")
    run, artifacts = make_test_run()
    store.save(run, artifacts)

    uv_file = store.root / str(run.id) / "uv.lock"
    uv_file.unlink()

    with pytest.raises(StoreCorruptionError, match="missing|Corrupt"):
        store.get(run.id)


def test_unexpected_extra_file_in_run_dir(tmp_path: Path) -> None:
    """get() detects unexpected rogue files inside the run directory."""
    store = RunStore(root=tmp_path / "store")
    run, artifacts = make_test_run()
    store.save(run, artifacts)

    rogue_file = store.root / str(run.id) / "rogue.sh"
    rogue_file.write_bytes(b"echo pwned")

    with pytest.raises(StoreCorruptionError, match="Corrupt"):
        store.get(run.id)


def test_symlink_inside_run_dir_rejected(tmp_path: Path) -> None:
    """get() detects and rejects symlinks inside run directory."""
    store = RunStore(root=tmp_path / "store")
    run, artifacts = make_test_run()
    store.save(run, artifacts)

    # Replace diagnostics.txt with a symlink
    diag_file = store.root / str(run.id) / "diagnostics.txt"
    diag_file.unlink()
    target = tmp_path / "secret.txt"
    target.write_text("sensitive")
    diag_file.symlink_to(target)

    with pytest.raises(StoreSecurityError, match="symlink"):
        store.get(run.id)


def test_traversal_uuid_type_guard(tmp_path: Path) -> None:
    """Ensure non-UUID types and traversal inputs are strictly rejected."""
    store = RunStore(root=tmp_path / "store")
    bad_input: object = "../etc/passwd"

    with pytest.raises(StoreError, match="UUID"):
        store.get(bad_input)

    with pytest.raises(StoreError, match="UUID"):
        store.delete(bad_input)

    with pytest.raises(StoreError, match="UUID"):
        store.artifact_path(bad_input, "model.onnx")


def test_report_identity_mismatch_detected(tmp_path: Path) -> None:
    """get() detects when report.json UUID does not match directory UUID."""
    store = RunStore(root=tmp_path / "store")
    run, artifacts = make_test_run()
    store.save(run, artifacts)

    # Overwrite report.json with a different UUID
    report_file = store.root / str(run.id) / "report.json"
    data = json.loads(report_file.read_text())
    data["id"] = str(uuid4())
    report_file.write_text(json.dumps(data))

    with pytest.raises(StoreCorruptionError, match="UUID"):
        store.get(run.id)


def test_compiled_status_validation_truthful_evidence() -> None:
    """CompilationRun validator rejects compiled_unverified without compiler build."""
    with pytest.raises(ValueError, match="Compilation success requires observed compiler identity"):
        make_test_run(compiler_build=None)


def test_default_evidence_root(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """Verify default_evidence_root uses ENV when set or fallback to user home."""
    custom_dir = str(tmp_path / "custom_evidence")
    monkeypatch.setenv("EDGE_COMPARATOR_DATA_DIR", custom_dir)
    assert default_evidence_root() == Path(custom_dir)

    monkeypatch.delenv("EDGE_COMPARATOR_DATA_DIR", raising=False)
    expected_home = Path.home() / ".local" / "share" / "edge-comparator" / "evidence"
    assert default_evidence_root() == expected_home


def test_init_invalid_capacities(tmp_path: Path) -> None:
    """Store constructor rejects max_runs < 1 or max_bytes < 1."""
    with pytest.raises(ValueError, match="max_runs"):
        RunStore(root=tmp_path / "store1", max_runs=0)

    with pytest.raises(ValueError, match="max_bytes"):
        RunStore(root=tmp_path / "store2", max_bytes=0)


def test_init_rejects_file_as_root(tmp_path: Path) -> None:
    """Store rejects root path if it is an existing regular file."""
    file_root = tmp_path / "file_as_root"
    file_root.write_text("not a directory")
    with pytest.raises(StoreSecurityError, match="not a directory"):
        RunStore(root=file_root)


def test_get_run_foreign_owner(tmp_path: Path) -> None:
    """get() rejects a run directory owned by a different UID."""
    store = RunStore(root=tmp_path / "store")
    run, artifacts = make_test_run()
    store.save(run, artifacts)

    with (
        patch("os.getuid", return_value=99999),
        pytest.raises(StoreSecurityError, match="not owned by current user"),
    ):
        store.get(run.id)


def test_get_run_nonprivate_permissions(tmp_path: Path) -> None:
    """get() rejects a run directory with non-private permissions."""
    store = RunStore(root=tmp_path / "store")
    run, artifacts = make_test_run()
    store.save(run, artifacts)

    run_dir = store.root / str(run.id)
    os.chmod(run_dir, 0o755)  # noqa: S103

    with pytest.raises(StoreSecurityError, match="non-private"):
        store.get(run.id)


def test_get_file_nonprivate_permissions(tmp_path: Path) -> None:
    """get() rejects an artifact file with non-private permissions."""
    store = RunStore(root=tmp_path / "store")
    run, artifacts = make_test_run()
    store.save(run, artifacts)

    artifact_file = store.root / str(run.id) / "model.onnx"
    os.chmod(artifact_file, 0o644)  # noqa: S103

    with pytest.raises(StoreSecurityError, match="non-private"):
        store.get(run.id)


def test_get_file_exceeds_store_capacity(tmp_path: Path) -> None:
    """get() rejects an artifact file whose size exceeds the store capacity."""
    store_normal = RunStore(root=tmp_path / "store")
    run, artifacts = make_test_run()
    store_normal.save(run, artifacts)

    store_restrictive = RunStore(root=tmp_path / "store", max_bytes=10)
    with pytest.raises(StoreCorruptionError, match="capacity"):
        store_restrictive.get(run.id)


def test_get_tampered_manifest_artifacts(tmp_path: Path) -> None:
    """get() rejects manifests with missing or extra artifact keys."""
    store = RunStore(root=tmp_path / "store")
    run, artifacts = make_test_run()
    store.save(run, artifacts)

    report_file = store.root / str(run.id) / "report.json"
    data = json.loads(report_file.read_text())

    # Case 1: only 4 artifacts listed
    data["artifacts"] = data["artifacts"][:4]
    report_file.write_text(json.dumps(data))
    with pytest.raises(StoreCorruptionError, match="manifest contains 4 artifacts"):
        store.get(run.id)

    # Case 2: invalid schema in report.json
    data["schema_version"] = 999
    report_file.write_text(json.dumps(data))
    with pytest.raises(StoreCorruptionError, match="Invalid CompilationRun schema"):
        store.get(run.id)


def test_get_eval_key_and_model_hash_mismatch(tmp_path: Path) -> None:
    """get() validates model sha256 consistency with artifacts."""
    store = RunStore(root=tmp_path / "store")
    run, artifacts = make_test_run()
    store.save(run, artifacts)

    report_file = store.root / str(run.id) / "report.json"
    data = json.loads(report_file.read_text())

    # Tamper model.sha256 with recomputed evaluation_key to trigger model.onnx hash mismatch
    fake_sha = "1" * 64
    data["model"]["sha256"] = fake_sha
    config = CompilerConfiguration.model_validate(data["configuration"])
    data["evaluation_key"] = evaluation_key(fake_sha, config)
    report_file.write_text(json.dumps(data))

    with pytest.raises(StoreCorruptionError, match="model.onnx hash .* does not match"):
        store.get(run.id)


def test_list_runs_security_and_corruption_checks(tmp_path: Path) -> None:
    """list_runs rejects symlinks, non-directories, and non-UUID directories."""
    store = RunStore(root=tmp_path / "store")
    run, artifacts = make_test_run()
    store.save(run, artifacts)

    # Symlink in root
    symlink_entry = store.root / "symlink_entry"
    symlink_entry.symlink_to(tmp_path)
    with pytest.raises(StoreSecurityError, match="Symlink"):
        store.list_runs()
    symlink_entry.unlink()

    # File in root
    file_entry = store.root / "rogue_file.txt"
    file_entry.write_text("hello")
    with pytest.raises(StoreCorruptionError, match="Unexpected non-directory"):
        store.list_runs()
    file_entry.unlink()

    # Non-UUID directory in root
    bad_dir = store.root / "not_a_valid_uuid"
    bad_dir.mkdir(mode=0o700)
    with pytest.raises(StoreCorruptionError, match="Non-UUID entry"):
        store.list_runs()
    bad_dir.rmdir()


def test_delete_security_boundaries(tmp_path: Path) -> None:
    """delete() validates file types, foreign ownership, and internal subdirs."""
    store = RunStore(root=tmp_path / "store")
    run, artifacts = make_test_run()
    store.save(run, artifacts)

    # Foreign ownership on run directory
    with (
        patch("os.getuid", return_value=99999),
        pytest.raises(StoreSecurityError, match="not owned by current user"),
    ):
        store.delete(run.id)

    # Unexpected directory inside run_dir
    subdir = store.root / str(run.id) / "nested_dir"
    subdir.mkdir(mode=0o700)
    with pytest.raises(StoreSecurityError, match="unexpected directory"):
        store.delete(run.id)
    subdir.rmdir()

    # Non-directory run_dir path
    fake_id = uuid4()
    file_path = store.root / str(fake_id)
    file_path.write_text("not a dir")
    with pytest.raises(StoreSecurityError, match="non-directory"):
        store.delete(fake_id)
    file_path.unlink()


def test_get_total_bytes_security_and_corruption(tmp_path: Path) -> None:
    """_get_total_bytes validates root entries and run children."""
    store = RunStore(root=tmp_path / "store")
    run, artifacts = make_test_run()
    store.save(run, artifacts)

    # Symlink in store root
    symlink_entry = store.root / "symlink_root"
    symlink_entry.symlink_to(tmp_path)
    with pytest.raises(StoreSecurityError, match="Symlink found"):
        store._get_total_bytes()
    symlink_entry.unlink()

    # Non-directory in store root
    file_entry = store.root / "file_root"
    file_entry.write_text("file")
    with pytest.raises(StoreCorruptionError, match="Unexpected non-directory"):
        store._get_total_bytes()
    file_entry.unlink()

    # Symlink inside run dir
    run_dir = store.root / str(run.id)
    symlink_inside = run_dir / "symlink_inside"
    symlink_inside.symlink_to(tmp_path)
    with pytest.raises(StoreSecurityError, match="is a symlink"):
        store._get_total_bytes()
    symlink_inside.unlink()


def test_delete_foreign_owned_file_inside_run(tmp_path: Path) -> None:
    """delete() refuses to delete files inside run directory not owned by user."""
    store = RunStore(root=tmp_path / "store")
    run, artifacts = make_test_run()
    store.save(run, artifacts)

    def mock_lstat(path_obj: Path) -> os.stat_result:
        st = os.stat(path_obj, follow_symlinks=False)
        if path_obj.name == "model.onnx":
            return os.stat_result(
                (
                    st.st_mode,
                    st.st_ino,
                    st.st_dev,
                    st.st_nlink,
                    99999,
                    st.st_gid,
                    st.st_size,
                    st.st_atime,
                    st.st_mtime,
                    st.st_ctime,
                )
            )
        return st

    with (
        patch.object(Path, "lstat", autospec=True, side_effect=mock_lstat),
        pytest.raises(StoreSecurityError, match="Refusing to delete file not owned"),
    ):
        store.delete(run.id)


def test_get_rejects_fifo_without_hanging(tmp_path: Path) -> None:
    """get() rejects non-regular files like FIFOs immediately without hanging."""
    store = RunStore(root=tmp_path / "store")
    run, artifacts = make_test_run()
    store.save(run, artifacts)

    diag_file = store.root / str(run.id) / "diagnostics.txt"
    diag_file.unlink()
    os.mkfifo(diag_file)

    try:
        with pytest.raises(StoreSecurityError, match="not a regular file"):
            store.get(run.id)
    finally:
        diag_file.unlink()


def test_revalidates_root_each_public_operation(tmp_path: Path) -> None:
    """Each public operation re-validates root without auto-chmod if altered."""
    store = RunStore(root=tmp_path / "store")
    run, artifacts = make_test_run()
    store.save(run, artifacts)

    # Mutate root permissions to non-private after initialization
    os.chmod(store.root, 0o755)  # noqa: S103

    with pytest.raises(StoreSecurityError, match="non-private"):
        store.get(run.id)
    with pytest.raises(StoreSecurityError, match="non-private"):
        store.list_runs()
    with pytest.raises(StoreSecurityError, match="non-private"):
        store.artifact_path(run.id, "model.onnx")
    with pytest.raises(StoreSecurityError, match="non-private"):
        store.delete(run.id)

    run2, artifacts2 = make_test_run()
    with pytest.raises(StoreSecurityError, match="non-private"):
        store.save(run2, artifacts2)

    # Verify no auto-chmod occurred
    assert stat.S_IMODE(store.root.stat().st_mode) == 0o755


def test_orphaned_staging_directory_raises_corruption(tmp_path: Path) -> None:
    """Store detects and rejects orphaned .staging-* directories, prompting manual recovery."""
    store = RunStore(root=tmp_path / "store")
    run, artifacts = make_test_run()
    store.save(run, artifacts)

    abandoned_staging = store.root / ".staging-abandoned-from-crash"
    abandoned_staging.mkdir(mode=0o700)

    with pytest.raises(
        StoreCorruptionError,
        match="Orphaned staging directory found.*Manual recovery",
    ):
        store.list_runs()

    run2, artifacts2 = make_test_run()
    with pytest.raises(StoreCorruptionError, match="Orphaned staging directory found"):
        store.save(run2, artifacts2)


def test_delete_refuses_unknown_inventory_file(tmp_path: Path) -> None:
    """delete() refuses to delete runs with unknown files to allow manual recovery."""
    store = RunStore(root=tmp_path / "store")
    run, artifacts = make_test_run()
    store.save(run, artifacts)

    unknown = store.root / str(run.id) / "unknown_extra.log"
    unknown.write_text("should not be deleted automatically")

    with pytest.raises(StoreCorruptionError, match="unknown inventory file"):
        store.delete(run.id)

    assert unknown.exists()
    assert (store.root / str(run.id)).exists()


def test_save_and_get_uv_lock_sha_mismatch(tmp_path: Path) -> None:
    """save() and get() reject mismatch between uv.lock hash and dependency_lock_sha256."""
    store = RunStore(root=tmp_path / "store")
    run, artifacts = make_test_run()

    # Tamper uv.lock bytes at save
    artifacts["uv.lock"] = b"# different lock content\n"
    with pytest.raises(StoreCorruptionError, match="uv.lock hash"):
        store.save(run, artifacts)

    # Restore valid lock and save
    run, artifacts = make_test_run()
    store.save(run, artifacts)

    # Tamper report.json dependency_lock_sha256
    report_file = store.root / str(run.id) / "report.json"
    data = json.loads(report_file.read_text())
    data["configuration"]["dependency_lock_sha256"] = "f" * 64
    config = CompilerConfiguration.model_validate(data["configuration"])
    data["evaluation_key"] = evaluation_key(data["model"]["sha256"], config)
    report_file.write_text(json.dumps(data))

    with pytest.raises(StoreCorruptionError, match="uv.lock hash .* does not match"):
        store.get(run.id)


def test_save_and_get_diagnostics_content_mismatch(tmp_path: Path) -> None:
    """save() and get() reject mismatch between diagnostics.txt bytes and run.diagnostics."""
    store = RunStore(root=tmp_path / "store")
    run, artifacts = make_test_run()

    artifacts["diagnostics.txt"] = b"mismatched diagnostics content"
    with pytest.raises(StoreCorruptionError, match="diagnostics.txt content"):
        store.save(run, artifacts)

    run, artifacts = make_test_run()
    store.save(run, artifacts)

    report_file = store.root / str(run.id) / "report.json"
    data = json.loads(report_file.read_text())
    data["diagnostics"] = "Altered diagnostics text"
    report_file.write_text(json.dumps(data))

    with pytest.raises(StoreCorruptionError, match="diagnostics.txt content"):
        store.get(run.id)
