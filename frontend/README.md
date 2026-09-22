# Edge AI Hardware Comparator — Frontend Prototype

## Provisional Discovery Scope (ADR-0005 Proposed)

In accordance with [ADR-0005: Prototype local ONNX preflight](../docs/decisions/0005-prototype-local-onnx-preflight.md) (Status: Proposed), which explicitly authorizes a bounded, reversible local discovery implementation before production approval:

- **Provisional discovery scope:** This frontend package implements a lean, test-driven intake and comparison matrix slice for static model inspection and target catalog filtering.
- **No architectural self-approval:** Implementation within this scope is provisional discovery and does not self-approve or finalize architectural decisions. Full production acceptance remains subject to independent architecture review and accepted ADRs.
- **Reversibility:** The frontend validates the HTTP contract defined in ADR-0005. This is not yet a stable production API.

## Local Research-Preview Notice

> **NOTICE:** Local research preview only. No actual hardware acceleration is evaluated in this preflight stage. Private intellectual property / models are inspected locally or via configured boundary; not for public SaaS or unverified execution.

- Outcomes are strictly labeled **Static inferred / preflight** with status **Not tested**.
- No synthetic performance, fake TOPS, or green "success" indicators are presented.
- Filenames remain in the browser. Model bytes are sent to the loopback API only when the user selects Inspect model; no backend filesystem path is generated.
- No local storage (`localStorage`) or remote telemetry is utilized.

## Backend HTTP Contract

The frontend communicates with the backend via same-origin `/api` endpoints:

| Endpoint       | Method | Request                                                                               | Response / Behavior                                                                                                                                                                                                        |
| -------------- | ------ | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/health`  | `GET`  | Empty                                                                                 | `{ "status": "ok" }`                                                                                                                                                                                                       |
| `/api/targets` | `GET`  | Empty                                                                                 | Array of `Target` objects: `[{ id, name, vendor, accelerator, source_url, configuration_status: 'catalog_only' }]`. Expected targets: `nvidia-jetson-orin-nano`, `intel-openvino-cpu`, `nxp-imx93-ethos-u65`.              |
| `/api/inspect` | `POST` | Raw model bytes (`application/octet-stream`, <= 16MiB; **NOT** `multipart/form-data`) | `{ "evidence_type": "static_inferred", "stage": "preflight", "model": { sha256, format: "onnx", ir_version, opsets, inputs, outputs, operations, node_count }, "results": [{ target_id, status: "not_tested", reason }] }` |

Error responses return JSON with `{ "detail": string }` on HTTP status codes such as 413 (Payload Too Large), 415 (Unsupported Media Type), 422 (Unprocessable Entity), or 503 (Service Unavailable).

## Network & Development Configuration

- **Dev server:** Bound to `127.0.0.1:5173` with `strictPort: true`.
- **API proxy:** In development, Vite proxies `/api` to `http://127.0.0.1:8000`.
- **Build artifacts:** Same-origin requests without hardcoded backend hostnames; shared-service deployment is not supported.

## Quick Start & Verification

From the repository root:

```bash
# Install dependencies
npm --prefix frontend ci --ignore-scripts --no-audit --no-fund

# Start local development server (http://127.0.0.1:5173)
npm --prefix frontend run dev

# Run comprehensive checks (lint, typecheck, test coverage, build)
npm --prefix frontend run check
```

Or within the `frontend/` directory:

```bash
cd frontend
npm ci --ignore-scripts --no-audit --no-fund
npm run dev
npm run check
```

## Available Scripts

- `npm run dev`: Start Vite development server bound to `127.0.0.1:5173`.
- `npm run build`: Compile TypeScript and build production bundle with Vite into `dist/`.
- `npm run preview`: Preview the production build locally.
- `npm run lint`: Run type-aware strict ESLint and React Hooks checks (`--max-warnings 0`).
- `npm run typecheck`: Run `tsc --noEmit` under strict TypeScript rules.
- `npm run test`: Run Vitest unit and component tests in JSDOM environment.
- `npm run test:coverage`: Run Vitest with coverage report (thresholds: lines >= 90%, functions >= 90%, branches >= 85%).
- `npm run check`: Run lint, typecheck, test:coverage, and build in sequence.
- `npm run test:e2e`: Run real browser/API journeys and axe accessibility checks. Install Chromium with `npm exec -- playwright install chromium` first; Linux CI already includes matching binaries.

Browser tests generate a tiny ONNX fixture using the locked backend environment.
They start their own API and Vite servers, so ports 8000 and 5173 must be free.
They verify exact artifact identity, the Not tested matrix, target filtering,
rejected uploads, stale-evidence removal, recovery, and WCAG accessibility.
JUnit reports are written to `reports/`; failure traces use only generated fixtures.

## Current Limitations

- **Hardware Execution:** No actual hardware compilation, device flashing, or profiling occurs. All results report preflight static status.
- **Missing evidence:** A missing target result is displayed as Inconclusive, not silently invented as Not tested.
