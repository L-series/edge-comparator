# Change

Describe the behavior, scope, and acceptance criteria.

## Architecture and evidence

- ADR link(s), or why no new architectural decision is needed:
- Evidence/configuration/model identity affected:
- Security, privacy, licensing, migration, and rollback impact:

## TDD evidence

- Failing test and command observed before implementation (intended failure):
- Passing command and outcome after implementation:
- Frontend component / backend feature / adapter edge cases covered:
- For docs-only changes, explain why behavior tests do not apply:

## Delivery checklist

- [ ] Read applicable ADRs and followed `AGENTS.md`; used ponytail or reported its absence.
- [ ] New behavior has tests; no skipped/empty suites, blanket exclusions, or reduced gates.
- [ ] Formatting, lint, type/build checks, and tests pass locally and in GitLab.
- [ ] Updated GitLab CI in this MR for changed tooling, languages, features, or delivery requirements, or explained why unchanged gates cover it.
- [ ] Updated documentation and reproducibility manifests/lockfiles.
- [ ] No private model artifacts, SDKs without redistribution rights, credentials, or secrets committed.
- [ ] Independent reviewer checked architecture significance and ADR acceptance.
