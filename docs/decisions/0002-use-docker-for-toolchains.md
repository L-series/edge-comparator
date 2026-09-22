# ADR-0002: Use Docker for toolchains

Status: Accepted

Date: 2026-09-22

Amendment (2026-09-22): [ADR-0004](0004-use-github-actions-with-an-isolated-local-runner.md)
replaces the historical GitLab host references with GitHub Actions and specifies
the local runner's container restrictions. Docker/OCI packaging and SDK approval
requirements remain unchanged. The separately authorized local discovery work
in [ADR-0005](0005-prototype-local-onnx-preflight.md) adds no vendor SDK image or
production deployment.

## Context

Developers and GitLab CI need a shared, inspectable toolchain without selecting
an application stack prematurely. Future vendor adapters must accommodate
Debian/Ubuntu-oriented binary SDKs, filesystem layout expectations, host CPU
architecture, drivers, GPUs, and license restrictions. The plan explicitly
requires clean-host automation trials and per-SDK deployment approval.

The user requests the simplest justified choice between Docker and Nix.
Packaging must preserve provenance without claiming that all vendor software
is portable, redistributable, or safe to execute.

## Decision

Use Dockerfiles producing OCI images, with digest-pinned base and CI image
references and locked dependencies. Implement only a developer-quality
container now. Add separate vendor Dockerfiles with their approved adapters,
not speculative SDK images or a universal all-vendor container. Node tooling
in this bootstrap supports repository quality checks; it is not an application
backend selection.

For each adopted adapter:

- Match the vendor-supported Linux distribution and CPU architecture. Record
  the resolved image/platform digest, package versions, lockfile, SDK hashes,
  adapter revision, and relevant host/driver/device requirements.
- Acquire SDKs only through authorized sources. Verify cryptographic hashes
  against reviewed expected values and signatures when available. Do not
  download mutable “latest” packages or assume a public download permits a
  hosted service, caching, redistribution, or publishing diagnostics.
- Pin package dependencies using ecosystem lockfiles; preserve exact SDK
  package hashes and acquisition metadata where no lockfile applies.
  Base-image pinning alone does not pin later package-manager downloads.
- Keep credentials and license secrets out of layers, Docker build arguments,
  Dockerfile environment variables, repositories, logs, and reproduction
  manifests. Use approved build secret mounts and runtime secret injection;
  ensure commands do not copy those secrets into outputs.
- Retain approved images in an access-controlled private registry, with SBOMs
  and dependency/license manifests, for the agreed reproducibility window.
  Retention and access remain subject to actual licenses, customer deletion,
  and vulnerability response; a private registry grants no redistribution
  right. Review digest/dependency updates and run regression tests.

Docker portability here means **Linux userspace on a compatible host**, not
portable kernels, GPU drivers, firmware, or arbitrary hardware. macOS/Windows
development uses an appropriate Linux VM; cross-architecture emulation is not
hardware-validation evidence. Native execution for a vendor that cannot use
the standard environment requires its own ADR specifying constraints,
isolation, provenance, CI checks, and approved deployment mode.

Containers alone are neither a complete sandbox for hostile models nor a
guarantee of bit-for-bit reproducible builds or numerical results. Worker
isolation and GPU tenancy require separate evidence-backed architecture
decisions. This packaging choice does not authorize exposing a host Docker
socket or running privileged untrusted jobs.

## Alternatives considered

- **Nix:** provides explicit dependency graphs, isolated package paths,
  sandboxed builds where supported, and strong foundations for hermetic
  environments and reproducibility. It is attractive for source-controlled
  toolchains. For the planned binary SDKs, nonstandard store paths can require
  FHS wrappers, binary patching, or extra packaging expertise. It does not
  remove licensing, GPU/host-driver, or cross-OS constraints. Maintaining Nix
  packaging in addition to vendor-supported installation paths is not yet
  justified. Revisit if container dependency drift or rebuilding costs become
  measured problems.
- **Native developer installs only:** fewer initial files, but insufficient
  separation of incompatible SDKs and greater workstation/runner drift.
- **Docker plus Nix immediately:** potentially useful later, but two
  environment systems before the first adapter double maintenance without
  demonstrated benefit.

## Consequences

One familiar environment format supports local quality checks and GitLab
runners while preserving conventional Linux binary SDK layouts. Per-adapter
images avoid coupling unrelated vendor versions and permissions.

Image storage, digest updates, vulnerability handling, and license-aware
retention need named owners. Pinning prevents silent updates but also delays
security fixes until reviewed updates land. Host drivers, devices, and build
inputs outside lockfiles remain separately controlled dependencies. Historical
reproduction may become unavailable after lawful deletion or SDK withdrawal;
report that limitation instead of fabricating reproducibility.

## Validation

The platform owner must build the developer-quality image and execute the same
format, lint, and test commands as CI. Repository checks must validate pinned
image references and locked bootstrap tooling. No vendor image build, GPU
compatibility test, or license approval is claimed by this ADR.

Before enabling each adapter, its owner must reproduce unattended installation
and positive/negative runs from the declared clean host/image, verify hashes,
record platform/driver requirements, and retain permitted manifests and SBOMs.
Security and legal owners must approve the relevant isolation and deployment
rights before hosted execution. Unresolved permissions block deployment;
customer-runner or import-only alternatives require their own reviewed scope.

## References

- [Docker build best practices: pin base image versions](https://docs.docker.com/build/building/best-practices/#pin-base-image-versions).
- [Docker build secrets](https://docs.docker.com/build/building/secrets/).
- [Nix reference manual: introduction](https://nix.dev/manual/nix/2.34/introduction.html).
- Sources above consulted 2026-09-22.
- [Project plan](../../PLAN.md), sections 2, 3.1, 4.3, 8.6, and 9.
- [ADR-0001](0001-record-architecture-decisions.md).
