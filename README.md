# Edge AI Comparator

[![CI](https://github.com/L-series/edge-comparator/actions/workflows/ci.yml/badge.svg)](https://github.com/L-series/edge-comparator/actions/workflows/ci.yml)

A vendor-neutral edge-AI hardware comparison platform, starting with a **local
ONNX compiler-evidence demo**. Inspect a model's exact identity and graph, then
compile it on the local CPU using pinned **OpenVINO 2026.4.0**. Compare the
compiler's observation with unevaluated targets and inspect retained evidence.

**Compilation is not execution or acceleration.** Successful runs say
**Compiled — execution unverified**. Typed compiler rejections say **Compile failed**;
environmental or ambiguous failures remain **Inconclusive**. The catalog contains
NVIDIA Jetson Orin Nano, a local CPU/OpenVINO path, and
NXP i.MX93 / Arm Ethos-U65, with official source links. These are catalog entries,
not exact evaluated board/software configurations.

## Run locally

Use Linux, Node **24.21.0** and uv (CI pins **0.12.17**). Python is selected by
`backend/.python-version`; dependencies are locked in `uv.lock` and npm lockfiles.

In one terminal:

```sh
cd backend
uv sync --frozen --all-groups
uv run --frozen uvicorn edge_comparator.api:app --host 127.0.0.1 --port 8000
```

In another:

```sh
npm --prefix frontend ci --ignore-scripts --no-audit --no-fund
npm --prefix frontend run dev
```

Open <http://127.0.0.1:5173>. The development UI proxies `/api` to the loopback
backend. Select targets, choose an ONNX file, and select **Inspect model** for
transient preflight without retaining the upload.
Do not expose either development server publicly.

### Five-minute compiler demo

1. Click **Load supported CNN**, check **Save model and evidence locally**, then
   **Compile on local CPU**. Inspect the CPU result, actual processor/compiler
   identity, evaluation fingerprint, query-support map, and downloadable artifacts.
2. Click **Load unsupported operator** and consent again. Compilation preserves
   the real frontend rejection identifying `com.edge.demo.MysteryActivation`.
   Jetson and NXP remain **Not tested** in both cases.
3. Restart the API and reload the page. Open either record from history, download
   its original model/report/diagnostics/lockfile, then delete a selected run.

These tiny models are generated locally, with original synthetic weights.
No external model download or real application-quality claim is involved.

The API is also available directly:

```sh
curl --fail http://127.0.0.1:8000/api/targets
curl --fail-with-body http://127.0.0.1:8000/api/inspect \
  -H 'Content-Type: application/octet-stream' --data-binary @your-model.onnx
```

## Evidence and safety boundary

Accepted uploads are bounded, flat, self-contained ONNX models up to **16 MiB**.
The preview rejects external tensor files, nested graphs, model-local functions,
and input types it cannot represent honestly. Rejection is an **ingestion
limitation**, not a hardware incompatibility result.

Parsing and compiler work occur in separate resource-bounded subprocesses.
Compilation requires explicit retention consent: original bytes, stdout/stderr,
diagnostics, dependency lock and report are stored privately under
`~/.local/share/edge-comparator/evidence` (override `EDGE_COMPARATOR_DATA_DIR`).
The ceiling is **20 runs / 512 MiB**, with no silent eviction. Delete runs through
history; a full or damaged store reports an error instead of pretending to save.
Only one API process is supported.

No inference, performance measurement, or remote model upload is implemented.
Telemetry is disabled before SDK import in a private temporary HOME.
Native workers still have local process authority and network access: this is
**not a hostile-upload sandbox** or an authenticated service. Use trusted models
on a trusted single-user machine only. Production isolation, tenancy, privacy
policy, and independent security/legal approval remain required.

The evidence badge **Static inferred / preflight** describes the inventory, not
compiler or hardware support. Actual compatibility requires a versioned model
variant, exact target configuration, compiler/runtime evidence, and applicable
runtime validation. DA3 means **Depth Anything 3**; no DA3 checkpoint, weights,
export pipeline, or support claim ships in this preview.

## Development and CI

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
```

The root command checks repository governance. Backend, frontend, browser, and
package-build gates are also mandatory in CI; see [CONTRIBUTING.md](CONTRIBUTING.md)
and the [backend](backend/README.md) and [frontend](frontend/README.md) guides.

Trusted owner/main CI runs in an isolated Docker runner on the owner's machine.
PR checks run on GitHub-hosted runners, never on that machine.
[Runner operations](ci/README.md) documents registration, maintenance, and the
remaining public-repository trust risks. No deployment pipeline is configured.

Major choices require [architecture decision records](docs/decisions/README.md).
[ADR-0005](docs/decisions/0005-prototype-local-onnx-preflight.md) authorizes only a
reversible discovery implementation; production stack adoption is still Proposed.
[ADR-0006](docs/decisions/0006-local-compiler-evidence-demo.md) records the bounded
compiler/evidence extension; it also remains Proposed for production adoption.
The [full product plan](PLAN.md) covers additional adapters, validated execution,
and measured hardware comparisons. This demo is not the three-adapter MVP.
