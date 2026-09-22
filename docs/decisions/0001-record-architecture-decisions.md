# ADR-0001: Record architecture decisions

Status: Accepted

Date: 2026-09-22

## Context

hw-comparator begins with a research-backed plan, not an implemented application.
Its correctness depends on preserving exact model/toolchain/target evidence and
honestly separating compilation, runtime validation, and measurement. SDK
licensing, GPU requirements, and untrusted model processing can invalidate an
otherwise attractive platform choice.

The user explicitly requires ADRs following the architecture-decision-record
project. A plan lists candidates and intentions; it is not a substitute for a
reviewable decision and its evidence.

## Decision

Maintain numbered Markdown ADRs in `docs/decisions/`, using the local
[template](template.md) and [workflow](README.md). Record significant contracts,
technology choices, trust boundaries, SDK deployment modes, and exceptions
before implementation. Do not require ADRs for routine local edits.

Every ADR contains Context, Decision, Alternatives considered, Consequences,
Validation, and References. Use four-digit sequential filenames, a matching
`ADR-NNNN` title, and explicit status/date metadata. Begin future decisions as
Proposed; acceptance requires independent human owner review with a recorded
reference. These initial three Accepted records implement the user's explicit
governance, Docker, and quality policies, not hypothetical future platform
choices.

Preserve Accepted reasoning. Use dated amendments for clarifications and a new,
cross-linked ADR for a changed decision; keep superseded and rejected records.
Agent roles may draft and check evidence, but cannot substitute for independent
human approval or security/legal authority.

## Alternatives considered

- **PLAN.md alone:** simplest initially, but mixes unresolved candidates with
  recommendations and loses the rationale for individual changes.
- **External wiki or issue discussions only:** useful collaboration tools, but
  separate decisions from the version of the implementation they govern.
- **A dedicated ADR service or generator:** unnecessary for a small Markdown
  log; repository files and lightweight checks cover the current need.
- **An ADR for every change:** produces noise without improving review of the
  consequential choices.

## Consequences

Architecture choices become versioned and discoverable with their trade-offs.
The cost is a short record and independent review for significant decisions.
The architect owns consistency of the log; affected domain owners supply
evidence and approvals. Contributors must not present plan candidates as
Accepted decisions or silently reinterpret historical results.

Structural validation is necessary but cannot judge architectural soundness.
GitLab branch protections and approval rules need configuration by a project
owner after a remote project exists; documentation does not enforce them.

## Validation

The bootstrap governance checks must reject malformed numbered records, missing
metadata, or missing/empty required sections; their tests include negative
cases. The author must run the repository formatting, lint, and test checks
before merge. This record does not claim those checks have already passed.

The independent reviewer verifies substantive reasoning, source quality,
scope, and the preservation of superseded decisions. The GitLab project owner
must verify required pipelines and approval settings before relying on them as
merge controls. Future implementation MRs must identify the governing ADR or
explain why their changes are routine.

## References

- [Architecture decision record guidance](https://github.com/architecture-decision-record/architecture-decision-record),
  consulted 2026-09-22.
- [Project plan](../../PLAN.md), sections 1.3–1.4, 2, 3, 4.3, and 9.
- [Local ADR workflow](README.md) and [template](template.md).
