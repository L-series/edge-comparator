# Edge-AI Comparator Backend: Local Compiler Evidence

## Experiment Scope & Architectural Context

This service implements a minimal, reversible local preflight prototype for the Edge-AI Hardware Comparator, aligned with the recommendations in `PLAN.md` and authorized under [ADR-0005: Prototype local ONNX preflight](../docs/decisions/0005-prototype-local-onnx-preflight.md).

### Architecture Governance Notice

- **Pending Human Review:** Production architecture acceptance remains pending human review. This implementation is an experimental prototype and does not self-approve architecture.
- **Scope Boundaries:** FastAPI, bounded ONNX preflight, pinned OpenVINO CPU compilation, and consented private filesystem evidence under [Proposed ADR-0006](../docs/decisions/0006-local-compiler-evidence-demo.md).
- **Deliberate Omissions:** No database, scheduler, authentication, multi-tenancy, inference, hardware acceleration validation, or performance measurements.
- **Evidence Stage:** All inspection results are marked as `stage: 'preflight'` and `evidence_type: 'static_inferred'`. Target outcomes remain strictly `status: 'not_tested'` with explicit rationale. Accepted preflights are never labeled accelerated.

## Getting Started

### Prerequisites

- Python 3.12.13 (specified in `.python-version`)
- `uv` package manager
- Linux for the resource-bounded parser (including Linux Docker containers).

### Local Setup

From within the `backend/` directory:

```bash
# Lock and sync exact dependencies
uv sync --frozen --all-groups
```

### Startup

Run the development server bound to loopback:

```bash
uv run --frozen uvicorn edge_comparator.api:app --host 127.0.0.1 --port 8000
```

## API Contract

### 1. `GET /api/health`

Health probe endpoint.

- **Response `200 OK`:**

  ```json
  {
    "status": "ok"
  }
  ```

### 2. `GET /api/targets`

Returns an array of exactly three source-backed target hardware catalog entries with `configuration_status: "catalog_only"`:

- `nvidia-jetson-orin-nano` (NVIDIA Jetson Orin Nano Developer Kit)
- `intel-openvino-cpu` (Local CPU via OpenVINO; the SDK vendor is not the host CPU manufacturer)
- `nxp-imx93-ethos-u65` (NXP i.MX 93 Applications Processor with Arm Ethos-U65)

No unsupported numeric performance claims or pricing are included; specific software/SDK toolchain versions are not selected.

### 3. `POST /api/inspect`

Performs static preflight inspection of raw ONNX model payloads.

- **Headers:** `Content-Type: application/octet-stream` (required, non-multipart).
- **Body:** Raw ONNX bytes up to 16 MiB.
- **Responses:**
  - `200 OK`: Model metadata (SHA-256 of exact uploaded bytes, IR version, declared opset domains/versions, input/output tensors, operations inventory, node count) and target assessment results (`not_tested`). The default ONNX opset domain is normally `""`; explicit domain strings are preserved.
  - `400 Bad Request`: Invalid Content-Length header.
  - `408 Request Timeout`: Upload body not received within 10 seconds.
  - `413 Payload Too Large`: Payload exceeds 16 MiB.
  - `415 Unsupported Media Type`: Header is not `application/octet-stream`.
  - `422 Unprocessable Content`: Empty/corrupt ONNX, more than 10,000 nodes, more than 4 MiB of metadata, or unsupported preview features (external tensor data, sparse tensors, nested/training graphs, local functions, non-tensor IO, unknown tensor rank).
  - `503 Service Unavailable`: Parser worker busy (concurrent parse attempted), worker timeout (10s), or subprocess execution failure.

## Security & Operational Boundaries

### Compiler and evidence API

`POST /api/compile` accepts the same raw ONNX intake plus required
`X-Retain-Evidence: true`. It preflights before calling the pinned ONNX frontend,
queries the imported graph, and compiles with fixed CPU/f32 settings. No AUTO,
HETERO, extensions, inference requests, or fallback execution are enabled.
Only typed frontend conversion/validation errors become `compile_failed`;
generic SDK/environment errors remain `inconclusive`. Success is
`compiled_unverified`, never a numerical-correctness or acceleration assertion.
Query support does not prove runtime placement or original-ONNX-node mapping.

The synchronous request returns its immutable persisted record. Invalid intake
keeps the inspection status codes; missing consent is 400, busy/unavailable
storage/provenance is 503, and capacity exhaustion is 507. A compiler rejection
is a successfully retained **200 record with `compile_failed`**, not an intake 422.
If storage fails, no durable-success response is returned.

| Route                                   | Behavior                                                         |
| --------------------------------------- | ---------------------------------------------------------------- |
| `GET /api/runs`                         | Newest-first bounded run summaries                               |
| `GET /api/runs/{uuid}`                  | Full typed report, including exact configuration fingerprint     |
| `GET /api/runs/{uuid}/artifacts/{name}` | Verified original model, stdout/stderr, diagnostics or `uv.lock` |
| `DELETE /api/runs/{uuid}`               | Delete only this run; 204 on completion                          |
| `GET /api/demos/supported-cnn`          | Original synthetic Conv/Relu/pooling/classifier ONNX             |
| `GET /api/demos/unsupported-op`         | Valid ONNX with an intentionally unavailable custom operation    |

Default evidence root: `~/.local/share/edge-comparator/evidence`, overridable with
`EDGE_COMPARATOR_DATA_DIR`. Files are 0600, run/root directories 0700. The
20-run/512-MiB quota includes reports; there is no automatic eviction. Checksums,
ownership, inventory and schema corruption surface explicitly. Atomic staging
publication prevents incomplete runs from appearing as successful records.
Abandoned `.staging-*` entries after a process/host crash block new saves/history:
stop the API and inspect/recover or remove only that specific orphaned directory.
Never delete the whole evidence root to repair one run.

Store operations are serialized in their actual filesystem thread, including
when an HTTP waiter is cancelled. Deletion can remove corrupted allowlisted
files but refuses unknown children or symlinks. Run exactly one API process.
Historical evidence proves an observation, not automatic recreation of a vanished
SDK/host. A missing container digest stays unknown, even when running in Docker.

### Process and privacy limits

1. **Child Subprocess Isolation:**
   - The backend API process itself **never deserializes** ONNX models.
   - Uploaded bytes are streamed via standard input directly into a short-lived child process (`edge_comparator.parser_worker`).
   - The child runs with a minimal environment in a request-scoped temporary directory. `RLIMIT_FSIZE=0` prevents regular-file growth; it does not prohibit all filesystem access or writes.
   - Linux resource limits (`setrlimit`) constrain the worker's address space (~1 GiB) and CPU time (~10s).
   - Limits are set by the worker before loading ONNX, not through thread-unsafe `preexec_fn`. Timeout/cancellation kills and reaps the child; request-scoped directories are cleaned up.
   - Worker stdout is capped at 4 MiB and stderr at 64 KiB. A typed protocol and uploaded-byte hash check reject malformed or mismatched metadata as infrastructure failure, never hardware incompatibility.
   - The compiler child has one-logical-CPU affinity, 45/50s CPU limits, 4 GiB address-space limit, zero core/file-growth limits, and a 60s wall deadline. Its private fixed-name input and telemetry opt-out file are created before limits. Complete raw output is retained when available; termination/output-overflow may leave no complete output, explicitly reported in diagnostics.
   - SDK and telemetry pins are checked before SDK import. No developer HOME or credentials are passed. See [versioned license/telemetry findings](../docs/integrations/openvino.md). Native workers are not network-isolated.
2. **Threat Model & Deployment Restrictions:**
   - **NOT a secure hostile-input sandbox:** Subprocess resource limits provide fault containment and denial-of-service mitigation; they do not constitute a virtualization-strength security sandbox against adversarial bytecode or native exploits.
   - **Loopback Dev-Only:** Designed strictly for single-worker local loopback use (`127.0.0.1`).
   - **Single Active Upload/Parse/Compile:** The same slot bounds body buffering, parsing and compiler work; concurrent requests receive immediate `503 Service Unavailable`.
3. **Data Privacy & Logging:**
   - Model bytes and internal tracebacks are not logged. Validation errors returned to the uploading client may name graph elements; infrastructure logs contain only bounded failure reasons.
   - Ingestion limitations are clearly labeled as parser preview boundaries, not model hardware failure.
   - Compilation alone retains explicitly consented models/diagnostics; inspection stays transient. API responses disable caching. Loopback is not authentication against other local users: this is a trusted single-user machine experiment, not a private multi-user service.

## Quality Gates & Verification

From `backend/`:

```bash
# Sync locked dependencies
uv sync --frozen --all-groups

# Linting
uv run --frozen ruff check .

# Formatting check
uv run --frozen ruff format --check .

# Strict type checking
uv run --frozen mypy src tests

# Test suite with branch coverage >= 90%, JUnit XML and Coverage XML reports
uv run --frozen pytest
uv run --frozen pytest -m integration --no-cov --junitxml=reports/compiler-integration.xml

# Package build check
uv build --no-sources
```

The wheel includes the exact `uv.lock` as provenance. Editable development uses
the repository lock; missing provenance fails compilation explicitly.
