# Architecture decision log

Use architecture decision records (ADRs) to preserve consequential choices, their
evidence, alternatives, and trade-offs alongside the implementation. This workflow
follows the [architecture-decision-record project][adr-guide], with the local
conventions below.

## Decisions

| ADR                                                                                  | Status   | Scope                                                          |
| ------------------------------------------------------------------------------------ | -------- | -------------------------------------------------------------- |
| [0001: Record architecture decisions](0001-record-architecture-decisions.md)         | Accepted | Decision workflow and review                                   |
| [0002: Use Docker for toolchains](0002-use-docker-for-toolchains.md)                 | Accepted | Portable development tooling and future approved SDK packaging |
| [0003: Enforce test-driven quality gates](0003-enforce-test-driven-quality-gates.md) | Accepted | GitLab CI, TDD, and incremental language gates                 |

These initial Accepted decisions implement explicit user policy. Acceptance is
not evidence of a successful pipeline, an approved vendor license, a deployed
service, or configured GitLab protections. No application framework, database,
queue, or scheduler is selected by these records; candidates in
[PLAN.md](../../PLAN.md) require evidence and their own decisions.

## When a decision needs a record

Create an ADR before implementing a consequential or costly-to-reverse choice,
including:

- The exact compatibility evidence tuple: model artifact and format, inputs,
  transformations, precision, toolchain/runtime, target, fallback policy, and
  the separation of outcome, evidence stage, and scope.
- Application languages/frameworks, public API and adapter contracts, component
  boundaries, schema/versioning, or result-classification semantics.
- Tenancy, isolation, trust boundaries, authorization, retention/deletion, and
  any change to handling of private models or third-party processing.
- Storage, scheduler/queue, deployment topology, and reproducibility policy.
- An SDK/version, exact hardware target, permitted deployment mode, acquisition
  and redistribution rights, or native-runner exception.
- A significant dependency, an exception to an Accepted policy, or a materially
  changed assumption that invalidates an earlier decision.

Routine local refactors, bug fixes within an existing contract, wording fixes,
and equivalent patch updates need no new ADR. They still need appropriate review
and checks. Link the governing ADR when relevant; do not create a record for
every implementation detail.

DA3 means **Depth Anything 3**, as confirmed by the user. That identity does not
select a checkpoint or grant rights: weight licensing, export configuration,
input mode, numerical validation, and deployment scope remain explicit gates.

## Workflow

1. Copy [template.md](template.md). Allocate the next unused sequential
   four-digit number, starting after the last record; never reuse a number.
   Resolve concurrent allocation conflicts before merge.
2. Name it `NNNN-present-tense-decision.md`, use the title
   `# ADR-NNNN: Decision title`, and provide separate `Status: Proposed` and
   `Date: YYYY-MM-DD` metadata lines. The date is the initial decision date.
3. Keep all six template sections substantive. Cite authoritative sources and
   reproducible experiments; distinguish observed facts, assumptions, decisions,
   and unresolved approval or hardware gates.
4. Submit the Proposed ADR with or before its implementation merge request (MR).
   Link it from the MR and this index. A responsible human owner independent of
   the author reviews the rationale, alternatives, risks, and validation.
   Involve security, legal, and affected owners when their approval is required.
5. Record the review reference and acceptance date before changing the status
   to Accepted. Rejected proposals remain in the log with their rationale.
   The three bootstrap records document the explicit user-directed policies,
   rather than claiming a separate review has already occurred.
6. Preserve Accepted reasoning. Correct minor errors transparently; append dated
   amendments for clarifications, including evidence and review references.
   A changed decision needs a new ADR linking the old one, with a dated
   supersession note and reciprocal links. Mark the old status Superseded;
   never silently rewrite history. Update this index.

Use Proposed, Accepted, Rejected, Deprecated, or Superseded as lifecycle statuses. Validation
may be a pending gate when an ADR is accepted, but must identify what remains,
who is responsible, and what blocks deployment.

## Enforcement boundaries

Repository checks can validate ADR shape and related implementation tests.
They cannot prove the quality of reasoning, legal permission, TDD chronology,
or independent approval. Human owners must configure protected branches,
required successful pipelines, appropriate approval rules, protected
environments, and secrets in GitLab. Committed documentation and agent profiles
do not activate those settings or replace human security/legal approval.

[adr-guide]: https://github.com/architecture-decision-record/architecture-decision-record
