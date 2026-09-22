# Development and delivery

This repository is at the development-foundation stage. `PLAN.md` defines the
product; no backend, frontend, vendor SDK image, or deployment currently exists.
The root Node package is development tooling, not an application stack decision.

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

Lint the Dockerfile with the image pinned in `.gitlab-ci.yml`:

```sh
docker run --rm -i --network none hadolint/hadolint:v2.14.0-debian@sha256:158cd0184dcaa18bd8ec20b61f4c1cabdf8b32a592d062f57bdcb8e4c1d312e2 < ci/Dockerfile
```

The quality image contains only repository development tools, not vendor SDKs.
It is not the sandbox for untrusted model execution.

## Architecture decision records

Follow the [decision log](docs/decisions/README.md) and its template, based on
the [ADR reference project](https://github.com/architecture-decision-record/architecture-decision-record).
Significant choices need an ADR before implementation: service boundaries,
formats/evidence contracts, storage, scheduling, isolation/tenancy, public APIs,
deployment, and SDK integration/licensing modes.

Reference the accepted ADR in the MR. When no new decision is needed, explain why
or cite the existing ADR. Preserve accepted rationale; use dated amendments or a
superseding record rather than rewriting history. Structural CI checks cannot
decide whether a design is sound or whether a change deserved an ADR: independent
reviewers are responsible for that judgment.

## Test-driven implementation and language gates

For every behavior change, record the test that failed for the intended reason
before implementation and the same test passing afterward. Include integration
tests for trust boundaries and user-facing flows; mock vendor execution in ordinary
CI, but never relabel mock results as hardware evidence.

Every frontend component needs behavior/accessibility tests, including loading,
empty, error, and keyboard behavior where applicable. Every backend feature needs
unit and appropriate API/database/authorization tests. Bug fixes need a regression
test that reproduces the bug. Documentation-only changes need documentation checks,
not artificial application tests.

The bootstrap gate deliberately rejects application source languages that are not
yet wired into CI. Introducing a stack requires updating that gate **and** adding
working lint/format/type/build/test jobs in the same MR, under an accepted ADR.
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

## GitLab CI/CD policy

Run blocking checks on merge requests, branch pushes without an open MR, the
default branch, tags, and scheduled/manual branch pipelines. Avoid duplicate
push and MR pipelines. The initial pipeline runs repository quality and Dockerfile
lint; it does not pretend to test or deploy an application that does not exist.

Update CI in the same MR whenever checks, dependencies, package layouts, SDK
images, or deployment behavior change. Pin tool versions and image digests;
commit lockfiles. Dependency refreshes use dedicated MRs and full regression
checks. Never autoformat and commit from CI, mask failures, or rely on a developer's
global packages. JUnit artifacts are retained for 14 days; no private models or
secrets may enter reports.

When the first deployable service exists, add build-once/promotion-by-digest,
SBOM/vulnerability/license gates, staging smoke tests, migration checks, protected
production approval, serialized deployments, health checks, and tested rollback
in the same delivery work. Use short-lived credentials and least-privilege runners.
Fork/untrusted MR pipelines must not receive production secrets or privileged
hardware. Hardware-in-the-loop jobs use dedicated, exclusively leased runners.
No placeholder deploy job or fake successful scan is acceptable.

### Required GitLab project settings

The following are server-side controls, **not enabled by committing this file**.
An authorized maintainer must configure and verify them when the remote exists:

- Protect the default/release branches; disable direct pushes and force pushes.
- Require a successful pipeline and resolved discussions before merging; do not
  allow skipped pipelines to satisfy the merge check.
- Require an independent approval, and architecture-owner review for significant
  decisions; prevent author/self approval where the GitLab tier supports it.
- Restrict CI configuration, dependency/image, security, and ADR-policy changes
  to the relevant maintainers. Add CODEOWNERS once real GitLab owners are known.
- Use merged-result pipelines/merge trains when available and appropriate.
- Protect release tags, environments, secrets, and deployment runners. Keep
  secrets unavailable to untrusted merge requests.
- Verify the pipeline using the target GitLab instance's CI Lint and an actual MR.

Do not invent GitLab usernames or claim project settings are active without access.
If the GitLab tier lacks a required approval feature, document and enforce a
maintainer-controlled merge procedure rather than pretending the template enforces it.

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
