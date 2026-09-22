# Repository instructions

These rules apply to every contributor and delegated agent in this repository.
Read `PLAN.md`, `CONTRIBUTING.md`, and the applicable records in
`docs/decisions/` before changing behavior. Accepted ADRs govern implementation;
the plan's technology recommendations are not automatically accepted decisions.

## Non-negotiable workflow

1. Load the installed `ponytail` skill before coding, designing, refactoring, or
   reviewing code. If the runner cannot load it, report that limitation and follow
   its core rules here: inspect first, reuse existing/native solutions, implement
   the smallest complete change, and avoid speculative infrastructure.
2. Do not simplify away security, validation, accessibility, type safety, tests,
   or explicit requirements. Ponytail never overrides these requirements.
3. Record a major architecture choice in an ADR before implementing it. Consider
   alternatives, consequences, and measurable validation. Request independent
   review; an agent cannot approve its own architectural decision.
4. Use TDD for every backend feature, frontend component, adapter, and nontrivial
   tooling change: write a meaningful failing test, observe the intended failure,
   implement, then refactor with tests green. Record red/green evidence in the MR.
   Cover errors and boundary cases, not only happy paths or snapshots.
5. Add or update the GitLab CI jobs in the same MR as the language, dependency,
   feature, migration, packaging, or deployment change that needs them. Run the
   applicable checks locally. Never bypass gates with `allow_failure`, empty test
   suites, blanket lint exclusions, broad type casts, or reduced coverage.
6. Use Docker/OCI environments per ADR-0002. Pin image digests and lock dependencies.
   Do not fetch an unpinned SDK at job runtime, accept EULAs on a user's behalf,
   redistribute restricted SDKs, bake secrets into images, or mount the Docker
   socket into untrusted workers.
7. Preserve the user's changes. Do not commit, push, deploy, or alter GitLab
   project settings unless requested. Report verification and remote-setting
   limitations honestly.

## Product invariants

- DA3 means **Depth Anything 3**. Its checkpoint, input mode, exporter, and weight
  license still require explicit selection and validation.
- Compatibility belongs to an exact artifact, configuration, and versioned
  toolchain. Preserve raw evidence and transformation lineage.
- Never equate compilation or execution with full acceleration. Keep measured,
  compiler-reported, compiler-estimated, documented, inferred, and community
  evidence distinct. Unknown or contradictory evidence stays inconclusive.
- Models, calibration data, logs, and SDK artifacts are private by default. Do
  not send them to external services without authorization.

## Role agents

Persistent Copilot profiles live in `.github/agents/`; GitLab remains the CI host.
Use `principal-architect` (`gpt-6-astra`) for consequential design decisions and
the specialist profiles (`gemini-3.8-flash`) for bounded implementation work.
The ML/compiler profile can be used for two separate tasks, matching PLAN 10.2.
Do not launch all roles for every task or allow overlapping file ownership.

Delegate with the objective, relevant accepted ADRs, owned paths, acceptance
tests, and a stop condition. Specialists must escalate material architecture,
security, licensing, or evidence uncertainty instead of silently changing policy.
Read the assigned role profile when a runner requires delegation through a generic
agent. Pass its specified model explicitly; if unavailable, report the blocker
rather than silently upgrading or downgrading. Human review remains required.
