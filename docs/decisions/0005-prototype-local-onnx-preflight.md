# ADR-0005: Prototype local ONNX preflight

Status: Proposed

Date: 2026-09-22

Amendment (2026-09-22): the user authorizes the bounded local compiler-evidence
extension in Proposed [ADR-0006](0006-local-compiler-evidence-demo.md), including
one gated OpenVINO CPU adapter and explicitly consented local retention through
separate compile/history endpoints. The original preflight scope and rationale
below remain unchanged: `/api/inspect` stays transient and returns Not tested.
This extension does not accept either record's stack for production.

## Context

The user has authorized starting implementation rather than stopping at
governance. A useful first discovery slice can inspect an uploaded ONNX model
and show how little a static inventory proves about hardware compatibility.
It does not need a database, scheduler, authentication system, or licensed
compiler SDK.

Python/FastAPI and TypeScript/React are candidates in the plan, not Accepted
production architecture. This record stays Proposed pending independent human
production-adoption review. The user's start-building instruction authorizes
only the bounded, reversible local experiment below; it is not an implicit
acceptance of the production stack.

## Decision

For the authorized local preview, use Python with FastAPI and the official ONNX
parser, plus React, TypeScript, and Vite for the browser interface. Use native
Node tooling for the frontend/build and retain Node's built-in runner for
bootstrap governance. Lock Python dependencies with `uv` and frontend tooling
with the npm lockfile. Keep a small API and a single inspect-and-compare flow;
do not add service layers, plugin frameworks, storage, or queue abstractions.

The backend and frontend owners implement and validate this discovery slice.
An independent human architecture owner must review its evidence before
accepting these choices for production. No approval reference is claimed.

### Preview contract

`GET /api/health` returns `{"status":"ok"}`. It reports process health, not SDK,
accelerator, or model readiness.

`GET /api/targets` returns an array of objects with `id`, `name`, `vendor`,
`accelerator`, `source_url`, and `configuration_status: "catalog_only"`.
The three catalog IDs are:

| ID                        | Catalog scope                                             |
| ------------------------- | --------------------------------------------------------- |
| `nvidia-jetson-orin-nano` | NVIDIA Jetson Orin Nano family entry                      |
| `intel-openvino-cpu`      | Intel/OpenVINO CPU path, not an identified measured board |
| `nxp-imx93-ethos-u65`     | NXP i.MX93 / Arm Ethos-U65 family entry                   |

Names, accelerator descriptions, and authoritative source links are catalog
metadata only. These entries do not select an exact board revision, driver,
compiler/runtime configuration, supported precision, or fallback policy.

`POST /api/inspect` accepts raw binary ONNX in `application/octet-stream`, not
multipart upload, with a maximum body size of **16 MiB (16,777,216 bytes)**.
Enforce the actual byte limit even when `Content-Length` is absent or incorrect.
On success, return this shape:

```typescript
type TensorInfo = {
  name: string;
  dtype: string;
  shape: Array<number | string | null>;
};

type Inspection = {
  evidence_type: "static_inferred";
  stage: "preflight";
  model: {
    sha256: string;
    format: "onnx";
    ir_version: number;
    opsets: Record<string, number>;
    inputs: TensorInfo[];
    outputs: TensorInfo[];
    operations: Array<{
      index: number;
      name: string;
      domain: string;
      op_type: string;
    }>;
    node_count: number;
  };
  results: Array<{
    target_id: string;
    status: "not_tested";
    reason: string;
  }>;
};
```

Hash the original uploaded bytes with SHA-256; do not hash a reserialization.
Preserve declared opset domains and versions, node order, names, types, and
declared dimensions. Concrete dimensions remain numbers, symbolic dimensions
remain strings, and unknown dimensions remain `null`, never fabricated zeroes.
Do not guess dimensions or convert an unknown rank into a scalar claim; input
types that cannot be represented honestly by this bounded schema are outside
the preview and must be explicitly rejected.

`results` contains exactly one entry for each of the three target IDs, always
`not_tested`. Reasons must explain the absence of compiler/runtime/hardware
evaluation. The UI displays **Not tested**, static evidence scope, and
catalog-only configuration. No compatibility badge, compile estimate,
acceleration claim, or fabricated benchmark is permitted.

| Condition                                                  | HTTP status and meaning                                               |
| ---------------------------------------------------------- | --------------------------------------------------------------------- |
| Invalid ONNX or an unsupported preview ingestion construct | `422`; explain the ingestion limitation, not hardware incompatibility |
| Wrong content type                                         | `415`                                                                 |
| Body exceeds 16 MiB                                        | `413`                                                                 |
| Inspection worker timeout                                  | `503`; unavailable preflight, not an unsupported model                |

Unexpected worker or infrastructure failures must be visible failures, never a
successful empty inventory or a hardware-unsupported classification. The UI
shows useful errors and permits another attempt; it must not show a stale
successful inspection as the outcome of a failed upload.

### Execution and data boundary

Parse in a short-lived subprocess with explicit CPU, memory, and wall-clock
bounds. Terminate and reap the process on timeout and clean up request-scoped
resources on both success and failure. Validate the byte limit before parser
work and keep concurrency bounded; per-request limits alone do not bound
aggregate resource consumption.

Reject external tensor references/files, nested graphs, and model-local
functions in this preview. Do not resolve external data, execute graphs,
perform shape inference, download model assets, or load native plugins or
vendor SDKs. Use the official parser to read model metadata; do not implement a
parallel ONNX parser. A flat accepted inventory is not complete ONNX semantic
validation or proof of runtime execution.

Keep model contents transient, with no persistent upload store, result cache,
or payload logging. Any temporary artifacts must be request-scoped and deleted.
Return only the requested metadata; do not send models to third-party services.
Serve on loopback for local development and do not expose this unauthenticated
preview as a SaaS endpoint.

The subprocess and resource limits are damage-limiting measures, not a general
sandbox. Native parsing still carries risk and runs with local process
authority unless separately isolated. Do not process hostile public uploads on
a developer machine; production ingestion requires reviewed isolation,
authorization, tenancy, retention, and network controls.

## Alternatives considered

- **A static mock UI:** cheaper, but would not validate the real upload, parser,
  error handling, and browser/API contract. The preview uses real ONNX bytes
  while deliberately refusing to claim hardware results.
- **A CLI-only inspector:** useful internally, but does not exercise the
  requested model-to-comparison user flow. Keep the web slice narrow rather
  than building a complete catalog application.
- **Node-only backend or a custom ONNX parser:** avoids a Python service but
  adds unnecessary parsing work instead of using the official Python package
  that is relevant to planned ML integrations.
- **Full production FastAPI/React platform now:** premature selection of
  storage, scheduling, tenancy, and SDK deployment would outrun feasibility
  and human approval. The prototype must remain disposable.
- **Rust/Go or a server-rendered frontend:** credible future alternatives, but
  no measured need justifies introducing another implementation language for
  this discovery experiment.

## Consequences

The preview demonstrates a real model inspection and an honest, deliberately
unevaluated comparison matrix. Two language toolchains and native parser
dependencies add setup and maintenance costs, so their checks must arrive with
the feature rather than later.

There is no persistent history, multi-user isolation, hardware execution,
export conversion, model download, or DA3 integration. DA3 means Depth Anything
3, but checkpoint licensing and export feasibility remain separate gates;
many large or complex exports will intentionally exceed this preview's scope.
The target list is small metadata, not a hardware-support database.

The schema and code can be replaced after discovery because nothing is a
production data contract. Promoting the preview to a shared service, adding
untrusted uploads, or treating these catalog IDs as exact evaluated hardware
requires new evidence and human-approved architecture. Delete or revise the
experiment if the stack fails its evaluation; do not infer production adoption
from the existence of working code.

## Validation

Follow the TDD quality principles retained by
[ADR-0004](0004-use-github-actions-with-an-isolated-local-runner.md). The
implementing PRs or bootstrap commits must preserve red/green/refactor evidence
with test identifiers, commands, and outcomes; this ADR does not assert tests
have already run.

The same change must wire Ruff formatting/lint, strict mypy, pytest with branch
coverage and an explicit enforced floor, Python package build, strict `tsc`,
ESLint, Prettier, Vitest/React Testing Library, frontend build, and Playwright
user flows into real CI. Lockfile-based installs must fail on drift. Do not
allow an empty suite, fake application job, broad suppression, or best-effort
failure to stand in for these gates.

Backend tests must cover the health/catalog contracts, known-byte hash,
opsets and node order/count, declared/symbolic/unknown dimensions, and exactly
three `not_tested` results. Cover valid and invalid models, external references,
nested graphs/functions, wrong media type, exactly-at/over the byte limit,
missing/dishonest length headers, timeout, and process cleanup. Prove rejection
does not read external model data or produce compatibility claims.

Frontend tests must verify upload/loading/results/error states and accessible
status text. Real Playwright flows must send a small generated ONNX fixture
through the actual API, show its inventory and all three Not tested rows, then
exercise a rejected upload and recovery. Mock-only UI tests are insufficient
evidence of integration.

The implementation owners record measured behavior and unresolved limitations.
An independent human owner must approve production stack adoption and separate
security/legal owners must approve their respective boundaries before any
production or public-upload use. Those approvals are pending, not implied by a
green discovery pipeline.

## References

- User direction of 2026-09-22 authorizing implementation while retaining
  human approval for major production choices.
- [Project plan](../../PLAN.md), sections 1.3–1.5, 3, 5.1, 7, 8, and 9.
- [FastAPI documentation](https://fastapi.tiangolo.com/).
- [ONNX serialization API](https://onnx.ai/onnx/api/serialization.html).
- [Vite guide](https://vite.dev/guide/).
- Framework/parser sources consulted 2026-09-22; exact implementation versions
  belong in the committed lockfiles, not an unverified version claim here.
- [ADR-0001](0001-record-architecture-decisions.md),
  [ADR-0002](0002-use-docker-for-toolchains.md), and
  [ADR-0004](0004-use-github-actions-with-an-isolated-local-runner.md).
