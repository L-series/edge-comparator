# Development and delivery

This repository contains the local ONNX preflight and real OpenVINO CPU
compiler-evidence discovery slices described by Proposed ADR-0005/0006.
`PLAN.md` defines the larger product; no inference or production deployment exists.
The root Node package provides repository
governance; application packages enforce their own language-specific gates.

## Local checks

Use Node 24 (the pinned CI baseline) or a compatible version from `package.json`:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
```

`npm run format` applies formatting. `npm test` runs the fast tooling tests.
The full check enforces formatting, ESLint with zero warnings, Markdown linting,
YAML validity, role/ADR contracts, and tooling coverage thresholds.

Use the same locked environment without installing Node locally:

```sh
docker build -f ci/Dockerfile -t hw-comparator-quality .
docker run --rm --network none --cap-drop ALL --security-opt no-new-privileges hw-comparator-quality
```

Lint the Dockerfile with the image pinned in `.github/workflows/ci.yml`:

```sh
docker run --rm -i --network none hadolint/hadolint:v2.14.0-debian@sha256:158cd0184dcaa18bd8ec20b61f4c1cabdf8b32a592d062f57bdcb8e4c1d312e2 < ci/Dockerfile
```

The quality image contains only repository development tools, not vendor SDKs.
It is not the sandbox for untrusted model execution.

Backend checks use the committed Python version and `uv.lock`:

```sh
cd backend
uv sync --frozen --all-groups
uv run --frozen ruff check .
uv run --frozen ruff format --check .
uv run --frozen mypy src tests
uv run --frozen pytest
uv run --frozen pytest -m integration --no-cov --junitxml=reports/compiler-integration.xml
uv build --no-sources
```

See [backend setup and limitations](backend/README.md). Use generated test
models, never private or untrusted uploads, in CI.

Frontend checks and the real browser/API flow:

```sh
npm --prefix frontend ci --ignore-scripts --no-audit --no-fund
npm --prefix frontend run check
npm --prefix frontend exec -- playwright install chromium
npm --prefix frontend run test:e2e
```

Browser tests own their loopback API process, isolated temporary evidence root,
and Vite server; ports 8000 and 5173 must be free. They use generated ONNX models,
verify hashes, exercise real compiler acceptance/rejection, restart the API to
verify persistence, delete selected evidence, and check WCAG accessibility with
axe. They never use the developer's retained-evidence directory.
The local CI image includes matching browser binaries and OS libraries;
hosted PRs install the pinned browser and also verify both Docker recipes.

## Architecture decision records

Follow the [decision log](docs/decisions/README.md) and its template, based on
the [ADR reference project](https://github.com/architecture-decision-record/architecture-decision-record).
Significant choices need an ADR before implementation: service boundaries,
formats/evidence contracts, storage, scheduling, isolation/tenancy, public APIs,
deployment, and SDK integration/licensing modes.

Reference the accepted ADR in the PR. When no new decision is needed, explain why
or cite the existing ADR. Preserve accepted rationale; use dated amendments or a
superseding record rather than rewriting history. Structural CI checks cannot
decide whether a design is sound or whether a change deserved an ADR: independent
reviewers are responsible for that judgment.

## Test-driven implementation and language gates

For every behavior change, record the test that failed for the intended reason
before implementation and the same test passing afterward. Include integration
tests for trust boundaries and user-facing flows. Mocks cover transport/storage
failures, but the reviewed pinned OpenVINO adapter also has mandatory real SDK
tests (`integration`) in ordinary CI. Missing SDKs cannot produce skipped-success
results. These tests compile generated models; they do not execute inference or
relabel mock results as hardware evidence.

The SDK's shipped 2026.4 stubs disable their own exports. The small reviewed
`backend/stubs/openvino/` surface preserves strict application typing without
`Any` or import suppressions; runtime boundary values are validated and real SDK
tests exercise those signatures. Update the stubs and tests with SDK changes.

Every frontend component needs behavior/accessibility tests, including loading,
empty, error, and keyboard behavior where applicable. Every backend feature needs
unit and appropriate API/database/authorization tests. Bug fixes need a regression
test that reproduces the bug. Documentation-only changes need documentation checks,
not artificial application tests.

The bootstrap gate deliberately rejects application source languages that are not
yet wired into CI. Introducing a stack requires updating that gate **and** adding
working lint/format/type/build/test jobs in the same PR, under a recorded ADR.
Do not remove the guard without replacing it with real checks.

| Stack when adopted         | Required gates                                                                                                                                                                                                       |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Python backend/adapters    | Locked dependencies; Ruff lint and format check; strict mypy; pytest with branch coverage, JUnit, and coverage reports; API/integration tests; package/build check.                                                  |
| TypeScript/React frontend  | Locked install; ESLint with zero warnings; Prettier; strict `tsc --noEmit`; Vitest + Testing Library component tests and coverage; production build; Playwright for critical user journeys and accessibility checks. |
| Bootstrap JavaScript       | ESLint recommended rules with zero warnings, Prettier, Node's test runner, and a matching test module for each tooling module.                                                                                       |
| Dockerfiles                | Hadolint; pinned bases and dependencies; build verification when an image changes; scan/SBOM/provenance gates before publishing deployable SDK/application images.                                                   |
| Other languages/frameworks | ADR and native formatter/linter/type-or-build checker, tests, and coverage policy before accepting source. No stack silently escapes CI.                                                                             |

Current tooling thresholds are 95% lines, 90% branches, and 100% functions. For a
new application package, set explicit nondecreasing coverage floors and require
all new behavior to be exercised; coverage percentage alone is not proof of TDD.
Do not use "pass with no tests", blanket exclusions, or snapshots as the sole
assertion. A failing test must be fixed, not removed to make CI green.

## GitHub Actions CI/CD policy

Blocking checks run on PRs targeting `main` on GitHub-hosted `ubuntu-24.04`.
Trusted repository-owner pushes to `main` and owner-triggered manual runs on
`main` use the `edge-comparator-local` runner on the owner's machine. There is no
`pull_request_target`, release, or deployment workflow. The local runner is an
unprivileged, resource-limited Docker container without host mounts or the Docker
socket. See [runner operations](ci/README.md) and ADR-0004.

Update CI in the same PR whenever checks, dependencies, package layouts, SDK
images, or deployment behavior change. Pin tool versions and image digests;
pin actions to full commit SHAs and commit lockfiles. Dependency refreshes use
dedicated PRs and full regression
checks. Never autoformat and commit from CI, mask failures, or rely on a developer's
global packages. JUnit artifacts are retained for 14 days; no private models or
secrets may enter reports.

When the first deployable service exists, add build-once/promotion-by-digest,
SBOM/vulnerability/license gates, staging smoke tests, migration checks, protected
production approval, serialized deployments, health checks, and tested rollback
in the same delivery work. Use short-lived credentials and least-privilege runners.
Fork/untrusted PR pipelines must not receive production secrets or privileged
hardware. Hardware-in-the-loop jobs use dedicated, exclusively leased runners.
No placeholder deploy job or fake successful scan is acceptable.

### Required GitHub repository settings

The following are server-side controls, **not enabled by committing this file**.
An authorized maintainer must configure and verify them when the remote exists:

- Protect `main` against force pushes and deletion, and require the `quality`
  status check with up-to-date branches and resolved conversations. Apply these
  controls to administrators after bootstrap; subsequent contributions use PRs.
- Require independent approval and architecture-owner review for significant
  decisions. A sole owner cannot supply independent human review; keep that
  limitation explicit rather than inventing an approver.
- Restrict CI configuration, dependency/image, security, and ADR-policy changes
  to maintainers. CODEOWNERS identifies the actual repository owner.
- Set Actions token defaults to read-only, disable Actions PR approvals, require
  full SHA pins, and require approval from **all** external contributors.
- Only GitHub-owned actions and the explicitly reviewed `astral-sh/setup-uv`
  action are allowed. Never approve a fork workflow routing onto the local runner.
- Protect release tags, environments, secrets, and deployment runners. Keep
  secrets unavailable to untrusted pull requests.
- Verify actual workflow runs on both runner routes, not only local YAML syntax.

Public self-hosted runners remain risky: a contributor can modify workflow YAML.
Routing expressions and labels are not a security boundary. Review fork workflows
before approval; revoke the runner if trust cannot be maintained. A container does
not provide VM-strength isolation or prohibit access to the host's network.

Do not claim server settings are active without reading them back through GitHub.
Use small, logically contained commits with detailed rationale, scope, and
verification in commit bodies. Do not add Copilot co-author trailers.

## Agents and skills

`.github/agents/*.agent.md` defines reusable Copilot agents, not background workers
or CI services. The principal architect uses Astra; all nine specialist roles use
Gemini Flash. Two ML integration engineers can use the same role profile with
separate objectives and paths.

Read `AGENTS.md` and load the already-installed `ponytail` skill for coding/design
work. Skills guide behavior; CI and independent review enforce observable rules.
Do not install or copy a skill just to claim compliance. If unavailable in a
runner, report it and follow the repository's recorded minimal-design principles.

Model IDs are explicit project preferences. A client/account must support the
configured model; unavailable models must be reported rather than silently
substituted. Profiles are discovered by compatible Copilot clients in
`.github/agents/`; use the CLI's `/agent` selector after profile discovery.
See [custom-agent configuration](https://docs.github.com/en/copilot/reference/custom-agents-configuration).
