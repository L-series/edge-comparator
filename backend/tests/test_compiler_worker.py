"""Real, pinned SDK integration cases and explicit worker environment gates."""

import hashlib
import os
import resource
import subprocess
import sys
from pathlib import Path

import pytest

from edge_comparator.compilation_models import CompilerObservation
from edge_comparator.demos import make_demo


@pytest.mark.integration
@pytest.mark.parametrize(
    ("name", "outcome", "stage"),
    [
        ("supported-cnn", "compiled_unverified", "compile"),
        ("unsupported-op", "compile_failed", "import"),
    ],
)
def test_real_cpu_compilation(tmp_path: Path, name: str, outcome: str, stage: str) -> None:
    payload = make_demo(name)
    (tmp_path / "model.onnx").write_bytes(payload)
    consent = tmp_path / "intel" / "openvino_telemetry"
    consent.parent.mkdir(mode=0o700)
    consent.write_text("0", encoding="utf-8")
    process = subprocess.run(
        [sys.executable, "-m", "edge_comparator.compiler_worker"],
        input=b"",
        cwd=tmp_path,
        env={
            "PYTHONPATH": str(Path("src").resolve()),
            "HOME": str(tmp_path),
            "CI": "true",
            "OPENBLAS_NUM_THREADS": "1",
            "OMP_NUM_THREADS": "1",
            "PYTHONDONTWRITEBYTECODE": "1",
        },
        capture_output=True,
        timeout=60,
        check=True,
    )
    evidence = CompilerObservation.model_validate_json(process.stdout)
    assert evidence.model_sha256 == hashlib.sha256(payload).hexdigest()
    assert evidence.status == outcome
    assert evidence.stage == stage
    assert evidence.compiler_version == "2026.4.0"
    assert evidence.compiler_build
    assert evidence.device_name
    if outcome == "compiled_unverified":
        assert evidence.query_placements
        assert {p.device for p in evidence.query_placements} <= {"CPU", None}
    else:
        assert "MysteryActivation" in evidence.diagnostics


def test_worker_refuses_missing_telemetry_opt_out(tmp_path: Path) -> None:
    from edge_comparator.compiler_worker import check_telemetry_opt_out

    with pytest.MonkeyPatch.context() as patch:
        patch.setenv("HOME", str(tmp_path))
        patch.setenv("CI", "true")
        with pytest.raises(RuntimeError, match="Telemetry"):
            check_telemetry_opt_out()
    assert "HOME" in os.environ


def test_generated_models_are_deterministic_and_explicit() -> None:
    assert make_demo("supported-cnn") == make_demo("supported-cnn")
    assert make_demo("supported-cnn") != make_demo("unsupported-op")
    with pytest.raises(ValueError, match="Unknown"):
        make_demo("unknown")


@pytest.fixture
def compiler_input(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("CI", "true")
    opt_out = tmp_path / "intel" / "openvino_telemetry"
    opt_out.parent.mkdir()
    opt_out.write_text("0", encoding="utf-8")
    model = tmp_path / "model.onnx"
    model.write_bytes(make_demo("supported-cnn"))
    return model


@pytest.mark.integration
@pytest.mark.parametrize("name", ["supported-cnn", "unsupported-op"])
def test_real_typed_frontend_observation(compiler_input: Path, name: str) -> None:
    from edge_comparator.compiler_worker import compile_file

    compiler_input.write_bytes(make_demo(name))
    result = compile_file(compiler_input)
    assert result.status == ("compiled_unverified" if name == "supported-cnn" else "compile_failed")


@pytest.mark.parametrize(
    "failure", ["validation", "unknown", "no-frontend", "no-input", "bad-query", "foreign-device"]
)
def test_sdk_failures_are_not_guessed_from_log_text(
    compiler_input: Path, monkeypatch: pytest.MonkeyPatch, failure: str
) -> None:
    from openvino import Core
    from openvino.frontend import FrontEnd, FrontEndManager, OpValidationFailure

    from edge_comparator.compiler_worker import compile_file

    def reject(*_args: object, **_kwargs: object) -> None:
        if failure == "validation":
            raise OpValidationFailure("Known node validation rejection")
        raise RuntimeError("No conversion rule: text alone is not a typed model rejection")

    if failure in ("validation", "unknown"):
        monkeypatch.setattr(FrontEnd, "convert", reject)
    elif failure == "no-frontend":
        monkeypatch.setattr(FrontEndManager, "load_by_framework", lambda *_args: None)
    elif failure == "no-input":
        monkeypatch.setattr(FrontEnd, "load", lambda *_args: None)
    elif failure == "bad-query":
        monkeypatch.setattr(Core, "query_model", lambda *_args: {"node": 7})
    else:
        monkeypatch.setattr(Core, "query_model", lambda *_args: {"node": "GPU"})
    result = compile_file(compiler_input)
    assert result.status == ("compile_failed" if failure == "validation" else "inconclusive")
    assert result.diagnostics


def test_unreviewed_sdk_version_never_compiles(
    compiler_input: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from edge_comparator import compiler_worker

    monkeypatch.setattr(compiler_worker, "version", lambda _name: "unexpected")
    result = compiler_worker.compile_file(compiler_input)
    assert result.status == "inconclusive"
    assert result.stage == "environment"


@pytest.mark.integration
def test_private_home_declines_telemetry_before_sdk_import(compiler_input: Path) -> None:
    code = """
import sys
connections = []
def block_connection(event, arguments):
    if event == "socket.connect":
        connections.append(event)
        raise AssertionError("Unexpected Python network connection")
sys.addaudithook(block_connection)
from openvino_telemetry.main import Telemetry
from openvino_telemetry.utils.opt_in_checker import OptInChecker, ConsentCheckResult
assert OptInChecker().check(enable_opt_in_dialog=False) == ConsentCheckResult.DECLINED
telemetry = Telemetry(app_name="ComparatorWorker", app_version="0.1.0", tid="G-DISABLED",
                      enable_opt_in_dialog=False, disable_in_ci=True)
assert telemetry.consent is False
telemetry.send_event("test_category", "test_action", "test_label")
from edge_comparator.compiler_worker import main
main()
assert not connections
"""
    process = subprocess.run(
        [sys.executable, "-c", code],
        cwd=compiler_input.parent,
        env={
            "HOME": str(compiler_input.parent),
            "CI": "true",
            "PYTHONPATH": str(Path("src").resolve()),
            "PYTHONDONTWRITEBYTECODE": "1",
            "OPENBLAS_NUM_THREADS": "1",
            "OMP_NUM_THREADS": "1",
        },
        check=True,
        capture_output=True,
        timeout=60,
    )
    assert CompilerObservation.model_validate_json(process.stdout).status == "compiled_unverified"


def test_limits_and_entrypoint(
    compiler_input: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    from edge_comparator import compiler_worker

    limits: list[tuple[int, tuple[int, int]]] = []
    affinities: list[set[int]] = []
    monkeypatch.setattr(resource, "setrlimit", lambda key, value: limits.append((key, value)))
    monkeypatch.setattr(os, "sched_getaffinity", lambda _pid: {2, 3})
    monkeypatch.setattr(os, "sched_setaffinity", lambda _pid, cpus: affinities.append(cpus))
    monkeypatch.chdir(compiler_input.parent)
    compiler_worker.main()
    assert (
        CompilerObservation.model_validate_json(capsys.readouterr().out).status
        == "compiled_unverified"
    )
    assert affinities == [{2}]
    assert len(limits) == 4
    monkeypatch.setattr(sys, "platform", "unsupported")
    with pytest.raises(RuntimeError, match="Linux"):
        compiler_worker.apply_limits()
