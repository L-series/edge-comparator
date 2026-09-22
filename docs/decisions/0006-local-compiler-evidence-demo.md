# ADR-0006: Build a local compiler-evidence demo

Status: Proposed

Date: 2026-09-22

Refinement (2026-09-22): SDK spike evidence replaces `Core.read_model` with typed
frontend import and the rejected compilation-thread option with child CPU affinity.

## Context

The user authorizes sustained implementation through the first real
compiler-backed demonstration, extending the local discovery scope of
[ADR-0005](0005-prototype-local-onnx-preflight.md). Static ONNX inventory alone
cannot establish whether a compiler accepts a model. The next slice must show
real compilation success and failure with inspectable, retained evidence.

This record authorizes no production adoption or hosted SDK service. It remains
Proposed pending independent human production-architecture review. User
authorization for local discovery is not security or legal approval.

## Decision

Implement one local adapter: **OpenVINO 2026.4.0, CPU only**, contingent on the
package/license and telemetry gates recorded in `docs/integrations/openvino.md`.
Verify deterministic telemetry opt-out through an officially supported or
source-confirmed mechanism before SDK invocation, including import. If that
cannot be established, do not invoke the SDK. Never transmit model/IP data to
external services. Pin the package and dependency lock; record actual loaded
versions rather than assuming the requested version was installed.

Retain existing bounded ONNX preflight: raw input at most 16 MiB, no external
tensor files/references, nested graphs, or model-local functions. Invalid input
remains an ingestion rejection, not a compiler or hardware incompatibility.
Use a fresh child with fixed `CPU` target and supported options
`INFERENCE_PRECISION_HINT=f32`, `INFERENCE_NUM_THREADS=1`, `NUM_STREAMS=1`,
`PERFORMANCE_HINT=LATENCY`. Do not set unsupported `COMPILATION_NUM_THREADS`.
Constrain compilation via child-only Linux `sched_setaffinity` to one allowed
logical CPU, retaining CPU/wall/memory bounds; record actual options and affinity.
No AUTO/HETERO device selection, fallback policy, GPU/NPU, TensorRT, Vela,
remote API, inference, or benchmark execution is included.

Import with official `FrontEndManager.load_by_framework('onnx').load/convert`,
then call `Core.query_model` and `Core.compile_model`. Preserve stage diagnostics
and placements for **imported OpenVINO nodes**, not fabricated ONNX-node mappings.
Query support is not runtime placement; an omitted node is not a compile failure.
Requested f32 is not proof of executed precision. Report these outcomes:

| Outcome               | Meaning                                                                                               |
| --------------------- | ----------------------------------------------------------------------------------------------------- |
| `compiled_unverified` | CPU compilation returned successfully; execution and numerical correctness remain unverified          |
| `compile_failed`      | An actual compiler/importer rejection, with stage `import`, `query`, or `compile` and raw diagnostics |
| `inconclusive`        | Environment, timeout, malformed worker output, or storage failure prevents trustworthy evidence       |

Typed conversion/validation failures, including `openvino.frontend.OpConversionFailure`,
are `compile_failed`. That class is not a `RuntimeError` subtype; `Core.read_model`
wraps it. Generic `RuntimeError`/`GeneralFailure` stays `inconclusive`, without log parsing.
Display `intel-openvino-cpu` as **Local CPU via OpenVINO**, with SDK-reported identity.
AMD results do not endorse Intel Core hardware; Jetson/NXP stay **Not tested**.

### Consented local evidence

Keep `/api/inspect` transient and unchanged. Compilation requires explicit
`X-Retain-Evidence: true` consent, represented by a UI checkbox explaining that
model bytes and diagnostics will be retained locally. No implicit consent.
Store original bytes, raw worker stdout/stderr, diagnostics, the locked
dependency manifest, and typed result JSON under a private user-owned root:
`~/.local/share/edge-comparator/evidence`, or explicit
`EDGE_COMPARATOR_DATA_DIR`. Use directories `0700`, files `0600`, generated UUID
run names, and fixed artifact names, never uploaded filenames or path fragments.

Publish complete immutable run directories atomically from staging on the same
filesystem; remove incomplete staging data on failure. Immutability lasts until
explicit deletion. Enforce at most **20 runs and 512 MiB total**, including
bounded staging/output accounting. Return an explicit capacity error, never
silently evict evidence. Storage failure must not return a durable-success
claim or pretend that an unpersisted run exists.

Each run records artifact hashes, original model SHA-256, requested and actual
compiler package/build versions, SDK-reported CPU identity, OS/architecture/
Python, compiler options, adapter source fingerprint, and dependency-lock hash.
Record a container digest only when genuinely known; otherwise record explicit
unknown, never substitute a source commit or image tag. Hash a canonically
serialized configuration manifest with defined ordering and unknown values;
exclude run UUID/timestamps from configuration identity. Do not embed secrets.
Manifest/result hashing must avoid circular self-hashes.

Use stdlib filesystem operations and typed JSON, not PostgreSQL, SQLite, or a
queue. Expose bounded history, exact-run retrieval, allowlisted artifact
downloads, and explicit deletion. Validate UUIDs/artifact names and ownership;
reject traversal and symlink escapes. Historical inspection preserves evidence,
not a promise to recreate a lost SDK, host, or device environment.

### API and execution boundary

The backend's typed models define the exact shared `CompilationRun` schema:

- `POST /api/compile`: raw ONNX plus retention consent, returning a
  `CompilationRun` when evidence is successfully published.
- `GET /api/runs`: bounded history; `GET /api/runs/{uuid}`: exact result.
- `DELETE /api/runs/{uuid}`: delete that run and its artifacts.
- `GET /api/runs/{uuid}/artifacts/{name}`: retrieve an allowlisted artifact.
- `GET /api/demos/{id}`: generated public synthetic ONNX fixtures
  `supported-cnn` and `unsupported-op`, not third-party model downloads.

Run one API process and admit only one in-flight upload/inspection/compile
operation. Return visible busy `503`, not unbounded queuing. The compile request
waits synchronously for its result, but child waiting must not block the API
event loop. Use explicit CPU/memory/output limits and a wall-clock cap within
30-60 seconds; terminate/reap timed-out children and release admission state.
No fake background-job state or scheduler is needed.

The parent writes private fixed-name `model.onnx` into the request's temporary
`HOME` before the child applies `RLIMIT_FSIZE=0`; no uploaded names or external data.

This is loopback-only, single-user local discovery, without SaaS,
authentication, multitenancy, or a general sandbox. Constrained subprocesses
limit damage but the native child is **not network-isolated**. A Python socket
audit guard does not constrain native SDK networking. No hostile public uploads;
the UI must disclose retained data and make exact deletion accessible.

## Alternatives considered

- **Vela first:** useful host-side compilation but requires a TFLite-focused
  path; OpenVINO directly extends the existing ONNX/CPU preview.
- **TensorRT first:** introduces GPU availability, driver coupling, and distinct
  binary-SDK deployment rights before this bounded milestone needs them.
- **SQLite or PostgreSQL:** useful for concurrent queries and transactions, but
  unnecessary for 20 immutable runs and one writer. Revisit before multi-process
  access, larger retention, or query requirements outgrow directory manifests.
- **Arbitrary inference:** would require trusted input generation, numerical
  references, workload boundaries, and execution safety. Compile-only evidence
  answers a smaller real question without pretending to answer those.
- **Parsing log prose for status:** brittle across SDK releases. Use structured
  APIs and explicit stages for outcomes; retain raw logs as evidence, not an
  autonomous compatibility oracle.

## Consequences

The demo can establish one exact local CPU compiler acceptance/rejection with
provenance and retained diagnostics. It does not complete the three-adapter
MVP, phase 0, runtime validation, hardware acceleration, or production adoption.
SDK opt-out, disk capacity, immutable publication, deletion, and environment
versioning become real maintenance responsibilities. Missing provenance remains
explicitly unknown; native execution does not acquire a fictitious image digest.

## Validation

The parent owns worker/API integration and retains TDD and strict gates from
[ADR-0004](0004-use-github-actions-with-an-isolated-local-runner.md).
Package/license findings remain required; unresolved telemetry blocks invocation.

SDK spike (2026-09-22): real Relu conversion/CPU compilation succeeded on AMD Ryzen 9
7950X3D with stated options; `demo.edge.MissingDemoOp` raised `OpConversionFailure`.
`COMPILATION_NUM_THREADS` was rejected; no inference was performed.
For `openvino-telemetry` 2025.2.0, opt-out file value `0` plus `CI=true` was confirmed by
a real subprocess checker with consent false and a Python socket audit guard.
This verifies opt-out, not native network isolation.

Require marked real-compiler CNN/custom-op tests; mocks cover process/storage failures.
Test consent, options/affinity/provenance, classifications, timeouts/busy states,
malformed output, limits/permissions, atomic publication, hashes, restart history,
traversal rejection, and deletion. Cover typed exceptions outside `RuntimeError`;
unapplied CPU affinity must fail visibly.

The browser demo covers upload, real success/failure, raw diagnostics, restart history,
download hash verification, and deletion. Preserve `/api/inspect`; all strict tests,
builds, browser checks, and both CI routes must pass. Missing prerequisites are not a pass.
Exit with a live demo and focused reviewed/merged commits, not just this spike.
Remaining milestone checks and human production/security/legal approvals are pending.

## References

- User direction of 2026-09-22 authorizing the local compiler-evidence milestone.
- [ADR-0005](0005-prototype-local-onnx-preflight.md) and
  [ADR-0002](0002-use-docker-for-toolchains.md).
- [Pinned OpenVINO package](https://pypi.org/project/openvino/2026.4.0/);
  package, transitive-license, and opt-out findings belong in
  `docs/integrations/openvino.md`, not an assumed permission here.
