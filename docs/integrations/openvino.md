# OpenVINO Local CPU Compiler Integration Assessment

- **Date:** 2026-09-22
- **Author:** licensing-researcher agent
- **Target ID:** `intel-openvino-cpu`
- **Recommended Package:** `openvino==2026.4.0` (PyPI release 2026-09-16; GitHub tag `2026.4.0`)
- **Wheel:** `openvino-2026.4.0-22959-cp312-cp312-manylinux_2_28_x86_64.whl` (Python 3.12, Linux x86_64)
- **Runtime Build:** `2026.4.0-22959-99c81491cc3-releases/2026/4` (CPU plugin)
- **Host Hardware Verified:** AMD Ryzen 9 7950X3D (x86_64 CPU; not an Intel hardware endorsement)
- **Legal Status:** Engineering licensing evaluation only; Proposed status pending human review; not legal clearance or production architecture approval.

## 1. Distribution, Licensing & Governance

- **Maintainership:** Actively maintained open-source project by Intel Corporation and community contributors on GitHub (`openvinotoolkit/openvino`).
- **Core SDK License:** Apache-2.0 across C++ runtime, frontends, and Python bindings (not wrapper-only).
- **Third-Party Conditions:** Wheel notices (`runtime-third-party-programs.txt`, `onednn_third-party-programs.txt`, `onetbb_third-party-programs.txt` in `.dist-info/licenses/`) enumerate runtime third-party components under permissive terms: oneDNN (Apache-2.0), oneTBB (Apache-2.0), gflags (BSD-3-Clause), ITT/JIT (BSD-3-Clause), Safe String Library (MIT), XByak (BSD-3-Clause), zlib (zlib license), Level Zero (Apache-2.0), and ONNX (Apache-2.0). Redistribution requires retaining bundled notices and disclaimers; no trademark license.
- **Non-interactive Local Use:** The CPU path uses local packages without a vendor account, cloud job, API key, GPU, or proprietary GPU driver. The local smoke probe is not proof of native-network isolation.
- **Telemetry & Offline Source Audit:**
  - The runtime/frontend API path does not configure the converter's `TelemetryExtension`; converter utilities such as `ovc` have a separate telemetry integration. The worker reads a private model file and retains no serialized engine.
  - Runtime dependency `openvino-telemetry` (pinned `2025.2.0`) checks consent via `OptInChecker`, looking for `$HOME/intel/openvino_telemetry`.
  - When the consent file exists and contains `"0"`, `OptInChecker.check()` returns `ConsentCheckResult.DECLINED`, forcing `self.consent = False`.
  - Source verification confirms that `self.consent = False` blocks all telemetry: `start_session`, `end_session`, `send_error`, `send_stack_trace`, and `send_event` (where `force_send=False` by default; `force_send=True` occurs only in interactive CLI dialog or CLI `opt_in_out --opt_out`).
  - **Deterministic Worker Isolation (Zero Developer HOME Impact):**
    1. Run compilation in a dedicated subprocess with `os.environ["HOME"] = str(worker_temp_dir)`.
    2. Seed `$worker_temp_dir/intel/openvino_telemetry` with `"0"` prior to importing OpenVINO.
    3. Set `os.environ["CI"] = "true"` in the worker process environment.
  - **Opt-Out Verification:** `test_private_home_declines_telemetry_before_sdk_import`
    in `backend/tests/test_compiler_worker.py` runs a disposable subprocess,
    checks actual consent, sends a disabled synthetic event, and compiles a
    generated model under a Python connection-attempt guard. HOME and opt-out
    are configured before importing either SDK or telemetry; real developer
    settings are never changed.
  - **Network & Security Boundaries:** Native compiler subprocesses are not network-isolated (persistent CI runners lack a Docker socket; execution-container orchestration is out of scope). A separate smoke probe uses a Python `socket.connect` audit guard to detect Python connection attempts during compilation; it is not a production/native-network boundary. Hostile native-code exploits or memory corruption remain explicitly out of scope pending isolated virtualization.
  - **Implementation Gates:** The implementation pins telemetry 2025.2.0 and enforces worker affinity/resource bounds. Proposed ADR status and independent human legal/licensing review remain unchanged. Narrow reviewed SDK stubs preserve strict typing without blanket import suppression.
- **Unresolved Licensing Gates:** Evaluating third-party models (e.g., Depth Anything 3 variants licensed under CC-BY-NC or custom terms) does not inherit Apache-2.0 rights. Public SaaS hosting, multi-tenant evaluation, or model redistribution requires separate legal approval, terms of service, and isolated sandbox review.

## 2. Compiler Evidence & Device Semantics

- **Evidence Ladder:**
  - `static_inferred`: Flat ONNX structural preflight (<=16 MiB; external data, nested subgraphs, and local functions rejected per ADR-0005).
  - `compiler_reported`: Model queried for device compatibility (`Core.query_model`).
  - `Compiled—execution unverified`: Successful graph compilation (`Core.compile_model(device_name="CPU")`).
- **Execution Boundary:** Uploaded model graphs are NOT executed for inference in this milestone. Successful compilation proves graph translation and backend CPU kernel lowering, not runtime acceleration, throughput, or accuracy.
- **Strict Device Selection:** Target device must be explicitly set to `"CPU"`. Prohibit `"AUTO"` (which selects devices dynamically and introduces unverified fallbacks) and `"HETERO"` (which splits execution across device plugins).
- **Tooling Status:** Intel OpenVINO Model Analyzer is explicitly discontinued and must not be used or integrated.

## 3. Python API, Typing & Resource Boundaries

- **Intake & Conversion APIs:**
  - `fem = openvino.frontend.FrontEndManager()`: Resolves official ONNX frontend plugin (`fe = fem.load_by_framework("onnx")`).
  - `input_model = fe.load(str(model_path))`: Loads ONNX graph from preflighted path. Note: While `Core.read_model` collapses frontend missing operators into generic `RuntimeError`, `fe.convert(input_model)` preserves typed `openvino.frontend.OpConversionFailure` (not a `RuntimeError` subclass; prints "No conversion rule found" for unsupported custom ops).
  - `placement = core.query_model(ov_model, "CPU")`: Maps imported OpenVINO IR operation names to `"CPU"`. Note: Operation names belong to the internal OpenVINO IR graph, not 1:1 original ONNX node names.
  - `compiled = core.compile_model(ov_model, "CPU", config=cpu_config)`: Compiles imported `ov.Model` to CPU backend.
  - `versions = core.get_versions("CPU")`: Returns plugin build metadata (`2026.4.0-22959-99c81491cc3-releases/2026/4`).
  - `device_name = core.get_property("CPU", openvino.properties.device.full_name)` (or `"FULL_DEVICE_NAME"`): Queries host CPU brand string (e.g., AMD Ryzen 9 7950X3D).
- **Supported CPU Configuration:**
  - Note: CPU plugin supported properties does **not** include `COMPILATION_NUM_THREADS` (passing it raises `RuntimeError: unsupported property`).
  - Verified valid CPU configuration options:
    `{"INFERENCE_PRECISION_HINT": "f32", "INFERENCE_NUM_THREADS": 1, "NUM_STREAMS": 1, "PERFORMANCE_HINT": "LATENCY"}`
- **Typing Status (PEP 561):** The wheel packages 99 `.pyi` files but lacks `py.typed`, and its relevant stubs begin with `# type: ignore`, hiding exports even with `follow_untyped_imports`. The implementation uses only the small reviewed `backend/stubs/openvino/` surface, not blanket `ignore_missing_imports` or `Any`. Real integration tests exercise those signatures; opaque property/query outputs are validated at runtime.
- **Process & Resource Isolation:** Rather than relying on invalid compiler thread properties, the worker subprocess restricts CPU consumption using child-only Linux `os.sched_setaffinity(0, {allowed_cpu})`. Memory and execution deadlines are enforced via `resource.setrlimit(resource.RLIMIT_AS, ...)` and subprocess timeouts, preserving unmodified exception diagnostics on failure.

## 4. Test Fixtures & Validation Lineage

- **Supported Synthetic Fixture:** Minimal valid flat CNN (e.g., Conv2D + Relu with fixed dimensions <=16 MiB) that successfully passes preflight, `fe.convert`, `query_model`, and `compile_model(device_name="CPU")`.
- **Unsupported Custom Operator Fixture:** Synthesized ONNX graph with an unsupported domain/operator (e.g., `domain="custom.test"`, `op_type="CustomUnsupportedOp"`). Fails deterministically during frontend conversion raising typed `openvino.frontend.OpConversionFailure` ("No conversion rule found").
- **Failure Classification Policy:**
  - Typed `openvino.frontend.OpConversionFailure` or `openvino.frontend.OpValidationFailure` maps deterministically to `status: "compile_failed"`.
  - Generic `RuntimeError` or `GeneralFailure` maps to `status: "inconclusive"`.
  - Unmodified exception diagnostics are preserved without brittle regex/log parsing. Imported graph operation placement is recorded without assuming original ONNX node indices.

## 5. Architectural Contrast (Gated Alternatives)

- **NVIDIA TensorRT:** Unresolved gates include proprietary NVIDIA SLA/EULA acceptance, non-redistributable library components, and mandatory physical NVIDIA GPU hardware with CUDA drivers (host CPU compilation unavailable).
- **Arm Ethos-U Vela:** Permissive compiler requiring its own TFLite/TOSA intake and supported quantization/target settings; it does not directly ingest arbitrary ONNX. That separate ingestion path is deferred, not classified as universally unsupported hardware.
- **Verdict:** OpenVINO CPU is the selected local demo path: Apache-2.0 core, a pinned headless Python 3.12 Linux wheel, direct ONNX intake, and CPU compilation without additional hardware or proprietary credentials. This does not establish legal clearance for a hosted service.

## 6. Authoritative References

- OpenVINO PyPI Release 2026.4.0: <https://pypi.org/project/openvino/2026.4.0/>
- GitHub Tag 2026.4.0: <https://github.com/openvinotoolkit/openvino/releases/tag/2026.4.0>
- OpenVINO Core Python API: <https://github.com/openvinotoolkit/openvino/blob/2026.4.0/src/bindings/python/src/openvino/_ov_api.py>
- OpenVINO Core C++ Bindings: <https://github.com/openvinotoolkit/openvino/blob/2026.4.0/src/bindings/python/src/pyopenvino/core/core.cpp>
- OpenVINO ONNX Frontend Translate Session: <https://github.com/openvinotoolkit/openvino/blob/2026.4.0/src/frontends/onnx/frontend/src/translate_session.hpp>
- OpenVINO ONNX Frontend Intake: <https://github.com/openvinotoolkit/openvino/blob/2026.4.0/src/frontends/onnx/frontend/src/frontend.cpp>
- OpenVINO CPU Plugin Documentation: <https://docs.openvino.ai/2026/openvino-workflow/running-inference/inference-devices-and-modes/cpu-device.html>
- Discontinued Features Notice: <https://docs.openvino.ai/2026/documentation/legacy-features.html>
- OpenVINO Telemetry Release 2025.2.0 (`1fa43eee43d3372be09da32dab8040d819587297`):
  - OptInChecker: <https://github.com/openvinotoolkit/telemetry/blob/1fa43eee43d3372be09da32dab8040d819587297/src/utils/opt_in_checker.py>
  - TelemetrySender: <https://github.com/openvinotoolkit/telemetry/blob/1fa43eee43d3372be09da32dab8040d819587297/src/utils/sender.py>
  - Telemetry Main: <https://github.com/openvinotoolkit/telemetry/blob/1fa43eee43d3372be09da32dab8040d819587297/src/main.py>
