# Edge AI Comparator

[![CI](https://github.com/L-series/edge-comparator/actions/workflows/ci.yml/badge.svg)](https://github.com/L-series/edge-comparator/actions/workflows/ci.yml)

A vendor-neutral edge-AI hardware comparison platform, starting with a **local
ONNX preflight preview**. Upload a model to inspect its exact SHA-256, opsets,
input/output signatures, and operation inventory, then view a target matrix.

**Every target is currently Not tested.** This preview does not invoke vendor
compilers, measure performance, or infer acceleration from successful parsing.
The catalog contains NVIDIA Jetson Orin Nano, an Intel/OpenVINO CPU path, and
NXP i.MX93 / Arm Ethos-U65, with official source links. These are catalog entries,
not exact evaluated board/software configurations.

## Run locally

Use Node **24.21.0** and uv (CI pins **0.12.17**). Python is selected by
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
backend. Select targets, choose an ONNX file, and select **Inspect model**.
Do not expose either development server publicly.

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

Parsing occurs in a short-lived, resource-bounded subprocess. No graph execution,
model conversion, remote upload, or persistent model/result store is implemented.
Native parsing still runs with local process authority: this is **not a hostile
upload sandbox**. Use only trusted models locally. Production isolation,
authentication, tenancy, retention, and legal review remain required.

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
The [full product plan](PLAN.md) covers subsequent vendor adapters, provenance,
historical evidence, and measured hardware comparisons.
