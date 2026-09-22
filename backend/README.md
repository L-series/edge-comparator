# Edge-AI Comparator Backend: Reversible Local Preflight Prototype

## Experiment Scope & Architectural Context

This service implements a minimal, reversible local preflight prototype for the Edge-AI Hardware Comparator, aligned with the recommendations in `PLAN.md` and authorized under [ADR-0005: Prototype local ONNX preflight](../docs/decisions/0005-prototype-local-onnx-preflight.md).

### Architecture Governance Notice

- **Pending Human Review:** Production architecture acceptance remains pending human review. This implementation is an experimental prototype and does not self-approve architecture.
- **Scope Boundaries:** Includes only a FastAPI HTTP layer and a resource-bounded ONNX inspection subprocess.
- **Deliberate Omissions:** Per the prototype charter, this service explicitly includes **no database or persistence storage**, **no message queue or worker pool**, **no authentication or multi-tenancy**, and **no vendor compiler SDKs or hardware runtimes**.
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
- `intel-openvino-cpu` (Intel Core Processor with OpenVINO)
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

1. **Child Subprocess Isolation:**
   - The backend API process itself **never deserializes** ONNX models.
   - Uploaded bytes are streamed via standard input directly into a short-lived child process (`edge_comparator.parser_worker`).
   - The child runs with a minimal environment in a request-scoped temporary directory. `RLIMIT_FSIZE=0` prevents regular-file growth; it does not prohibit all filesystem access or writes.
   - Linux resource limits (`setrlimit`) constrain the worker's address space (~1 GiB) and CPU time (~10s).
   - Limits are set by the worker before loading ONNX, not through thread-unsafe `preexec_fn`. Timeout/cancellation kills and reaps the child; request-scoped directories are cleaned up.
   - Worker stdout is capped at 4 MiB and stderr at 64 KiB. A typed protocol and uploaded-byte hash check reject malformed or mismatched metadata as infrastructure failure, never hardware incompatibility.
2. **Threat Model & Deployment Restrictions:**
   - **NOT a secure hostile-input sandbox:** Subprocess resource limits provide fault containment and denial-of-service mitigation; they do not constitute a virtualization-strength security sandbox against adversarial bytecode or native exploits.
   - **Loopback Dev-Only:** Designed strictly for single-worker local loopback use (`127.0.0.1`).
   - **Single Active Upload/Parse:** The same slot bounds body buffering and parsing; concurrent requests receive immediate `503 Service Unavailable`. Run exactly one API worker for this preview.
3. **Data Privacy & Logging:**
   - Model bytes and internal tracebacks are not logged. Validation errors returned to the uploading client may name graph elements; infrastructure logs contain only bounded failure reasons.
   - Ingestion limitations are clearly labeled as parser preview boundaries, not model hardware failure.

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

# Hermetic package build check
uv build --no-sources
```
