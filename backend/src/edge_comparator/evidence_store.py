"""Lean stdlib filesystem evidence store for CompilationRun artifacts and manifests."""

import hashlib
import os
import stat
import tempfile
from pathlib import Path
from uuid import UUID

from pydantic import ValidationError

from edge_comparator.compilation_models import (
    ArtifactName,
    CompilationRun,
    EvidenceArtifact,
)

ALLOWED_ARTIFACT_NAMES: frozenset[ArtifactName] = frozenset(
    {
        "model.onnx",
        "worker.stdout.json",
        "worker.stderr.txt",
        "diagnostics.txt",
        "uv.lock",
    }
)

ARTIFACT_MEDIA_TYPES: dict[ArtifactName, str] = {
    "model.onnx": "application/octet-stream",
    "worker.stdout.json": "application/json",
    "worker.stderr.txt": "text/plain; charset=utf-8",
    "diagnostics.txt": "text/plain; charset=utf-8",
    "uv.lock": "text/plain; charset=utf-8",
}

REPORT_FILENAME = "report.json"
ALLOWED_CHILDREN: frozenset[str] = frozenset(set(ALLOWED_ARTIFACT_NAMES) | {REPORT_FILENAME})
DEFAULT_MAX_RUNS = 20
DEFAULT_MAX_BYTES = 512 * 1024 * 1024


class StoreError(Exception):
    """Base exception for evidence store errors."""


class StoreCapacityError(StoreError):
    """Raised when maximum runs count or storage byte quota is exceeded."""


class RunNotFound(StoreError):
    """Raised when a requested compilation run UUID does not exist."""


class StoreCorruptionError(StoreError):
    """Raised when stored run data, files, or hashes are corrupt or invalid."""


class StoreSecurityError(StoreError):
    """Raised when permissions, symlinks, path traversal, or ownership violations occur."""


def default_evidence_root() -> Path:
    """Return default private evidence root path from ENV or ~/.local/share."""
    env_dir = os.environ.get("EDGE_COMPARATOR_DATA_DIR")
    if env_dir:
        return Path(env_dir)
    return Path.home() / ".local" / "share" / "edge-comparator" / "evidence"


def _write_private_file(target_path: Path, data: bytes) -> None:
    """Write bytes to a file with 0600 permissions and fsync."""
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    fd = os.open(target_path, flags, 0o600)
    with open(fd, "wb", closefd=True) as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())


def _fsync_dir(dir_path: Path) -> None:
    """Fsync a directory to ensure namespace durability."""
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
    fd = os.open(dir_path, flags)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


class RunStore:
    """Manages local storage, verification, and retrieval of CompilationRun evidence."""

    def __init__(
        self,
        root: Path | None = None,
        max_runs: int = DEFAULT_MAX_RUNS,
        max_bytes: int = DEFAULT_MAX_BYTES,
    ) -> None:
        if max_runs < 1:
            raise ValueError("max_runs must be at least 1")
        if max_bytes < 1:
            raise ValueError("max_bytes must be at least 1")
        self.root = root if root is not None else default_evidence_root()
        self.max_runs = max_runs
        self.max_bytes = max_bytes
        self._validate_root(create_if_missing=True)

    def _validate_root(self, create_if_missing: bool = False) -> None:
        """Validate private permissions and ownership of root without auto-chmod."""
        if self.root.is_symlink():
            raise StoreSecurityError(f"Root path {self.root} cannot be a symlink")
        if not self.root.exists():
            if create_if_missing:
                self.root.mkdir(parents=True, mode=0o700, exist_ok=True)
                os.chmod(self.root, 0o700)
                return
            raise StoreSecurityError(f"Root directory {self.root} does not exist")
        st = self.root.lstat()
        if not stat.S_ISDIR(st.st_mode):
            raise StoreSecurityError(f"Root path {self.root} is not a directory")
        if hasattr(os, "getuid") and st.st_uid != os.getuid():
            raise StoreSecurityError(
                f"Root directory {self.root} is not owned by current user "
                f"(owner={st.st_uid}, current={os.getuid()})"
            )
        if st.st_mode & 0o077 != 0:
            raise StoreSecurityError(
                f"Root directory {self.root} has non-private permissions: {oct(st.st_mode)}"
            )

    @staticmethod
    def _validate_run_id(run_id: object) -> UUID:
        """Guard against non-UUID types and path traversal."""
        if not isinstance(run_id, UUID):
            raise StoreError(f"run_id must be a UUID instance, got {type(run_id).__name__}")
        return run_id

    def _get_run_dirs(self) -> list[Path]:
        """List confirmed run directories under root, rejecting orphaned staging and non-UUIDs."""
        run_dirs: list[Path] = []
        for entry in self.root.iterdir():
            if entry.name.startswith(".staging-"):
                raise StoreCorruptionError(
                    f"Orphaned staging directory found: {entry.name}. "
                    "Manual recovery required: inspect and remove uncommitted staging data."
                )
            st = entry.lstat()
            if stat.S_ISLNK(st.st_mode):
                raise StoreSecurityError(f"Symlink found in store root: {entry.name}")
            if not stat.S_ISDIR(st.st_mode):
                raise StoreCorruptionError(
                    f"Unexpected non-directory entry in store root: {entry.name}"
                )
            try:
                UUID(entry.name)
            except ValueError as err:
                raise StoreCorruptionError(f"Non-UUID entry in store root: {entry.name}") from err
            run_dirs.append(entry)
        return run_dirs

    def _get_total_bytes(self) -> int:
        """Compute aggregate storage usage, validating each existing run."""
        total = 0
        for run_dir in self._get_run_dirs():
            run_id = UUID(run_dir.name)
            run = self.get(run_id)
            report_st = (run_dir / REPORT_FILENAME).lstat()
            total += report_st.st_size + sum(a.size_bytes for a in run.artifacts)
        return total

    def save(
        self,
        run: CompilationRun,
        artifacts: dict[ArtifactName, bytes] | dict[str, bytes],
    ) -> CompilationRun:
        """Persist a run and its 5 allowlisted artifacts atomically under root."""
        self._validate_root()
        self._validate_run_id(run.id)
        final_dir = self.root / str(run.id)
        if final_dir.exists() or final_dir.is_symlink():
            raise StoreError(f"Run {run.id} already exists")

        # Validate exact artifact keys
        if set(artifacts.keys()) != ALLOWED_ARTIFACT_NAMES:
            raise StoreError(
                f"Expected exactly artifacts: {sorted(ALLOWED_ARTIFACT_NAMES)}, "
                f"got {sorted(artifacts.keys())}"
            )

        # Verify model.onnx hash against run.model.sha256
        model_bytes = artifacts["model.onnx"]
        computed_model_sha256 = hashlib.sha256(model_bytes).hexdigest()
        if computed_model_sha256 != run.model.sha256:
            raise StoreCorruptionError(
                f"Uploaded model.onnx hash ({computed_model_sha256}) "
                f"does not match run.model.sha256 ({run.model.sha256})"
            )

        # Verify uv.lock hash against run.configuration.dependency_lock_sha256
        uv_lock_bytes = artifacts["uv.lock"]
        computed_lock_sha256 = hashlib.sha256(uv_lock_bytes).hexdigest()
        if computed_lock_sha256 != run.configuration.dependency_lock_sha256:
            raise StoreCorruptionError(
                f"uv.lock hash ({computed_lock_sha256}) does not match "
                f"dependency_lock_sha256 ({run.configuration.dependency_lock_sha256})"
            )

        # Verify diagnostics.txt bytes against run.diagnostics
        diag_bytes = artifacts["diagnostics.txt"]
        expected_diag_bytes = run.diagnostics.encode("utf-8")
        if diag_bytes != expected_diag_bytes:
            raise StoreCorruptionError("diagnostics.txt content does not match run.diagnostics")

        # Build EvidenceArtifact manifests
        artifact_manifests: list[EvidenceArtifact] = []
        for name in sorted(ALLOWED_ARTIFACT_NAMES):
            data = artifacts[name]
            artifact_manifests.append(
                EvidenceArtifact(
                    name=name,
                    sha256=hashlib.sha256(data).hexdigest(),
                    size_bytes=len(data),
                    media_type=ARTIFACT_MEDIA_TYPES[name],
                )
            )

        updated_run = run.model_copy(update={"artifacts": artifact_manifests})
        report_bytes = updated_run.model_dump_json(indent=2).encode("utf-8")

        # Quota checks
        new_run_bytes = sum(len(b) for b in artifacts.values()) + len(report_bytes)
        if new_run_bytes > self.max_bytes:
            raise StoreCapacityError(
                f"Run size ({new_run_bytes} bytes) exceeds "
                f"store max_bytes limit ({self.max_bytes} bytes)"
            )

        existing_run_dirs = self._get_run_dirs()
        if len(existing_run_dirs) + 1 > self.max_runs:
            raise StoreCapacityError(
                f"Store capacity reached: maximum {self.max_runs} runs limit exceeded"
            )

        current_total = self._get_total_bytes()
        if current_total + new_run_bytes > self.max_bytes:
            raise StoreCapacityError(
                f"Store storage limit reached: adding {new_run_bytes} bytes exceeds "
                f"{self.max_bytes} bytes limit"
            )

        # Atomic staging and publication
        staging_parent = tempfile.TemporaryDirectory(dir=self.root, prefix=".staging-")
        try:
            staging_path = Path(staging_parent.name)
            os.chmod(staging_path, 0o700)
            for name in ALLOWED_ARTIFACT_NAMES:
                _write_private_file(staging_path / name, artifacts[name])
            _write_private_file(staging_path / REPORT_FILENAME, report_bytes)
            _fsync_dir(staging_path)

            try:
                os.replace(staging_path, final_dir)
            except OSError as err:
                raise StoreError(f"Failed to publish run {run.id}: {err}") from err

            _fsync_dir(self.root)
        finally:
            staging_parent.cleanup()

        return updated_run

    def get(self, run_id: UUID | object) -> CompilationRun:
        """Retrieve and thoroughly validate a saved CompilationRun."""
        self._validate_root()
        self._validate_run_id(run_id)
        run_dir = self.root / str(run_id)
        if not run_dir.exists() or not run_dir.is_dir():
            raise RunNotFound(f"Run {run_id} not found")

        st = run_dir.lstat()
        if stat.S_ISLNK(st.st_mode):
            raise StoreSecurityError(f"Run directory {run_id} is a symlink")
        if hasattr(os, "getuid") and st.st_uid != os.getuid():
            raise StoreSecurityError(
                f"Run directory {run_id} is not owned by current user (owner={st.st_uid})"
            )
        if st.st_mode & 0o077 != 0:
            raise StoreSecurityError(
                f"Run directory {run_id} has non-private permissions: {oct(st.st_mode)}"
            )

        for p in run_dir.iterdir():
            if p.is_symlink():
                raise StoreSecurityError(f"Artifact {p.name} in run {run_id} is a symlink")

        expected_files = set(ALLOWED_ARTIFACT_NAMES) | {REPORT_FILENAME}
        actual_files = {p.name for p in run_dir.iterdir()}
        if actual_files != expected_files:
            raise StoreCorruptionError(
                f"Corrupt inventory in run {run_id}: expected {expected_files}, got {actual_files}"
            )

        for file_name in expected_files:
            item = run_dir / file_name
            item_st = item.lstat()
            if not stat.S_ISREG(item_st.st_mode):
                raise StoreSecurityError(
                    f"Artifact {file_name} in run {run_id} is not a regular file"
                )
            if hasattr(os, "getuid") and item_st.st_uid != os.getuid():
                raise StoreSecurityError(
                    f"Artifact {file_name} in run {run_id} is not owned by current user"
                )
            if item_st.st_mode & 0o077 != 0:
                raise StoreSecurityError(
                    f"Artifact {file_name} in run {run_id} has "
                    f"non-private permissions: {oct(item_st.st_mode)}"
                )
            if item_st.st_size > self.max_bytes:
                raise StoreCorruptionError(
                    f"Artifact {file_name} in run {run_id} exceeds store capacity"
                )

        report_file = run_dir / REPORT_FILENAME
        report_bytes = report_file.read_bytes()
        try:
            run = CompilationRun.model_validate_json(report_bytes)
        except (ValidationError, ValueError) as err:
            raise StoreCorruptionError(f"Invalid CompilationRun schema in run {run_id}") from err

        if run.id != run_id:
            raise StoreCorruptionError(
                f"Report ID ({run.id}) does not match directory UUID ({run_id})"
            )

        if len(run.artifacts) != len(ALLOWED_ARTIFACT_NAMES):
            raise StoreCorruptionError(
                f"Run {run_id} manifest contains {len(run.artifacts)} artifacts, "
                f"expected {len(ALLOWED_ARTIFACT_NAMES)}"
            )

        artifact_map = {a.name: a for a in run.artifacts}
        for name in ALLOWED_ARTIFACT_NAMES:
            manifest_artifact = artifact_map[name]
            item_path = run_dir / name
            item_st = item_path.lstat()
            if item_st.st_size != manifest_artifact.size_bytes:
                raise StoreCorruptionError(
                    f"Artifact {name} size mismatch: on disk {item_st.st_size}, "
                    f"recorded {manifest_artifact.size_bytes}"
                )
            content = item_path.read_bytes()
            actual_sha256 = hashlib.sha256(content).hexdigest()
            if actual_sha256 != manifest_artifact.sha256:
                raise StoreCorruptionError(
                    f"Artifact {name} hash mismatch in run {run_id}: on disk {actual_sha256}, "
                    f"recorded {manifest_artifact.sha256}"
                )

        if artifact_map["model.onnx"].sha256 != run.model.sha256:
            raise StoreCorruptionError(
                f"model.onnx hash ({artifact_map['model.onnx'].sha256}) "
                f"does not match run.model.sha256 ({run.model.sha256})"
            )

        if artifact_map["uv.lock"].sha256 != run.configuration.dependency_lock_sha256:
            raise StoreCorruptionError(
                f"uv.lock hash ({artifact_map['uv.lock'].sha256}) does not match "
                f"dependency_lock_sha256 ({run.configuration.dependency_lock_sha256})"
            )

        diag_content = (run_dir / "diagnostics.txt").read_bytes()
        if diag_content != run.diagnostics.encode("utf-8"):
            raise StoreCorruptionError("diagnostics.txt content does not match run.diagnostics")

        return run

    def list_runs(self) -> list[CompilationRun]:
        """List all valid compilation runs newest first, failing on corruption or capacity."""
        self._validate_root()
        run_dirs = self._get_run_dirs()

        if len(run_dirs) > self.max_runs:
            raise StoreCapacityError(
                f"Store contains {len(run_dirs)} runs, exceeding maximum of {self.max_runs}"
            )

        runs: list[CompilationRun] = []
        for run_dir in run_dirs:
            run_id = UUID(run_dir.name)
            runs.append(self.get(run_id))

        runs.sort(key=lambda r: r.created_at, reverse=True)
        return runs

    def artifact_path(self, run_id: UUID | object, name: ArtifactName | str) -> Path:
        """Return validated Path to an allowlisted artifact file."""
        self._validate_root()
        validated_id = self._validate_run_id(run_id)
        if name not in ALLOWED_ARTIFACT_NAMES:
            raise StoreError(f"Invalid artifact name: {name}")

        self.get(validated_id)
        return self.root / str(validated_id) / name

    def delete(self, run_id: UUID | object) -> None:
        """Safely delete an owned run directory without chasing symlinks."""
        self._validate_root()
        validated_id = self._validate_run_id(run_id)
        run_dir = self.root / str(validated_id)
        if not run_dir.exists():
            raise RunNotFound(f"Run {validated_id} not found")

        st = run_dir.lstat()
        if stat.S_ISLNK(st.st_mode):
            raise StoreSecurityError(f"Refusing to delete symlink {run_dir}")
        if not stat.S_ISDIR(st.st_mode):
            raise StoreSecurityError(f"Refusing to delete non-directory {run_dir}")
        if hasattr(os, "getuid") and st.st_uid != os.getuid():
            raise StoreSecurityError("Refusing to delete directory not owned by current user")

        children = list(run_dir.iterdir())
        for entry in children:
            entry_st = entry.lstat()
            if stat.S_ISLNK(entry_st.st_mode):
                raise StoreSecurityError(f"Refusing to delete run containing symlink: {entry.name}")
            if stat.S_ISDIR(entry_st.st_mode):
                raise StoreSecurityError(
                    f"Refusing to delete run containing unexpected directory: {entry.name}"
                )
            if not stat.S_ISREG(entry_st.st_mode):
                raise StoreSecurityError(
                    f"Refusing to delete run containing non-regular file: {entry.name}"
                )
            if hasattr(os, "getuid") and entry_st.st_uid != os.getuid():
                raise StoreSecurityError(
                    f"Refusing to delete file not owned by current user: {entry.name}"
                )
            if entry.name not in ALLOWED_CHILDREN:
                raise StoreCorruptionError(
                    f"Refusing to delete run containing unknown inventory file: {entry.name}. "
                    "Manual recovery required."
                )

        for entry in children:
            entry.unlink()
        run_dir.rmdir()
        _fsync_dir(self.root)
