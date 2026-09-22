# ADR-0004: Use GitHub Actions with an isolated local runner

Status: Accepted

Date: 2026-09-22

Amendment (2026-09-22): the initial main-only workflow avoided untrusted local
execution but left no real pre-merge CI. As an implementation refinement, add
GitHub-hosted PR execution while retaining owner-only `main` execution on the
local runner. The routing and branch-check requirements below replace that
initial pre-merge limitation; they do not relax the local runner's trust rules.

## Context

The user explicitly changed the repository host to
[L-series/edge-comparator](https://github.com/L-series/edge-comparator), requested
GitHub rather than GitLab, and authorized this local machine as the CI runner.
The destination is public. GitHub warns that self-hosted runners should almost
never be used for public repositories because untrusted workflow code can
persistently compromise the runner.

This decision records the requested owner-controlled development arrangement,
not a claim that a public self-hosted runner is safe for arbitrary contributors.
It supersedes the GitLab host portions of
[ADR-0003](0003-enforce-test-driven-quality-gates.md) while retaining its quality
principles and the Docker rationale in
[ADR-0002](0002-use-docker-for-toolchains.md). The explicit user instruction
accepts the CI choice; it does not establish independent security approval or
prove that any settings or runner controls have been applied.

## Decision

Use GitHub Actions for this repository's quality pipeline. Do not maintain a
parallel GitLab pipeline. The platform owner is responsible for runner
configuration and verifying remote settings; independent human architecture
review remains required for major production decisions. Use one quality job
with the stable check name `quality`, running the same checks on both runner
types, so branch protection has one required status rather than competing
hosted/local job names.

Run the repository-scoped Actions runner inside a Docker container on the local
machine, not directly in the developer's account:

- Run as a non-root user with all Linux capabilities dropped,
  `no-new-privileges`, and explicit CPU, memory, PID, and job-time bounds.
  Retain the runtime's restrictive syscall policy; do not use privileged mode.
- Mount no host filesystem paths, developer credentials, SSH agent, GitHub CLI
  configuration, or Docker socket into the runner. Keep checkout, caches, and
  runner configuration inside the container. Build or administer the runner
  from the host; jobs cannot build sibling containers through a host daemon.
- Bootstrap registration with only a short-lived, repository-scoped runner
  registration token. Do not inject a personal access token or host `gh`
  credentials. Protect runner configuration with restrictive file permissions
  inside the container; do not expose registration material in images or logs.
  The runner creates persistent authentication material: job code running as
  the same user may reach it, so these permissions are not isolation from jobs.
- Use the container's ordinary isolated networking, not host networking or
  published service ports. Required GitHub/dependency access does not imply
  network isolation from other reachable services. Do not give jobs access to
  sensitive internal services; assess reachability before starting the runner.
- Pin base images by digest and remote workflow actions by full commit SHA,
  review updates, and retain lockfiles. Set `GITHUB_TOKEN` to read-only repository
  contents, with no extra permissions; disable checkout credential persistence.
  No deployment jobs, production credentials, or production secrets are allowed.

Route the single job with an event-dependent `runs-on` expression:

| Event                                    | Runner                                | Eligibility                                                                |
| ---------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------- |
| `pull_request` targeting `main`          | GitHub-hosted `ubuntu-24.04`          | PR to `L-series/edge-comparator`, subject to external-contributor approval |
| `push` to `refs/heads/main`              | `edge-comparator-local` Docker runner | Repository is `L-series/edge-comparator` and `github.actor` is `L-series`  |
| `workflow_dispatch` on `refs/heads/main` | `edge-comparator-local` Docker runner | Repository is `L-series/edge-comparator` and `github.actor` is `L-series`  |

PRs must select the hosted runner regardless of author, including owner PRs.
The job guard must explicitly require the correct repository and either the
eligible PR event or the owner/ref-qualified local event; the non-PR branch
of the routing expression is not authorization by itself. No other event may
reach the local runner. Never enable `pull_request_target`.

For hosted PRs, test the PR merge candidate so checks exercise the proposed
integration with `main`. For local jobs, check out only the eligible main event
commit, never a PR head or caller-supplied ref. Manual dispatch must not accept
arbitrary checkout refs or script inputs. Keep local rerun permissions
owner-controlled. Do not transfer executable state or caches from untrusted
hosted jobs into the persistent local runner.

Configure GitHub's public-fork approval policy to require approval for **all
external contributors**, not only first-time contributors. Before approving
each fork workflow run, inspect changes to workflows and their invoked scripts
and actions, including routing and job guards. Approve only hosted execution;
do not approve or run untrusted fork code on this machine, even after changing
a label or trusting an account. Review code, dependency, and workflow changes
before the owner incorporates them into `main`.

Runner labels, repository/ref/actor conditions, and workflow event filters are
defense in depth, **not a hard security boundary**: workflow authors can change
them, dependencies execute code, accounts can be compromised, and fork workflow
approval is an external setting. A contributor can edit the workflow to remove
the guard or request the local label, so inspecting workflow changes before
approval is essential. If this trust restriction cannot be maintained, remove
or deregister the local runner from the public repository, or remove its public
exposure through a reviewed private/dedicated design. Do not merely add another
label check. Reassess before adding collaborators; hosted-only CI or genuinely
clean ephemeral runners remain safer alternatives.

After bootstrap pushes, configure and verify `main` protection with the single
required `quality` check and strict up-to-date branch checking. Disallow force
pushes and branch deletion, and apply required protections to administrators.
Do not describe these controls as active until the GitHub settings are
verified. A required independent PR reviewer remains pending a second trusted
maintainer; this is a known review-enforcement gap, not permission to claim
self-review is independent approval. Human production-architecture approval
remains required separately.

Retain ADR-0003's red/green/refactor evidence for every feature or behavior fix,
strict format/lint/type/test checks, bootstrap governance tests, and same-PR
language/framework gate additions. Reject empty-test success, broad
suppressions, swallowed failures, placeholder jobs, and
`continue-on-error` for required checks. Documentation-only and
behavior-preserving refactor evidence follow the existing quality policy.

## Alternatives considered

- **GitHub-hosted runners for every event:** preferable lifecycle isolation,
  and selected here for public PRs. Keeping trusted owner/main runs local
  preserves the user's request to use this machine. Switch entirely to hosted
  CI if the local trust restriction cannot be maintained.
- **Main-only local CI:** the initial choice kept PR jobs away from this
  machine, but lacked candidate-branch validation. Hosted PR execution restores
  a real pre-merge quality check without intentionally scheduling PRs locally.
- **A native runner in the developer account:** simpler startup but exposes
  workstation files and credentials to every executed dependency and job.
- **A privileged container or Docker-socket mount:** convenient nested builds,
  but grants an unacceptable path to host control.
- **Keep GitLab:** conflicts with the explicit host change and introduces
  duplicate configuration.
- **A new VM fleet or ephemeral-runner orchestrator now:** stronger separation
  is valuable, but building an orchestration service is outside this bounded
  development preview. If the current risk is unacceptable, stop the runner
  rather than pretending container hardening is equivalent.

## Consequences

The requested local machine can execute real checks without mounting its
developer workspace or credentials into jobs. A long-lived container still
retains workspace, caches, processes, and runner authentication between jobs.
Cleanup is not proof of a clean runner; suspected compromise requires stopping
and deregistering it, rotating affected credentials, and rebuilding from
reviewed inputs. Container escape and network reachability remain risks.

Hosted PR execution provides actual pre-merge quality evidence for the merge
candidate, while the local runner checks trusted `main` commits. The stable
`quality` check becomes an enforced merge gate only after branch protection is
configured; a successful workflow alone is not proof of that configuration.
Neither route proves TDD chronology or substitutes for review. Required
independent PR review is not yet enforced while the second maintainer is
pending, and bootstrap pushes precede activation of the branch protections.

Branch/ruleset protections, external-contributor approvals, runner registration,
and Actions permissions are GitHub settings, not effects of committed Markdown.
Any unapplied or unverifiable setting must be reported. Agents do not replace
human security review, production approval, or legal decisions.

## Validation

Before enabling the runner, the platform owner must inspect the running
container's UID, mounts, capability set, no-new-privileges setting, limits,
network mode, and absence of host credentials/socket. Verify repository-scoped
registration and remote Actions/fork-approval permissions without logging tokens.
Keep evidence tied to the configured runner and image digest.

Governance tests must prove PR events route to `ubuntu-24.04`, never the local
runner, including owner-authored PRs. Reject `pull_request_target`, unsupported
events, missing local repository/ref/owner guards, non-SHA action references,
elevated token permissions, and softened quality gates. Exercise rejection
with fixtures, never by scheduling malicious jobs on the real runner.

Confirm that a real hosted PR run and a trusted local `main` run report the
same `quality` check and execute formatting, linting, typing, tests, builds,
and applicable browser flows. Confirm a deliberately failing check cannot
report success. After bootstrap, inspect GitHub settings for strict required
`quality` status, administrator enforcement, disabled force pushes/deletion,
and all-external-contributor workflow approval. Record the required-reviewer
gap until a second trusted maintainer is available.

Verified operational evidence supplied by the implementation coordinator on
2026-09-22:

- Repository runner ID `2`, named `edge-comparator-local`, is registered and
  online in Docker container `edge-comparator-ci`.
- Container inspection confirms user `runner`, zero mounts, all capabilities
  dropped, `no-new-privileges`, 4 GiB memory, 2 CPUs, PID limit 512, and restart
  policy `unless-stopped`. This is a persistent runner, not an ephemeral one.
- GitHub Actions settings read back as selected allowed actions: GitHub-owned
  actions plus `astral-sh/setup-uv`; `sha_pinning_required: true`;
  `all_external_contributors` approval; read-only token permissions; and
  Actions approval of pull requests disabled.
- Migration tests were observed failing before the change and now report
  11 passing tests, 100% line coverage, and 99% branch coverage. Bootstrap
  commit [`02a043e`](https://github.com/L-series/edge-comparator/commit/02a043e)
  was pushed.

This evidence verifies the listed controls and migration checks, not every
validation requirement above. Real hosted-PR/local-main quality runs, strict
branch protection, and application integration evidence must be recorded when
completed; independent required review still awaits a second trusted
maintainer. Unverified network, credential-handling, or job-time controls must
not be inferred from zero mounts. Failed isolation checks require stopping the
runner. Production deployment and untrusted local execution remain outside
approval.

Operational follow-up on 2026-09-22: GitHub protection settings were read back
with strict, required `quality` checks bound to the GitHub Actions app, administrator
enforcement, required PRs and resolved conversations, linear history, and disabled
force pushes/deletion. Required independent approvals remain zero pending a second
trusted maintainer; no independent human approval is claimed.

The [backend main run](https://github.com/L-series/edge-comparator/actions/runs/35765329632)
passed on the local runner. The
[frontend PR run](https://github.com/L-series/edge-comparator/actions/runs/35766463676)
passed hosted application, browser/accessibility, and Docker environment checks.
The idle bootstrap runner was replaced with repository runner ID `3`, retaining
the same restrictions and adding the pinned Playwright browser environment.
Docker is currently socket-activated: enabling automatic daemon startup requires
the owner's sudo approval, as documented in [runner operations](../../ci/README.md).

## References

- User direction of 2026-09-22: GitHub repository, local CI runner, and start
  building. The implementation uses hosted PR checks and one required quality
  status while retaining trusted-main local execution.
- [GitHub Actions secure use: self-hosted runners](https://docs.github.com/en/actions/reference/security/secure-use#hardening-for-self-hosted-runners).
- [GitHub repository Actions settings](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository).
- [Approving workflow runs from forks](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/approve-runs-from-forks).
- GitHub sources consulted 2026-09-22.
- [ADR-0001](0001-record-architecture-decisions.md),
  [ADR-0002](0002-use-docker-for-toolchains.md), and
  [superseded ADR-0003](0003-enforce-test-driven-quality-gates.md).
