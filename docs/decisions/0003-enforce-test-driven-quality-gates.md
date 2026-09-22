# ADR-0003: Enforce test-driven quality gates

Status: Superseded

Date: 2026-09-22

Supersession (2026-09-22): [ADR-0004](0004-use-github-actions-with-an-isolated-local-runner.md)
replaces the GitLab CI-host choice with GitHub Actions at the user's explicit
request. It retains this record's TDD, formatting, linting, typing, meaningful
tests, and same-change language-gate principles. The original decision and
rationale below are preserved as history; references to GitLab and MRs are not
instructions to maintain a second CI platform. GitHub's hosted-PR/local-main
routing and pre-merge enforcement requirements are defined in ADR-0004.

## Context

The user requires strict GitLab CI, formatting, linting, and test-driven
development for every feature. At bootstrap there is no backend, frontend, or
vendor adapter to test. Creating empty application jobs would provide a false
quality signal, while postponing all checks would leave the first real feature
unguarded.

This product especially needs regression tests that prevent uncertain compiler
output, environment failure, or missing runtime evidence from becoming a false
compatibility claim.

## Decision

Establish required, failing-on-error GitLab checks for the files and behavior
that exist now:

- Check formatting and lint rules for Markdown documentation, YAML, JSON,
  and bootstrap Node `.mjs` scripts using locked development tools.
- Run Node's built-in test runner for bootstrap behavior, including governance
  validators. Test rejection paths as well as valid repository examples.
- Reject application source languages/extensions that have not been wired into
  real validation. A new feature, language, framework, or adapter must add or
  extend its actual formatting, lint, type, and test gates in the **same MR**.
  Do not merely add the extension to an allowlist.
- Keep commands consistent between local development, the quality container,
  and CI. CI checks rather than silently fixing files.
- Reject broad suppressions, successful empty test runs, placeholder
  application jobs, swallowed failures, and `allow_failure` on critical checks.
  Any narrowly necessary exclusion needs a documented reason and review; a
  policy exception needs an ADR rather than disabling the gate.

For every feature and behavior-changing fix, use **red → green → refactor**:

1. Write the smallest relevant test and run it against the missing or broken
   behavior. Confirm that it fails for the intended reason, not a missing tool
   or invalid fixture.
2. Implement the behavior and show the same test passing; run the affected
   regression checks.
3. Refactor without changing behavior, then rerun the required checks.

The MR records test identifiers, commands, expected/observed failure, passing
results, and the refactor outcome, with reproducible revisions or log evidence.
A final green pipeline does not prove the order of development; the reviewer
checks the evidence. For a documentation-only change, record why behavior tests
are not applicable and still run the applicable format/lint/governance checks.
For a behavior-preserving refactor, demonstrate existing regression coverage
and unchanged behavior rather than inventing an artificial failing feature.

The following are conditional requirements, not adopted application stacks:

| If adopted                    | Required real gates in the introducing MR                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Python                        | Ruff formatting and lint, strict mypy, pytest with branch coverage and an explicit reviewed threshold that cannot silently drop             |
| TypeScript/React              | Strict `tsc`, ESLint, Prettier, Vitest/React Testing Library, and Playwright for introduced user flows                                      |
| Rust, Go, or another language | An adoption ADR and its native format, lint/static checks, meaningful tests, and coverage policy where supported                            |
| Vendor adapters               | Versioned diagnostic fixtures, positive/negative/partial/inconclusive cases, and controlled integration tests for the supported environment |

Fixtures do not substitute for compiler or hardware evidence. Hardware-specific
checks require available, authorized runners; missing hardware is not a pass.
Separate deterministic checks from restricted integration runs, and make
required integration evidence a release/deployment gate for the relevant
capability. Never claim runtime acceleration from a compile-only job.

## Alternatives considered

- **Write tests after implementation:** does not meet the requested TDD policy
  and weakens evidence that tests detect the original missing behavior.
- **Wait for the application before adding CI:** leaves governance scripts and
  the first feature without checks; simple bootstrap tests are useful now.
- **Configure every candidate stack now:** adds unused dependencies and dummy
  jobs while implying framework choices that have not been accepted.
- **Advisory checks or no-test success flags:** make a green pipeline ambiguous
  and allow critical regressions to merge.

## Consequences

The first feature in a new stack includes the cost of its working CI
integration. Changes need test evidence as well as code, and tests must cover
unknown/error paths rather than only happy cases. Coverage is a signal, not
proof of correctness; thresholds cannot replace assertions about evidence
classification, isolation, or numerical behavior.

GitLab project owners must separately configure protected branches, required
successful pipelines, independent human approval for ADRs, protected
environments/deployment approvals, and appropriately scoped secrets/runners.
Those settings are unavailable locally and are not enforced merely by
committing YAML, documentation, or agent profiles. Do not expose protected
secrets or privileged runners to untrusted MR code.

## Validation

The bootstrap author must run the real repository format, lint, and Node test
commands; negative tests must demonstrate governance rejection, including
unwired source types. The CI owner must validate GitLab pipeline syntax and
then verify both successful and deliberate failing cases in an actual GitLab
project before treating merge protection as active. This ADR records required
checks, not results from an inaccessible remote pipeline.

Every feature reviewer verifies MR red/green/refactor evidence and same-MR CI
coverage. Domain owners verify that adapter fixtures and runtime evidence match
the stated SDK, target, and scope. The project owner confirms server-side merge
and deployment controls before shared integration or deployment.

## References

- [Project plan](../../PLAN.md), sections 1.4, 5.5, 8.2–8.4, 9, and 10.3.
- [GitLab pipelines must succeed](https://docs.gitlab.com/user/project/merge_requests/auto_merge/#require-a-successful-pipeline-for-merge).
- [GitLab protected branches](https://docs.gitlab.com/user/project/repository/branches/protected/).
- [ADR-0001](0001-record-architecture-decisions.md) and
  [ADR-0002](0002-use-docker-for-toolchains.md).
