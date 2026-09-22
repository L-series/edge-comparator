"""Pinned, CPU-only compiler worker. Never performs inference or loads extensions."""

import hashlib
import os
import resource
import sys
from importlib.metadata import version
from pathlib import Path

from pydantic import TypeAdapter, ValidationError

from edge_comparator.compilation_models import (
    COMPILER_OPTIONS,
    OPENVINO_VERSION,
    TELEMETRY_VERSION,
    CompilerObservation,
    QueryPlacement,
)


def check_telemetry_opt_out() -> None:
    home = os.environ.get("HOME")
    if (
        not home
        or os.environ.get("CI") != "true"
        or not (Path(home) / "intel" / "openvino_telemetry").is_file()
        or (Path(home) / "intel" / "openvino_telemetry").read_text(encoding="utf-8") != "0"
    ):
        raise RuntimeError("Telemetry opt-out is required before SDK import")


def compile_file(path: Path) -> CompilerObservation:
    check_telemetry_opt_out()
    observation = CompilerObservation(
        status="inconclusive",
        stage="environment",
        model_sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
        compiler_version=version("openvino"),
    )
    if (
        observation.compiler_version != OPENVINO_VERSION
        or version("openvino-telemetry") != TELEMETRY_VERSION
    ):
        observation.diagnostics = "Installed SDK/telemetry versions do not match the reviewed pins"
        return observation

    # Import only after private-HOME opt-out and resource limits (CLI entry point).
    from openvino import Core, get_version
    from openvino.frontend import (
        FrontEndManager,
        GeneralFailure,
        InitializationFailure,
        NotImplementedFailure,
        OpConversionFailure,
        OpValidationFailure,
    )

    try:
        observation.compiler_build = get_version()
        core = Core()
        observation.device_name = TypeAdapter(str).validate_python(
            core.get_property("CPU", "FULL_DEVICE_NAME"), strict=True
        )
        observation.plugin_version = TypeAdapter(str).validate_python(
            core.get_versions("CPU")["CPU"].build_number, strict=True
        )
        frontend = FrontEndManager().load_by_framework("onnx")
        if frontend is None:
            raise RuntimeError("Pinned ONNX frontend is unavailable")
        observation.stage = "import"
        input_model = frontend.load(str(path))
        if input_model is None:
            raise RuntimeError("ONNX frontend returned no input model")
        model = frontend.convert(input_model)
        observation.stage = "query"
        supported = TypeAdapter(dict[str, str]).validate_python(
            core.query_model(model, "CPU", COMPILER_OPTIONS), strict=True
        )
        if any(device != "CPU" for device in supported.values()):
            raise RuntimeError("CPU-only query returned a contradictory target device")
        observation.query_placements = [
            QueryPlacement(
                name=node.get_friendly_name(),
                operation=node.get_type_name(),
                device=supported.get(node.get_friendly_name()),
            )
            for node in model.get_ops()
        ]
        observation.stage = "compile"
        core.compile_model(model, "CPU", COMPILER_OPTIONS)
        observation.status = "compiled_unverified"
    except (OpConversionFailure, OpValidationFailure) as error:
        observation.status = "compile_failed"
        observation.diagnostics = str(error)
    except (
        RuntimeError,
        GeneralFailure,
        InitializationFailure,
        NotImplementedFailure,
        ValidationError,
    ) as error:
        observation.diagnostics = str(error)
    return CompilerObservation.model_validate(observation.model_dump())


def apply_limits() -> None:
    if sys.platform != "linux":
        raise RuntimeError("Compiler worker requires Linux resource and affinity limits")
    os.sched_setaffinity(0, {min(os.sched_getaffinity(0))})
    resource.setrlimit(resource.RLIMIT_CPU, (45, 50))
    resource.setrlimit(resource.RLIMIT_AS, (4 * 1024**3, 4 * 1024**3))
    resource.setrlimit(resource.RLIMIT_FSIZE, (0, 0))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))


def main() -> None:
    apply_limits()
    result = compile_file(Path("model.onnx"))
    sys.stdout.write(result.model_dump_json())


if __name__ == "__main__":
    main()
