# Implementation plan: evidence-backed edge-AI hardware compatibility platform

Recommendation: Build a compatibility evidence system with a hardware catalog—not a hardware catalog with compatibility badges. The core product should preserve an exact model artifact, deployment configuration, toolchain, and evidence trail, then explain what is known, what failed, and what remains unverified.

Start with NVIDIA TensorRT, Intel OpenVINO, and Arm Ethos-U Vela. Use ONNX and TFLite as native intake formats, without forcing either into a universal executable representation. Make MemryX the leading fourth-adapter candidate; defer hosted integrations whose licensing, diagnostics, or maintenance cannot yet support a dependable service.

Research basis: Public documentation, repositories, release information, and available license texts reviewed on September 22, 2026. This is a source-backed implementation plan, not the result of executing the SDKs or obtaining legal clearance. Unverified capabilities and contractual permissions are explicit gates below.

---

## 1. Product definition and scope

### 1.1 Primary users and initial market

| Persona                         | Decision the platform should support                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------ |
| Embedded ML engineer            | “Will this exported model deploy on this exact accelerator stack, and what must change?”         |
| Embedded/Linux systems engineer | “Which board, BSP, driver, memory configuration, and runtime are required?”                      |
| Product architect               | “Which platforms meet functionality, latency, power, thermal, cost, and lifecycle requirements?” |
| Technical procurement engineer  | “Which orderable module or system corresponds to the evaluated configuration?”                   |
| SDK/application maintainer      | “Did this compiler or model update change placement, correctness, or performance?”               |

Initial market: Industrial vision, robotics, and embedded-device OEMs selecting Linux-capable edge systems and low-power accelerator platforms. Begin with classification, detection, segmentation, and compact depth/pose workloads.

Defer broad smartphone coverage, large generative-model serving, automotive safety certification, and unrestricted MCU firmware generation. These introduce substantially different deployment and validation requirements.

### 1.2 Top workflows

1. Browse hardware: Filter boards/modules by processors, accelerators, memory, power envelope, cooling, form factor, OS/BSP, software stack, price, availability, and lifecycle.
2. Evaluate a workload: Select a curated model artifact or upload ONNX/TFLite, specify input signatures and deployment requirements, then select targets.
3. Compare exact configurations: View compatible, partially accelerated, failed, and unevaluated combinations.
4. Diagnose a result: Inspect rejected operations, attribute constraints, partitions, transformations, raw diagnostics, and missing evidence.
5. Explore a remediation: Create a separately versioned variant with a fixed shape, different precision, graph rewrite, plugin, or postprocessing boundary.
6. Track regressions: Compare SDK versions against unchanged model and hardware configurations.
7. Export evidence: Download a reproducibility manifest, normalized results, and permitted raw artifacts.

“Immediate results” must mean cached evidence and static preflight appear immediately. New compilation and hardware jobs are asynchronous; the UI must not disguise a prediction as a completed evaluation.

### 1.3 What constitutes a compatibility result?

A result applies to:

Exact model artifact + format/schema + input/settings + transformation lineage + precision/quantization + toolchain/runtime + target configuration + fallback policy

A model-family name such as “YOLO” is insufficient. A SoC name is also insufficient.

The target configuration must include the relevant accelerator instance, board revision, memory configuration, OS/BSP, driver, firmware, runtime, and power settings. Some compile-time findings can apply to an accelerator architecture; board-level execution and performance findings cannot automatically inherit that scope.

### 1.4 Strict outcome taxonomy

Use three independent dimensions:

- Outcome: What happened?
- Evidence stage: Static analysis, compilation, runtime validation, or measurement?
- Scope: Which artifact, device, inputs, branches, and configurations were evaluated?

Recommended user-facing states:

| State                                 | Strict meaning                                                                                                                                                                                                                                  |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fully accelerated                     | Execution and numerical checks passed for the stated test scope; all required runtime graph computation was placed on the selected accelerator set. No hidden CPU graph computation. Host orchestration is disclosed but is not graph fallback. |
| Partially accelerated                 | Execution and numerical checks passed; some graph computation ran on the selected accelerator and some elsewhere. Show destinations and partition boundaries.                                                                                   |
| Executable with software fallback     | The selected accelerator performed no verified graph computation, but the complete workload executed successfully through the configured software path. CPU-only targets should display the clearer label Executable on CPU.                    |
| Compiled—execution unverified         | The compiler produced a deployable artifact or execution plan, but target execution has not been validated. Add reported full/partial/unknown placement as a separate field.                                                                    |
| Compile/conversion failed             | A specific conversion or compilation attempt failed. This does not prove the hardware can never support a modified model or another stack.                                                                                                      |
| Runtime/validation failed             | Loading, execution, output comparison, or an explicitly required quality threshold failed. Preserve the specific failure phase.                                                                                                                 |
| Unsupported by selected configuration | A documented or definitive constraint excludes this exact configured path. For example, the adapter does not accept the supplied format and no conversion was requested. Never imply universal hardware impossibility.                          |
| Not tested                            | No applicable evaluation exists for the exact configuration.                                                                                                                                                                                    |
| Inconclusive                          | Evidence is incomplete, contradictory, unparsable, or blocked by an environmental problem.                                                                                                                                                      |

Important distinctions:

- TensorRT-to-CUDA fallback on the same GPU can still be fully GPU-accelerated while only partially TensorRT-covered. Show hardware placement and execution-provider coverage separately.
- NPU-to-GPU fallback is partial NPU acceleration, even if no graph computation runs on CPU.
- A fully accelerated inference graph does not imply fully accelerated camera decoding, preprocessing, NMS, or other application stages outside that graph.
- Compilation success does not establish numerical correctness, acceptable accuracy, or useful speed.
- Validation at a few dynamic shapes does not certify every shape or control-flow path.

### 1.5 Model identity: “DA3”

Confirmed by the product owner on September 22, 2026: DA3 means Depth Anything 3 (Depth Anything v3).

Before adding a deployable library variant, require:

- Exact checkpoint and revision.
- Single-image, multi-view, pose-conditioned, or streaming mode.
- Input resolution and view-count limits.
- Included output heads.
- Exporter version and export configuration.
- Weight license and numerical-equivalence evidence.

The official model table distinguishes permissive checkpoints such as DA3-Small/Base from noncommercial checkpoints including several Large/Giant/Nested variants. Do not apply the repository’s code license to every weight file. Also, exporting depth results to images/GLB is not equivalent to exporting the network to ONNX.

Source: Depth Anything 3 repository and model cards.

---

## 2. Uncertainties and research spikes

Critical uncertainties requiring validation before architecture commitment

Run a time-boxed discovery program before building a general worker fleet. Its output should be executable feasibility evidence, sample artifacts, and an approved integration register—not just documentation summaries.

| Uncertainty                                        | Why it matters; working hypothesis                                                                                                                                   | Concrete experiment or review                                                                                                                                                                    | Decision criterion                                                                                                         | Risk if wrong                                              |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 1. Non-interactive automation and containers       | Most tools are scriptable, but installation, licensing, device access, or supported OS constraints may prevent generic Linux containers.                             | Install each shortlisted version from a clean host; compile a positive and negative model without a TTY; repeat after restart. Separate installation from job execution.                         | A documented unattended path with pinned dependencies; otherwise use a native or customer-controlled runner.               | Architecture assumes portability that does not exist.      |
| 2. Structured diagnostics                          | APIs and JSON are preferable, but operation rejection frequently appears only in text.                                                                               | Capture successful, partially mapped, malformed, unsupported-attribute, and out-of-memory cases across two versions. Build parser fixtures.                                                      | Every claim has a stable source; unknown output fails closed. Text parsing is restricted to explicitly supported versions. | Silent parser drift creates false “supported” results.     |
| 3. Host-only versus device-required work           | Vela and Edge TPU compilation are host-side; TensorRT building normally needs a compatible GPU; OpenVINO device compilation has plugin/driver-specific requirements. | Attempt import, query, compile, load, and run separately with and without hardware/drivers.                                                                                                      | Per-adapter capability manifest records requirements for each stage.                                                       | Unexpected GPU/lab costs and unavailable compile capacity. |
| 4. Predicted versus actual placement               | Compiler partitioning is useful but can differ from runtime behavior.                                                                                                | Compare reported placement with runtime traces on models containing deliberate unsupported middle operations, shape operations, and postprocessing.                                              | Placement disagreements are understood and represented; no unexplained full-acceleration claims.                           | The central product claim becomes unreliable.              |
| 5. SDK/EULA permissions                            | Public downloads and Docker images do not necessarily permit a third-party compilation service.                                                                      | Review the exact package terms for hosted use, service-bureau use, result publication, log storage, redistribution, and credentials. Seek written clarification where necessary.                 | Approved deployment modes per SDK/version: hosted, customer runner, import-only, or prohibited.                            | Contractual exposure or forced integration withdrawal.     |
| 6. Canonical formats                               | A single executable IR will lose semantics or exclude toolchains.                                                                                                    | Export representative CNN, transformer, control-flow, and quantized models into ONNX/TFLite; compare preservation and adapter acceptance. Review PyTorch Export, TOSA, and StableHLO separately. | Native ONNX/TFLite retention plus a neutral descriptive graph schema; conversions remain explicit variants.                | Expensive conversion layer creates false equivalence.      |
| 7. Neutral operator model                          | Operator names alone cannot capture device support.                                                                                                                  | Test the same operation with different attributes, constant inputs, ranks, quantization schemes, and neighboring fusion patterns.                                                                | Shared schema expresses common constraints and preserves opaque vendor-specific requirements without asserting support.    | False positives from oversimplified rules.                 |
| 8. Attributes, shapes, quantization, layout, opset | Support often depends on a combination of these properties.                                                                                                          | Build a small adversarial operator corpus: Resize modes, Conv dilation/groups, dynamic Reshape, Gather indices, per-channel scales, signedness, and layout variants.                             | Exact constraints and unknown values survive ingestion, compilation, and normalization.                                    | Incorrect explanations and unsafe transformations.         |
| 9. Privacy, IP, export controls, retention         | Uploaded weights, graphs, and calibration data may be confidential or restricted.                                                                                    | Customer interviews plus legal/data-flow review; exercise deletion across artifacts, caches, backups, and remote providers.                                                                      | Approved retention/residency policy and customer-runner option; no third-party submission without explicit consent.        | Confidentiality breach or unusable SaaS model.             |
| 10. Fair benchmark comparison                      | Board power, cooling, host CPU, preprocessing, precision, and accuracy materially affect results.                                                                    | Repeat one workload across two boards with matched workload boundaries and controlled conditions. Record both inference-only and end-to-end timing.                                              | Comparable cohorts can be defined; unmatched measurements remain contextual rather than ranked.                            | Misleading buying recommendations.                         |
| 11. Hardware execution in MVP                      | Runtime proof needs hardware, but an arbitrary-model device farm is a separate product.                                                                              | Validate a fixed golden corpus on a small internal lab; measure reset, isolation, scheduling, and operational effort.                                                                            | Include internal hardware validation and device-backed compilation; defer unrestricted public hardware execution.          | Scope and operational burden overwhelm the MVP.            |
| 12. Depth Anything 3 variant                       | DA3 identity is confirmed; checkpoint, license, input mode, and export path still change feasibility substantially.                                                  | Select one permitted checkpoint and fixed input mode; export and compare outputs against the original implementation.                                                                            | A hashed export with a licensed distribution path and validated semantics. Otherwise keep it experimental.                 | Selecting unsuitable or restricted weights.                |

Discovery exit rule: Do not commit to a hosted adapter until automation, diagnostics, deployment rights, and version-specific target requirements are sufficiently understood. An unresolved integration may still support customer-generated report ingestion.

### 2.1 Cross-vendor sources: reuse assessment

| Source                | Findings                                                                                                                                                                                                                                                                                                                                                                                                                                       | Recommended use                                                                                                                                                                                                                                                              |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MLPerf Inference Edge | Versioned benchmark rules, accuracy requirements, scenarios, system metadata, result logs, and submission artifacts provide valuable measured evidence. The inspected v5.1 results repository is Apache-2.0 licensed; trademark and result-messaging requirements are separate. Results can later be modified or invalidated.                                                                                                                  | Import eligible, versioned results and system metadata, preserving submission identity, division, scenario, accuracy level, availability category, and provenance. Do not infer arbitrary-model compatibility or transfer a submitted result to another board configuration. |
| EEMBC MLMark          | Useful methodology and harness structure: explicit workload, target, precision, batch, concurrency, latency/throughput/accuracy. However, the latest default-branch commit observed was April 25, 2022, and the README describes an Ubuntu 16.04-era environment. Licensing is not safely summarized as “Apache-2.0”: the root agreement controls trademark use, while inspected source headers refer to an EEMBC Benchmark License Agreement. | Reuse methodological ideas. Do not adopt the old harness as the production foundation or redistribute it until licensing is clarified.                                                                                                                                       |
| AI Benchmark          | Public rankings are useful context, especially for mobile platforms. This review did not establish a supported bulk-data API, a clear commercial leaderboard redistribution grant, or a reproducible configuration manifest sufficient for this platform’s exact-tuple claims. A current website copyright date is not maintenance evidence.                                                                                                   | Link to results initially. Consider ingestion only through permission and a versioned data agreement; keep aggregate scores outside exact-model performance rankings.                                                                                                        |

MLPerf ingestion specifics: Preserve system JSON, result summaries, accuracy records, performance logs, measurement configuration, implementation references, and release commit. Filter by actual system type; a shared results repository can contain datacenter systems as well as edge systems.

Do not merge MLPerf Inference Edge, Tiny, Mobile, and Client results into a common score. They have different workloads and rules.

Sources: MLPerf Edge, inference rules, v5.1 results and license, MLMark repository, MLMark license, AI Benchmark.

### 2.2 Generic graph and runtime tools

| Tool                   | Integration role and limitations                                                                                                                                                                                                                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ONNX Python APIs       | Primary ONNX parsing, validation, schema inspection, and bounded shape inference. Preserve opset imports by domain, functions, subgraphs, external tensor data, and unknown shapes. Apache-2.0.                                                                                                                                                   |
| ONNX Runtime           | CPU reference execution, optional provider orchestration, optimized graph capture, and runtime profiling. MIT-licensed core; EP dependencies have separate terms. OperatorKernels.md is not a universal accelerator-support database: the inspected file lists CPU, CUDA, and DirectML registered kernels, not every EP’s graph-acceptance logic. |
| LiteRT/TFLite Analyzer | Supplemental human-readable graph and GPU-compatibility report. The experimental API prints its report to console; do not make this text the canonical graph parser. Parse FlatBuffers directly using a pinned schema. A GPU compatibility report does not establish actual device delegation.                                                    |
| ONNX GraphSurgeon      | Optional, versioned graph transformations, especially for TensorRT preparation. Apache-2.0. Never rewrite uploaded originals in place.                                                                                                                                                                                                            |
| ONNX Simplifier        | Optional normalization experiment, not a universal ingestion requirement. MIT. Pin and qualify a release; validate transformed outputs and shape assumptions.                                                                                                                                                                                     |
| Netron                 | Self-hosted or locally embedded visualization where feasible. MIT. It is a viewer, not a compatibility oracle; never send private models to an external viewer by default.                                                                                                                                                                        |

ONNX Runtime profiling yields JSON traces, but node/provider visibility and fused-subgraph detail vary by provider. Registered provider lists do not prove placement. Use profiling, optimization artifacts, provider diagnostics, and strict CPU-fallback controls where the pinned version supports them.

Sources: ORT kernel inventory, ORT profiling, TFLite Analyzer, ONNX, GraphSurgeon, ONNX Simplifier, Netron.

### 2.3 Primary vendor integrations

| Ecosystem               | Confirmed capabilities and maintenance evidence                                                                                                                                                                                                                                                                                                                                               | Adapter recommendation and constraints                                                                                                                                                                                                                                                                                                                                       |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NVIDIA TensorRT         | Active release stream. ONNX parser diagnostics, engine inspection, trtexec layer information, and profiling are available. Operator support must match the bundled parser, not GitHub main.                                                                                                                                                                                                   | Wrap parser APIs and trtexec; capture rejected nodes, plugin requirements, optimization profiles, layer precision/layout, build errors, and engine artifacts. Treat native TensorRT and ORT TensorRT EP as different execution paths. Building normally needs GPU resources. Review binary SDK/CUDA/container terms separately from open-source parser/sample licenses.      |
| Intel OpenVINO          | Active; a 2026.4.0 release was published September 16, 2026. Frontend support, device conformance, query_model, compile_model, profiling, and benchmarking are available. Model Analyzer is explicitly discontinued.                                                                                                                                                                          | Use maintained runtime APIs and benchmark_app, not Model Analyzer. Evaluate CPU, GPU, and NPU separately. NPU compilation/runtime depend on the relevant driver/compiler path. HETERO support varies by device and release.                                                                                                                                                  |
| Arm Ethos-U Vela        | Maintained Apache-2.0 compiler with released packages and current documentation. Accepts quantized TFLite and TOSA for supported Ethos-U configurations.                                                                                                                                                                                                                                      | Strong host-side adapter. Capture --show-cpu-operations, --supported-ops-report, placement/debug artifacts, and cycle/bandwidth/memory estimates. TFLite can retain CPU operations; TOSA has no CPU fallback. Deployment still requires the correct board runtime and CPU kernels.                                                                                           |
| Google Coral / Edge TPU | Public compiler documentation describes x86-64 Debian-based hosts, TFLite compilation, operation logs, runtime targeting, and quantization constraints. Current long-term compiler maintenance and hosted-use rights were not established. The legacy edgetpu repository explicitly says its remaining code is unmaintained; that alone does not prove every Coral component is discontinued. | Useful compatibility adapter, but defer from the committed MVP. Parse the compiled TFLite graph plus .log and --show_operations output. Internally quantized models can retain float I/O through CPU conversion. The documented compiler behavior can leave the remainder of the graph on CPU after an unsupported operation—do not assume arbitrary alternating partitions. |
| AMD Vitis AI            | Float-model Inspector workflows exist for framework-specific models and target DPU architectures. Current AMD documentation distinguishes older Vitis AI/DPU lines from newer NPU releases and version-coupled IP/toolchains.                                                                                                                                                                 | Separate inspection, quantization, compilation, and runtime adapters. Capture the exact DPU/NPU architecture or fingerprint, board image, and compiler generation. Do not treat Inspector success as compiled deployment. Do not conflate FPGA/Versal Vitis AI with Ryzen AI/XDNA tooling. SDK/IP/container rights require package-level review.                             |
| Hailo                   | Public Model Zoo documentation shows active stack updates and ONNX/TF → parse → optimize → compile → HEF workflows. Model Zoo is MIT, but that does not license the proprietary Dataflow Compiler.                                                                                                                                                                                            | Conditional expansion. Capture HAR/HEF provenance, calibration and optimization scripts, parser endpoints, profiler estimates, and actual HailoRT measurements. Hailo-8/8L/10/15 toolchain compatibility must be explicit. Excluded pre/postprocessing must remain visible; HEF generation is not proof the original whole graph is accelerated.                             |

NVIDIA fallback semantics: Native TensorRT does not provide general CPU fallback. ORT partitions across TensorRT, CUDA, and CPU providers according to configuration and support. TensorRT’s DLA-to-GPU fallback is another distinct case.

OpenVINO fallback semantics: HETERO partitions a graph across devices. AUTO selects execution devices and can involve fallback behavior, but it is not interchangeable with HETERO’s node-level partitioning. Record the requested and actual execution devices.

Sources: TensorRT ONNX guide, engine inspection, ORT TensorRT EP, OpenVINO operations, HETERO, discontinued Model Analyzer, Vela, Vela package/license, Coral compiler, Coral model constraints, AMD version compatibility, Hailo Model Zoo.

### 2.4 Qualcomm AI Hub assessment

Technically useful, but not a mandatory backend.

Confirmed public functionality includes:

- Python APIs for device discovery and compile/profile/inference jobs.
- ONNX, PyTorch, and AIMET-oriented input workflows.
- Target-runtime and QAIRT-version options.
- Downloadable compiled models, logs, and profiling artifacts.
- Physical-device profiling according to Qualcomm’s FAQ.
- Account/API-token authentication.
- Rate-limit handling in the compile API.
- Organization/job sharing controls.

The FAQ states that Workbench is currently free, customer model IP remains theirs to distribute, and temporary device/cloud-compute storage is wiped after jobs. These statements do not establish unlimited quotas, an SLA, complete account-storage retention terms, or permission to resell Workbench as an independent multi-tenant service.

Before integration, obtain answers covering:

| Area              | Required clarification                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Commercial rights | Third-party SaaS orchestration, service-bureau use, reselling access, and publishing comparative results.                      |
| Credentials       | Whether a service account is permitted; whether customers must use their own accounts; delegation and token-storage rules.     |
| Capacity          | Numeric quotas, concurrency, retry guidance, device availability, pricing-change policy, and SLA.                              |
| Ownership         | Rights to original models, transformed artifacts, logs, measurements, and redistribution of dependencies.                      |
| Privacy           | Persistent storage, backups, deletion guarantees, residency, subprocessors, and contractual confidentiality.                   |
| Reproducibility   | Exact physical versus family/proxy device identity, OS image, runtime version, and ability to rerun historical configurations. |
| Metadata reuse    | Permission to cache and republish device metadata rather than merely query it for jobs.                                        |

Recommended approach: First support customer-authorized result import or an optional customer-account connector. Keep the platform functional without Qualcomm’s service. Reuse its clear compile/profile/inference separation as UX inspiration, not as the platform’s internal schema.

Sources: devices, compilation, FAQ, compile API and rate-limit retry.

### 2.5 Other requested ecosystems

“Deferred” means the integration has not passed the adoption gates—not that the hardware is unsupported.

| Candidate                 | Public formats/workflow and maintenance evidence                                                                                                                                                                                                                         | Automation, legal constraints, and disposition                                                                                                                                                                                                                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Rockchip RKNN Toolkit2    | Public versioned SDK, currently documenting v2.3.2; ONNX/TFLite and other frontend paths; host conversion to RKNN with board-side runtime/evaluation.                                                                                                                    | Strong technical candidate. The SDK license is Rockchip-specific, not blanket Apache-2.0. It limits purpose and documentation use; third-party components have separate terms. Validate hosted use, diagnostic granularity, driver/runtime coupling, and CPU/GPU custom-op behavior before adopting. Repository/license                                                  |
| NXP eIQ                   | Multiple distinct accelerator stacks. Current Neutron documentation shows quantized TFLite conversion through an API/Olive workflow with target and SDK/BSP “flavor.” i.MX93’s Ethos-U path is different from i.MX95’s Neutron path and i.MX8M Plus’s accelerator stack. | Reuse Vela for applicable Ethos-U targets. Add Neutron and other eIQ backends as separate adapters; do not create one universal “NXP supported” rule. Review NXP and third-party binary terms and exact package maintenance. Neutron workflow                                                                                                                            |
| Renesas DRP-AI / RZ/V     | Public ONNX deployment examples, compile scripts, profiling/error documentation, and CPU+DRP-AI execution. The current repository states DRP-AI TVM has been integrated into RUHMI, powered by MERA.                                                                     | Good expansion candidate, but pin framework generation, RZ/V target, translator, BSP, and quantization path. Apache-2.0 repository content does not automatically cover translator/MERA binaries. Official repository                                                                                                                                                    |
| Ambarella CVflow          | Public Cooper platform information confirms compilers, SDKs, deployment/profiling tools, and integration with common frameworks. Exact currently supported interchange formats and unattended diagnostic contracts were not established from accessible documentation.   | Partner discovery only. Require SDK access, supported-format/version documentation, CLI samples, maintenance policy, and service/publication rights. Do not infer public integrability from marketing support claims. Cooper announcement                                                                                                                                |
| MemryX                    | SDK 2.2 release notes dated April 1, 2026; Neural Compiler CLI, ONNX and other frontend support, simulator, DFP output, and graph-cropping workflows.                                                                                                                    | Leading fourth-adapter candidate. Public terms explicitly allow commercial use and redistribution of unmodified compiler/simulator copies. Still validate component notices, diagnostics, and target execution. Autocropping can exclude pre/postprocessing; never classify the original model as fully accelerated solely from DFP success. Compiler, license, releases |
| SiMa.ai                   | Current public onboarding describes Palette Neat, ONNX compilation, containerized SDKs, and target-specific deployment. It explicitly distinguishes the newer stack from older Palette/MPK tooling.                                                                      | Potentially automatable after provisioning, but documented authentication includes interactive steps. Prove non-interactive service credentials and obtain SDK/service rights. Do not promise “any ONNX model” support. Current onboarding                                                                                                                               |
| Kneron                    | Public documentation lists ONNX conversion, compiler, quantizer, evaluator, simulator, and KL520/720/630/730 version compatibility.                                                                                                                                      | Container/CLI workflow is promising, but current compiler licensing, release cadence, and unattended entitlement were not conclusively verified. Defer until a package-level review and sample run. Documentation                                                                                                                                                        |
| Axelera AI                | Public Voyager SDK v1.8 documentation, deployment tools, and ONNX-oriented workflows.                                                                                                                                                                                    | Hosted-service blocker under the reviewed standard EULA: February 2026 terms restrict use to internal business purposes and prohibit hosting/timesharing without written consent. Seek permission; do not assume public GitHub access grants SaaS rights. SDK, EULA                                                                                                      |
| Google Tensor SoCs        | Android/LiteRT execution is practical, but an unrestricted, sufficiently documented exact-TPU compilation/placement path was not established here. Google Tensor TPU is not Coral Edge TPU.                                                                              | Device-specific research only. Require actual supported accelerator API, driver/OS identity, and placement evidence. Generic LiteRT execution must not become a “Tensor TPU supported” claim.                                                                                                                                                                            |
| Apple Core ML / ANE       | Core ML Tools supports conversion and deployment workflows; modern source-framework support is not equivalent to a general native ONNX importer. Prediction through the Core ML framework requires macOS.                                                                | Later native macOS runner, not a Linux-container assumption. Selecting CPU+ANE or all compute units does not prove all-ANE execution. Validate available compute-plan/profiling APIs and OS-specific behavior; review Apple runtime/SDK and hardware-hosting terms separately from coremltools. Prediction and compute units                                             |
| MediaTek NeuroPilot / APU | Current Genio docs describe NP Converter, ncc-tflite, and Neuron Runtime, with explicit NP/MDLA/SoC/OS coupling. Some SDK bundles are NDA-controlled. ONNX Runtime paths differ across platforms.                                                                        | Vendor/customer runner first. Obtain the matching SDK and rights; do not interpret generic ONNX execution as APU execution. Official resource matrix                                                                                                                                                                                                                     |
| Arm Mali GPU / Vulkan     | LiteRT GPU and ncnn/Vulkan are practical runtime paths. ncnn is BSD-3-Clause and has public ONNX/PyTorch conversion tooling. Arm NN now identifies itself as legacy and no longer actively maintained.                                                                   | Prefer a maintained runtime on an exact GPU/driver stack; do not make Arm NN a new untrusted-upload dependency. GPU delegation must be observed on hardware. Vulkan support is not an NPU capability. Arm NN status, ncnn                                                                                                                                                |
| Android NNAPI             | Officially deprecated in Android 15; available device drivers and acceleration vary by OS and OEM.                                                                                                                                                                       | Legacy compatibility/import only, not the strategic abstraction for new integrations. Pin device fingerprint, OS, driver, runtime, and accelerator selection. Android documentation                                                                                                                                                                                      |

---

## 3. Architecture

### 3.1 Recommended structure

Implementation decisions require accepted ADRs in [docs/decisions](docs/decisions/README.md).
The technologies below remain recommendations until their relevant ADR is accepted.
Docker/OCI is the selected reproducible toolchain packaging approach; see
[ADR-0002](docs/decisions/0002-use-docker-for-toolchains.md) for the comparison with Nix,
pinning requirements, hardware limitations, and isolation boundaries.

Use a modular control plane with out-of-process adapters and isolated workers. Avoid premature microservices, but enforce boundaries around untrusted execution and vendor dependencies from the beginning.

| Component                    | Responsibility                                                                                          | Practical implementation                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Web UI and API               | Catalog, model intake, configuration selection, matrix, evidence drill-down, exports.                   | TypeScript/React frontend; Python FastAPI with generated OpenAPI clients.                                                       |
| Hardware catalog             | Vendors, SoCs, accelerator instances, boards, revisions, OS/BSP support, dated offers and availability. | PostgreSQL, relational core plus constrained JSONB; editorial administration UI.                                                |
| Model registry and ingestion | Ownership, immutable artifacts, manifests, input declarations, licensing, lineage.                      | API plus quarantined ingestion workers.                                                                                         |
| Graph inspection             | Native ONNX/TFLite parsing and neutral descriptive inventory.                                           | Python workers using pinned ONNX and FlatBuffer tooling.                                                                        |
| Adapter framework            | Vendor-specific preparation, inspection, compilation, execution, profiling, and evidence extraction.    | Versioned manifest and JSON-schema protocol; separate OCI images or native runners.                                             |
| Scheduler                    | Durable workflows, quotas, retries, cancellation, leases, capability routing, device exclusivity.       | Temporal is a reasonable choice for long-running/local/remote workflows. A managed deployment reduces initial operational cost. |
| Execution workers            | Run parsing, conversion, SDKs, and optional runtime validation.                                         | Disposable VMs/microVMs for CPU jobs; dedicated GPU/device workers where passthrough requires it.                               |
| Artifact storage             | Models, generated binaries, graph snapshots, logs, reports, traces, dataset manifests.                  | Encrypted S3-compatible object storage with tenant-scoped authorization.                                                        |
| Raw-result retention         | Preserve original evidence independently of normalized interpretations.                                 | Content-addressed objects, retention classes, hashes, and immutable manifests within retention policy.                          |
| Normalization                | Translate vendor outputs into typed findings without discarding originals.                              | Versioned normalizers with fixture-based contracts.                                                                             |
| Compatibility/rules engine   | Aggregate evidence and explain constraints.                                                             | Deterministic, versioned rules—not an LLM deciding support.                                                                     |
| Benchmark ingestion          | MLPerf and approved vendor/community measurements.                                                      | Source-specific ETL with review, licensing metadata, and cohort validation.                                                     |
| Provenance/versioning        | Record every dependency, decision, transformation, and source snapshot.                                 | Append-only run records and content hashes.                                                                                     |
| Authentication/tenancy       | Organization/project membership, roles, service identities, sharing.                                    | OIDC/SAML-capable identity provider; database and object-level enforcement.                                                     |
| Observability/audit          | Job health, queue time, parser drift, costs, device state, access history.                              | OpenTelemetry, metrics, structured logs, and separate security audit events.                                                    |

Deployment options:

- Hosted control plane + approved hosted adapters: Simplest initial product.
- Hosted control plane + customer runner: Useful for confidential models or restricted SDKs, but does not automatically solve EULA restrictions.
- Private deployment: Enterprise option after the control-plane boundaries stabilize.
- Native runner support: Required for ecosystems that cannot operate in the standard Linux execution environment.

Do not require Kubernetes for the first lab or every worker. Adopt it where fleet size and operational maturity justify it.

### 3.2 Upload-to-matrix data flow

1. User uploads a model bundle into quarantine and supplies input signatures, ownership/license declarations, and privacy settings.
2. Ingestion verifies size limits, bundle paths, hashes, schema, and external tensor references.
3. Graph inspection produces an immutable inventory without rewriting the original.
4. The user selects exact target configurations, precision modes, and fallback policies.
5. The API returns existing evidence for exact authorized cache matches and clearly labeled static findings.
6. The scheduler dispatches missing analyses to compatible, legally approved worker pools.
7. Adapters save raw outputs and artifact manifests before normalization.
8. Normalizers produce operation findings, partitions, compiler outcomes, and evidence references.
9. Optional runtime validation checks outputs and observed placement; profiling creates a separate measurement record.
10. The rules engine derives a versioned result. The matrix updates incrementally and exposes unresolved evidence.

### 3.3 Evidence classes

Evidence labels must be visible per claim, not merely in a page footer.

| Badge                | Meaning                                                                                            |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| Measured             | Observed on identified physical hardware under a recorded protocol.                                |
| Vendor-tool reported | A pinned official tool reported placement, rejection, resource allocation, or compilation results. |
| Compiler-estimated   | Cost-model cycles, bandwidth, memory, latency, or throughput—not measurements.                     |
| Vendor-documented    | A statement in a versioned support matrix, manual, or release note.                                |
| Statically inferred  | A platform rule inferred something from graph properties.                                          |
| Community-reported   | Submitted externally; verification and trust level are separately recorded.                        |

Publisher and method are independent: a vendor-published benchmark can be measured, while its verification level remains “vendor-reported.”

Never label compiler placement as measured acceleration, or treat a compiler estimate as a benchmark.

---

## 4. Data model

### 4.1 Entities and relationships

| Entity                                  | Key fields and relationships                                                                                                                                           |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HardwareVendor                          | Name, identifiers, official sources, support/contact references. Owns SoCs and accelerator products.                                                                   |
| SoC                                     | Vendor, family, exact part number, CPU complexes, memory interfaces, integrated accelerator instances, lifecycle.                                                      |
| Accelerator                             | Type: GPU/NPU/TPU/DLA/etc.; architecture, generation, supported numeric modes, local memory, interconnect. Distinguish IP design from an instantiated configuration.   |
| Board / Module / System                 | Manufacturer, SKU, SoC, memory, carrier/module relationships, storage, interfaces, cooling, form factor, supported OS/BSP releases.                                    |
| HardwareRevision                        | PCB/BOM revision, stepping, firmware compatibility, memory population, validity dates. Referenced immutably by tested configurations.                                  |
| HardwareOffer                           | Seller, region, currency, quantity/MOQ, price, stock/lead time, timestamp, source, license. Never overwrite historical offers.                                         |
| SDK / Compiler / Runtime                | Product identity, component type, vendor, license, packaging and supported deployment modes.                                                                           |
| RuntimeVersion                          | Exact version/build, source revision, binary/package hashes, ABI, dependencies, supported devices and OS. Use equivalent version entities for compiler/SDK components. |
| ToolchainBundle                         | Exact compiler, runtime, parser, quantizer, plugins, drivers, libraries, firmware, container/base image, and license-policy versions.                                  |
| Model                                   | Logical family/project, task, upstream source, owner. Does not carry a universal compatibility flag.                                                                   |
| ModelVersion                            | Training/checkpoint revision, weight hashes, architecture revision, code and weight licenses.                                                                          |
| ModelVariant                            | Exported artifact identity, resolution, batch, input mode, precision, quantization, preprocessing/postprocessing boundary, transformation lineage.                     |
| ModelFormat                             | ONNX/TFLite/etc.; format version, ONNX IR version and domain/opset imports, or TFLite schema and builtin operator versions.                                            |
| GraphOperation                          | Stable source graph ID, subgraph/function path, node index/name, domain/op type/version, attributes, tensor edges, control-flow relationships.                         |
| Tensor                                  | Shape expressions, rank, dtype, layout and certainty, constant/reference hash, quantization metadata, storage location.                                                |
| OperatorRequirement                     | Predicate over operation/subgraph, attributes, tensors, target, tool version, and configuration; pass/fail/unknown; evidence source.                                   |
| Transformation                          | Parent/child variants, tool/version, parameters, calibration dataset hash, operation mapping, equivalence/accuracy results.                                            |
| CompilationJob                          | Request, attempt, variant, configuration, toolchain, worker, timestamps, exact command, environment allowlist, exit status, artifacts.                                 |
| TargetConfiguration                     | Hardware revision, selected accelerator set, OS/BSP, driver/firmware, runtime/provider order, fallback policy, power mode, memory constraints, shape profiles.         |
| CompatibilityResult                     | Outcome, stage, scope, placement summary, validation status, confidence rationale, normalizer/rules versions, supporting and conflicting evidence.                     |
| UnsupportedOperation                    | Operation/subgraph reference, rejection category, observed and allowed values, tool error code, raw log location, remediation candidates.                              |
| FallbackPartition                       | Source/compiled graph membership, assigned device/provider, reason, boundary tensors, transfers, measured/estimated/unknown impact.                                    |
| BenchmarkResult                         | Workload/protocol, latency distribution, throughput, energy, memory, quality, iterations, measurement scope, source submission, environment.                           |
| MeasurementEnvironment                  | Full system inventory, clocks/power settings, cooling, ambient conditions, host load, input pipeline, instrumentation and calibration.                                 |
| Evidence / Provenance                   | Evidence class, producer, artifact hash, claim scope, timestamp, source version, verification level, signature, retention/access policy.                               |
| SourceDocument                          | URL, publisher, document/release version, retrieval date, permitted snapshot/hash, section locator, reuse terms.                                                       |
| TestRun                                 | Compilation reference, hardware instance, input dataset/case hashes, seeds, shape/path coverage, reference outputs, tolerances, outcomes, traces.                      |
| UserOrganization / Project / Membership | Ownership and permissions; public/private visibility, roles, service identities, sharing grants, retention/residency policies.                                         |

### 4.2 Required example fields

| Concern            | Example representation                                                                                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Artifact hash      | SHA-256 of each file plus a deterministic bundle-manifest hash, including ONNX external tensor files. A graph-only hash is supplementary, not the identity of the weights. |
| ONNX versions      | ir_version, opset_imports = {"ai.onnx": 17, "custom.domain": 1}, exporter/build identity.                                                                                  |
| TFLite versions    | Schema version plus each operator’s builtin/custom code and version.                                                                                                       |
| Input signature    | Name images, dtype float32, dimensions [1, 3, 640, 640], layout NCHW, input range and normalization contract.                                                              |
| Dynamic dimensions | Named symbol, permitted minimum/maximum/step if known, equality constraints across tensors, optimization-profile min/opt/max, tested values. Unknown is not zero.          |
| Quantization       | Storage and expressed dtype, scales, zero points, per-tensor/per-channel axis, bit width, symmetry, Q/DQ representation, calibration method/data hash.                     |
| Placement          | Accelerator instance ID, provider/plugin, partition ID, original-to-compiled mapping quality, observed versus compiler-reported assignment.                                |
| Tool execution     | Argument vector, exact version output, binary hash, image digest, adapter commit, working-directory manifest, nonsecret relevant environment, timeout/resource limits.     |
| Raw evidence       | Object IDs and hashes for stdout/stderr, structured reports, generated model/engine, optimized graph, partition graph, traces, and compiler configuration.                 |
| Confidence         | Ordinal assurance level, completeness fields, known contradictions, and rationale—not an invented probability such as “97% compatible.”                                    |

### 4.3 Historical reproducibility

Define an analysis fingerprint over:

Artifact bundle + transformation/calibration lineage + input/profile settings + target configuration + complete toolchain + adapter/configuration

A normalized interpretation additionally references its normalizer and rules-engine versions.

- Never silently update a historical result to a newer SDK.
- Re-normalizing old logs creates a new interpretation linked to the original run.
- Store negative and inconclusive results as well as successful ones.
- Use tenant-scoped caching unless a model/result was explicitly published.
- Record both requested and resolved settings; compiler defaults can change.
- Separate byte-reproducible builds, functionally reproducible outputs, and statistically repeatable measurements.
- If deletion or vendor-package unavailability prevents rerunning a result, explicitly mark its reproducibility limitations.

---

## 5. Compatibility-analysis strategy

### 5.1 Layer 1: Static preflight

Extract the graph through format-native tooling.

For ONNX, include nested graphs, local functions, domains/opsets, constant inputs, external data, and shape constraints. For TFLite, include subgraphs, builtin options, operator versions, custom operations, and quantization metadata.

The canonical inventory should describe semantics, not attempt to become a new compiler IR.

Rules are three-valued: satisfied, violated, or unknown.

Example:

 Resize  appears in a support table, but this instance uses an unsupported coordinate-transformation mode.

That is a specific rejected variant, not “Resize unsupported” or “Resize supported.”

Do not infer layout solely from dimension order when the model does not establish it. Preserve the source semantics and mark inferred layout explicitly.

### 5.2 Layer 2: Vendor inspection and compilation

The adapter contract should provide optional capabilities for:

- Environment and entitlement checks.
- Static inspection.
- Model preparation/conversion.
- Compilation.
- Artifact inspection.
- Runtime validation.
- Profiling.
- Raw-result collection and normalization.

The capability manifest declares accepted formats, target families, supported version ranges, host architecture, required hardware, output schemas, privileges, network requirements, and permitted deployment modes.

Diagnostic preference order:

1. Supported structured API.
2. Documented structured artifact.
3. Version-pinned machine-readable tool output.
4. Version-pinned text parser.
5. Manual review.

If a tool’s output changes unexpectedly, keep the raw evidence and produce Inconclusive, not a guessed result.

### 5.3 Layer 3: Runtime validation

Validate three separate properties:

- Loadability: The generated artifact loads on the specified runtime/device.
- Functional execution: The complete declared graph executes on the stated inputs.
- Numerical correctness: Outputs meet predefined tolerances against an appropriate reference.

Task-level accuracy is an additional result. Passing a few output comparisons does not establish COCO mAP, depth quality, or speech accuracy.

Capture actual provider/device placement where exposed. For opaque fused regions, report the granularity supported by the evidence. Do not fabricate per-original-node placement.

### 5.4 Layer 4: Hardware execution and profiling

Run only on identified, exclusively leased devices with known firmware, drivers, clocks, power mode, and cooling.

Collect:

- Cold-start, compilation, load, first-inference, and steady-state timing separately.
- Inference-only versus application end-to-end timing.
- Transfer, synchronization, preprocessing, and postprocessing costs.
- Host and accelerator memory.
- Power/energy when instrumentation is suitable.
- Thermal and throttling state.
- Output/quality validation results.

### 5.5 Layer 5: Normalization and classification

| Evidence condition                                                                                             | Result                                                 |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| No applicable run or authoritative exact-path finding                                                          | Not tested                                             |
| Missing SDK, unavailable device, timeout, license failure, parser mismatch, or unresolved conflicting evidence | Inconclusive, with operational reason                  |
| Definitive documented exclusion of the selected format/configuration/path                                      | Unsupported by selected configuration                  |
| Actual conversion or compilation attempt failed                                                                | Compile/conversion failed                              |
| Compiled artifact exists, but execution was not validated                                                      | Compiled—execution unverified, with reported placement |
| Load/execution or required numerical validation failed                                                         | Runtime/validation failed                              |
| Validated execution; complete required graph placement on selected accelerator set                             | Fully accelerated                                      |
| Validated execution; some required graph computation on selected accelerator and some elsewhere                | Partially accelerated                                  |
| Validated execution through software without verified selected-accelerator work                                | Executable with software fallback                      |
| Execution occurred, but placement or required validation remains unknown                                       | Inconclusive, retaining “execution observed” as a fact |

Compilation may stop at the first error. Label diagnostic completeness accordingly; do not suggest that the reported list contains every incompatibility.

### 5.6 Fallback partitions and impact

Represent fallback as a partition graph, not just a count of unsupported operators.

Each partition should expose:

- Source nodes or mapped fused regions.
- Actual or proposed provider/device.
- Unsupported constraint or partitioning-policy reason.
- Input/output boundary tensors.
- Transfer sizes when derivable.
- Layout conversions, quantize/dequantize steps, and synchronization.
- Whether it is on the critical path.
- Measured, estimated, or unknown timing impact.

A model with one CPU operation can perform worse than one with many CPU operations if it causes large transfers or synchronization. Therefore:

- Node-count coverage is descriptive, not a speedup estimate.
- FLOP/MAC coverage is optional and explicitly approximate.
- Do not sum per-layer times into end-to-end latency without accounting for overlap and measurement semantics.
- Without calibrated evidence, say impact unknown or explain the qualitative risk.

### 5.7 Plugins, transformations, and conversions

Custom operations/plugins

Store domain, version, ABI, target architecture, binary hash, license, and runtime dependencies. A plugin-required model is not supported until the plugin is present and validated.

User-provided native plugins are outside the public MVP. Approved plugins require review and isolated execution; a plugin running inside a GPU engine is not automatically proof that all its work occurs on GPU.

Transformations

Every simplification, shape specialization, precision conversion, NMS extraction, or quantization creates a new variant with:

- Parent artifact.
- Tool/version and parameters.
- Operation mapping.
- Calibration data provenance where applicable.
- Numerical and task-quality checks.
- A changed-workload declaration when semantics or boundaries change.

Canonical-format decision

- ONNX and TFLite: First-class native artifacts.
- PyTorch Export: Later trusted export workflow; useful but not a universal target format.
- TorchScript: Import legacy artifacts only when a specific toolchain requires them; do not make it the new common representation.
- TOSA: Adapter-facing format for relevant targets; its execution/fallback semantics differ from TFLite.
- StableHLO: Potential later frontend where a target stack consumes it; not required for the MVP.
- Vendor IRs: Preserve as artifacts, not portable model identities.

---

## 6. MVP recommendation

### 6.1 Three committed ecosystems

| Ecosystem        | Initial adapter scope                                                                                                                           | Why it belongs                                                                                                  |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| NVIDIA TensorRT  | ONNX import/build/inspection; native TensorRT and a separately configured ORT TensorRT/CUDA/CPU path. GPU execution first; DLA later.           | Strong embedded adoption, mature tooling, and a clear demonstration of compiler coverage versus fallback.       |
| Intel OpenVINO   | ONNX and qualified TFLite intake; CPU/GPU paths first, exact-device NPU configurations after driver qualification; explicit HETERO experiments. | Covers multiple device classes through maintained APIs and provides a useful CPU reference/deployment baseline. |
| Arm Ethos-U Vela | Quantized TFLite compilation, CPU-operation reporting, resource estimates, board-specific configuration; selected internal runtime validation.  | Strong diagnostic value, host-side automation, permissive compiler licensing, and low-power embedded relevance. |

Leading fourth candidate: MemryX, contingent on a short adapter-quality spike. Its public commercial-use terms and recent release make it a better initial expansion candidate than automatically selecting Coral or a cloud-dependent service.

If NVIDIA hosted-use approval is blocked, evaluate a customer-runner deployment or substitute the approved fourth candidate. Do not silently proceed under an assumed license interpretation.

### 6.2 Initial hardware catalog

Start with approximately four physical systems, plus clearly labeled accelerator-reference configurations:

- Jetson Orin Nano developer kit.
- Jetson AGX Orin developer kit.
- One exact Intel Core Ultra system exposing CPU, integrated GPU, and NPU.
- NXP i.MX93 evaluation board using its Ethos-U path.
- Optional Ethos-U reference configurations for compile analysis only—not presented as purchasable boards or measured systems.

Fix exact SKU, memory, revision, carrier, cooling, power supply, and BSP during procurement.

The catalog may list additional products as catalog-only / not evaluated, but search results must not imply they have equivalent compatibility coverage.

### 6.3 Model scope

- Native ONNX and TFLite.
- Static, batch-one vision models first.
- FP32/FP16 and already quantized INT8 variants.
- A small operator probe suite and curated model library.
- Explicit paired ONNX/TFLite variants from a common source, with validation.

Do not promise arbitrary ONNX-to-TFLite conversion. Shared model-family names do not establish equivalence between independently exported variants.

### 6.4 Initial matrix fields

Model artifact/variant; board/revision; accelerator; format; input signature; precision; compiler/runtime versions; outcome; evidence stage; graph boundary; placement; fallback partitions; top blockers; correctness status; measured performance if available; resource estimates; last evaluated date; provenance link.

### 6.5 Defer

- Unrestricted public hardware execution.
- Large device farms and automated multi-tenant board flashing.
- Arbitrary uploaded Python/PyTorch code and native plugins.
- Automatic “repair until it compiles.”
- Universal conversion between model formats.
- Hosted NDA-restricted SDKs without approval.
- General LLM/VLM benchmarking and KV-cache policy comparisons.
- A universal performance score or TOPS-derived FPS.
- Broad price scraping without data rights.

MVP hardware policy: Use a small internal lab for golden-model validation and device-dependent compilation. New user uploads receive static and compilation evidence; runtime claims appear only after actual validation.

---

## 7. UX and comparison-matrix design

### 7.1 Model intake

The upload flow should establish:

- Artifact identity, format, and version.
- Inputs, dynamic dimensions, and permitted profiles.
- Precision and existing quantization.
- Calibration data only when a requested transformation needs it.
- In-graph versus external preprocessing/postprocessing.
- Accuracy requirements.
- Custom operators and plugin dependencies.
- Privacy, retention, region, and third-party processing consent.

Show an ingestion preview before scheduling expensive work. Flag missing information as Needs input, not hardware incompatibility.

### 7.2 Target selection and filtering

Separate:

- Hardware requirements: Form factor, memory, interfaces, thermal envelope, accelerator type.
- Deployment requirements: OS, architecture, BSP, offline operation, supported runtime, licensing.
- Commercial requirements: Price region/quantity, availability date, lifecycle.
- Evidence requirements: Measured only, compiled only, no CPU fallback, current SDK, verified accuracy.

Display unknown values explicitly. Never interpret missing price, power, or availability as zero.

### 7.3 Matrix behavior

- Pin a model artifact and pivot targets against versions/precisions.
- Allow side-by-side compiler/runtime versions without replacing history.
- Display status text and icons, not color alone.
- Keep evidence stage adjacent to outcome.
- Show No measurement instead of a fabricated estimate.
- Warn when comparing different model variants or workload boundaries.
- Provide exact-match and related-model results in separate sections.
- Make “why not fully accelerated?” a first-class action.

### 7.4 Hypothetical YOLO matrix

Illustration only—not actual compatibility or benchmark findings. Assume a YOLO-style ONNX artifact, opset 17, input  1×3×640×640 , with decode/NMS included. Toolchain labels below stand for immutable manifests containing exact versions and hashes.

| Target/path                      | Toolchain     | Outcome                               | Placement/evidence                        | Explanation                                                                                                  |
| -------------------------------- | ------------- | ------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Jetson, native TensorRT GPU      | TRT-A         | Fully accelerated                     | GPU execution and numerical checks passed | Complete declared graph covered; approved plugin dependencies recorded if needed.                            |
| Jetson, ORT TensorRT/CUDA/CPU    | TRT-A + ORT-A | Partially accelerated                 | Runtime trace shows CPU postprocessing    | Backbone accelerated; a postprocessing partition runs on CPU in this fictional run.                          |
| Intel GPU + CPU, OpenVINO HETERO | OV-A          | Partially accelerated                 | Runtime placement verified                | A fallback partition and its boundary tensors are shown.                                                     |
| Intel NPU, native OpenVINO       | OV-B          | Compiled—execution unverified         | Compiler reports full NPU placement       | No target execution or accuracy claim yet.                                                                   |
| Intel CPU, OpenVINO              | OV-A          | Executable on CPU                     | Runtime validated                         | Useful baseline; not advertised as NPU/GPU acceleration.                                                     |
| Ethos-U, Vela                    | Vela-A        | Unsupported by selected configuration | Format constraint                         | This path requires a separately versioned quantized TFLite/TOSA artifact; the ONNX upload was not converted. |
| Another catalog target           | —             | Not tested                            | None                                      | No matching adapter run or submitted evidence.                                                               |

Drill-down should show the original operation, exact rejected attribute/shape/type, compiler diagnostic, source location, compiled partition, proposed remedy, and whether the remedy changes the workload.

---

## 8. Evaluation and validation plan

### 8.1 Golden corpus

Maintain both small diagnostic graphs and real model artifacts.

| Family                                    | Initial purpose                                                                                                                     |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| MobileNetV1/V2/V3                         | Quantized CNNs, depthwise convolution, activation variants.                                                                         |
| ResNet-18/50                              | Residual connections and common convolutional baselines.                                                                            |
| EfficientNet-B0                           | Compound scaling, squeeze/excitation, activation/export differences.                                                                |
| SSD-MobileNet                             | Detection outputs and postprocessing boundaries.                                                                                    |
| YOLOv5n / YOLOv8n / YOLO11n               | Exporter variation, detection/segmentation/pose, in-graph versus external NMS. Review each code/weight license before distribution. |
| U-Net / DeepLabV3-MobileNet               | Segmentation, upsampling, concatenation, spatial dimensions.                                                                        |
| MoveNet or a compact pose model           | Multi-output and coordinate/postprocessing behavior.                                                                                |
| DistilBERT or MobileBERT encoder          | Gather, attention-related patterns, masks, sequence-length constraints.                                                             |
| Keyword spotting and Whisper-tiny encoder | Audio input contracts, convolution/transformer paths; encoder-only boundaries clearly labeled.                                      |
| Depth Anything V2 Small                   | Transformer-backed depth export and resizing, subject to exact checkpoint licensing.                                                |
| Depth Anything 3                          | Identity confirmed; experimental until checkpoint, license, export, and input-mode gates pass.                                      |

The public library should contain only redistributable artifacts. Restricted datasets or weights can be represented by manifests and customer-supplied files.

### 8.2 Operator and fallback assertions

Include minimal graphs covering:

- An unsupported operation between two supported regions.
- Unsupported attribute variants of an otherwise supported operation.
- Dynamic shape/profile boundaries.
- Control flow and multiple subgraphs.
- INT8 signedness, per-channel quantization, and Q/DQ patterns.
- Constant versus runtime inputs.
- Layout conversion.
- Missing versus installed custom plugins.
- Missing CPU fallback kernels.
- Memory exhaustion and invalid configuration.
- Deliberately malformed models.

Every adapter needs positive, negative, partial, and inconclusive cases. Expected results are tied to specific versions; a new compiler may legitimately change them.

### 8.3 Adapter contract and compiler regression tests

For each supported tool version:

- Validate output schemas.
- Replay raw-log fixtures.
- Require explicit handling of missing or unknown fields.
- Test cancellation, timeout, retries, and duplicate delivery.
- Confirm that infrastructure failure never becomes “unsupported.”
- Compare placement and rejection reasons across versions.
- Verify artifact hashes and full provenance.
- Require review when output parsing or status interpretation changes.

A release gate should require zero false full-acceleration classifications in the supported golden suite. This is a finite test guarantee, not a claim of universal accuracy.

### 8.4 Hardware-in-the-loop strategy

Start with dedicated devices and an internal scheduler:

- Exclusive lease per run.
- Known-good image and health check.
- Pre-run environment capture.
- Automated model transfer and cleanup.
- Watchdog, bounded execution, and explicit recovery.
- Power/thermal stabilization.
- Post-run health verification.
- Manual quarantine after unexplained device failures.

Customer-contributed measurements should include a signed manifest and trust level. A signature establishes provenance, not automatically the truth of the measurement.

### 8.5 Benchmark methodology

For platform-produced measurements:

- Separate cold and warm execution.
- Use fixed batch, concurrency, input data, and shape.
- Record warm-up policy, iteration count, and duration.
- Report median and tail latency, not just the best sample.
- Measure sustained behavior and note throttling.
- Report inference-only and end-to-end results separately.
- Measure accuracy/quality under the same deployed variant.
- Record host CPU contribution and transfers.
- State whether power is accelerator-only, board-level DC, or wall power.
- Keep instrument calibration and sampling rate.
- Use repeated runs and uncertainty intervals.

Comparison rule: Rank only within a compatible measurement cohort. Different precision modes may be compared for product selection if quality constraints are satisfied, but must not be presented as identical-model measurements.

MLPerf results retain their official scenarios and metrics. Do not convert Offline throughput into SingleStream latency or extrapolate one benchmark to another model.

### 8.6 Retention and reproducibility

Retain licensed golden artifacts and complete run manifests. Preserve raw diagnostics for the advertised audit window.

A reasonable initial policy to validate commercially is:

- Public approved reference artifacts: long-term retention.
- Private uploads and raw job artifacts: configurable retention, with a short default such as 30 days.
- Immediate access revocation on deletion.
- Documented asynchronous purge and backup-expiry deadlines.

Deleting evidence must update reproducibility status; immutability cannot override customer deletion obligations.

---

## 9. Security, privacy, and operational concerns

| Concern                       | Required controls                                                                                                                                                                                                    |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Untrusted ONNX/TFLite parsing | Parse in isolation with CPU, memory, time, graph-size, tensor-size, and recursion limits. Treat native parser libraries as attack surfaces.                                                                          |
| External data and bundles     | Reject path traversal, absolute paths, symlink escapes, undeclared external files, archive bombs, and network references. Validate hashes before use.                                                                |
| Compiler isolation            | Disposable execution environments, read-only SDKs, no host filesystem mounts, no Docker socket, least privilege, restricted syscalls, and default-deny egress. Containers alone are not the complete trust boundary. |
| GPU/device access             | Dedicated workers or appropriately isolated VMs; explicit device allowlists; reset and cleanup procedures. Do not assume GPU process isolation equals tenant security isolation.                                     |
| Native plugins and engines    | Reject arbitrary uploaded plugins and precompiled executable engines in the public MVP. Treat generated engines as potentially dangerous artifacts when loading them.                                                |
| Model/IP confidentiality      | Encryption in transit/at rest, tenant-scoped authorization, short-lived artifact URLs, private-by-default results, explicit consent for third-party compilation.                                                     |
| Logs and diagnostics          | Logs can expose graph structure, names, paths, or data. Apply access controls and redaction; do not copy model internals into general observability systems.                                                         |
| Multi-tenant isolation        | Separate credentials, storage authorization, caches, temp directories, quotas, and worker leases. Prevent cross-tenant hash/existence disclosure.                                                                    |
| Retention and deletion        | Cascading deletion across originals, transformed models, calibration data, caches, logs, vendor jobs, and backups according to a documented policy.                                                                  |
| Software and model licenses   | Separate code, weights, datasets, SDKs, firmware, plugins, container layers, and benchmark trademark rights. Keep an approved license manifest per integration version.                                              |
| Supply chain                  | Pin image and package digests; retain SBOMs; verify signatures where available; scan images; control SDK acquisition; approve updates through regression tests.                                                      |
| Credentials                   | Secret manager and short-lived runner credentials. Never include tokens or license secrets in reproduction manifests or logs.                                                                                        |
| Export controls/residency     | Legal review of model/SDK transfers and remote execution locations where relevant; regional execution policies and customer-controlled deployment.                                                                   |
| Operational abuse             | Per-organization quotas, cost limits, maximum fan-out, cancellation, circuit breakers, and bounded retries.                                                                                                          |
| Catalog integrity             | Source attribution, editorial review, correction history, evidence-expiry rules, and clear vendor/community verification levels.                                                                                     |

Avoid autonomous LLM interpretation of compiler logs as an authoritative result. An LLM may later help explain already-normalized findings, but it should not decide placement, compatibility, or legal eligibility.

---

## 10. Delivery plan

### 10.1 Phased milestones

Indicative schedule: approximately 18–26 weeks to a private beta, assuming SDK rights and hardware access are not blocked. Phases can overlap; the estimates are planning ranges, not commitments.

| Phase                                                | Goals and dependencies                                               | Deliverables                                                                                                                             | Exit criteria                                                                                                                                            | Main risks and roles                                                                                      |
| ---------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 0. Discovery and legal feasibility — 2–4 weeks       | Resolve the critical uncertainties before infrastructure commitment. | Integration/license register, hardware procurement list, model corpus, DA3 gate, raw example outputs, deployment-mode decisions.         | Three viable integrations with understood automation, diagnostics, and legal paths.                                                                      | Access/EULA delays. Architect/ML lead, ML systems engineer, platform engineer, fractional legal.          |
| 1. Proof-of-concept adapters — 3–4 weeks             | Requires approved SDK access and initial devices.                    | TensorRT, OpenVINO, and Vela adapters; representative positive/negative/partial runs; environment manifests.                             | Repeatable unattended jobs; no unexplained full-acceleration results; raw evidence retained.                                                             | Driver coupling and opaque diagnostics. Two ML/compiler engineers plus embedded support.                  |
| 2. Schema and normalization — 2–3 weeks, overlapping | Informed by real outputs, not designed entirely in advance.          | Versioned adapter contract, data model, provenance format, classifier, parser fixtures, migration strategy.                              | Lossless raw retention; explicit unknowns; history preserved across re-normalization.                                                                    | Lowest-common-denominator schema. Backend engineer and ML lead.                                           |
| 3. MVP — 6–8 weeks                                   | Depends on stable contracts and execution isolation.                 | Catalog, private uploads, exact-config matrix, async jobs, explanations, artifact export, tenancy, quotas, internal golden measurements. | End-to-end workflows meet functional and security gates; cached matrix target p95 under two seconds; bounded preflight envelope measured and documented. | UX complexity and unsafe worker assumptions. Backend, frontend, platform, ML, QA.                         |
| 4. Private beta — 4–6 weeks                          | Small set of design partners and production-like operations.         | Customer-runner pilot, SDK regression workflow, benchmark cohorts, deletion drills, operational dashboards, corrected catalog.           | Users can make and reproduce hardware-selection decisions; no unresolved critical isolation issues; false-positive incidents have corrective workflows.  | Support burden, proprietary workloads, missing evidence. Product/UX, solutions/embedded engineer, QA/SRE. |
| 5. Expansion — incremental 6–12-week tracks          | Driven by demand and integration gates.                              | MemryX/RKNN/Renesas/NXP additions; licensed Hailo/Qualcomm connectors; broader HIL measurements; later Apple/Android paths.              | Each adapter passes the same contract, legal, maintenance, and evidence-quality gates.                                                                   | Vendor fragmentation and fleet cost. Dedicated adapter owner plus lab/platform capacity.                  |

### 10.2 Approximate team

A credible core team is five to seven engineers:

- One principal architect/ML systems lead.
- Two ML/compiler integration engineers.
- One backend/data engineer.
- One frontend/full-stack engineer.
- One platform/security/SRE engineer.
- Shared or dedicated embedded/HIL and QA capacity.

Add fractional product design, legal/licensing, and technical catalog curation. Budget for devices, power instrumentation, SDK access, and replacement hardware—not only cloud compute.

Reusable role agents are defined in `.github/agents/`. The principal architect
uses `gpt-6-astra`; the nine specialist profiles use `gemini-3.8-flash`. The two
ML/compiler engineer positions share one role profile with separate bounded tasks.
Embedded/HIL and QA have separate profiles, as do product design, licensing research,
and catalog curation. Agent profiles are not human approvals or legal authority.

### 10.3 Development governance and CI/CD

Follow [AGENTS.md](AGENTS.md), [CONTRIBUTING.md](CONTRIBUTING.md), and the
[architecture decision log](docs/decisions/README.md). Major choices require an ADR
with context, alternatives, consequences, and validation before implementation.
Load the installed ponytail skill for coding/design work without weakening security,
accessibility, typing, or tests.

Every backend feature, frontend component, adapter, and nontrivial tooling change
uses red-green-refactor TDD. Add strict language/framework linting, formatting,
type/build checks, behavioral tests, and coverage gates in the same PR that adopts
the stack. Update GitHub Actions with each relevant feature or delivery change, not as
a later cleanup. The initial pipeline checks repository documentation, configuration,
Dockerfile, and tested governance tooling; unwired application languages are blocked
until their real gates are implemented.

Use digest-pinned Docker images, locked dependencies, and legally approved SDK
acquisition. Add deployment promotion, scanning, approvals, health checks, and rollback
with the first deployable service. GitHub branch protections and approval requirements
must be configured separately by an authorized maintainer; committed files alone
cannot enforce those server-side settings.

The repository is hosted at <https://github.com/L-series/edge-comparator>.
Trusted owner/main CI uses an isolated Docker runner on the owner's local machine;
public pull-request checks use GitHub-hosted runners, never that machine. See
ADR-0004 for the trust boundary, approval policy, and remaining self-hosted-runner risk.

### 10.4 Production acceptance criteria

Before broad release:

- Every compatibility badge resolves to an exact configuration and evidence.
- Compiler estimates never appear as measured performance.
- CPU/GPU/NPU placement is not inferred from runtime availability alone.
- Unknown parser output cannot produce a success claim.
- Transformations and calibration are reproducible and explicitly versioned.
- Historical SDK results remain independently accessible.
- Private artifacts cannot cross organization boundaries.
- Deletion and remote-provider cleanup behavior are documented and exercised.
- Each supported adapter has a named maintainer and retirement policy.
- Performance comparisons enforce workload/environment comparability.
- No vendor integration depends on unreviewed service or redistribution rights.

---

Executive recommendation

Build the versioned evidence and explanation layer first. Its defensibility comes from reproducible artifacts, exact configurations, trustworthy placement information, and honest uncertainty—not the number of vendor logos or specification fields.

Proposed MVP boundary

Three ecosystems—TensorRT, OpenVINO, and Vela—with native ONNX/TFLite intake, a small exact-SKU catalog, a curated model corpus, asynchronous compilation, strict outcome semantics, and an internal validation lab. Do not include a universal converter, unrestricted device farm, or unsupported hosted SDK integrations.

Highest-risk unknowns

The most consequential risks are hosted SDK rights, compiler-to-runtime placement fidelity, diagnostic stability, transformed-model equivalence, and the operational cost of hardware-backed validation. DA3 is confirmed as Depth Anything 3; checkpoint selection, licensing, input mode, and export validation remain explicit model-library gates.

First five engineering tasks

1. Create the integration approval register: Pin candidate SDK packages; review licenses, maintenance, automation, hardware requirements, and result-publication rights.
2. Build the diagnostic corpus: Small operator/partition probes plus a few licensed real models, including paired ONNX/TFLite exports and expected numerical outputs.
3. Capture real adapter evidence: Run the three shortlisted stacks on success, partial-placement, unsupported-attribute, and environmental-failure cases; retain raw artifacts.
4. Define the immutable result contract: Model/configuration fingerprints, evidence classes, transformation lineage, partition mapping, and deterministic status rules.
5. Deliver one vertical slice: Private model upload → static inventory → one isolated compiler job → normalized evidence → matrix cell → exact diagnostic/provenance drill-down.
