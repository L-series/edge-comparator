# Local GitHub Actions runner

The repository is public. Only trusted owner/main pushes and owner-dispatched
main-branch jobs belong on this machine. PR checks run on GitHub-hosted runners.
Never approve a fork workflow that targets `self-hosted` or `edge-comparator-local`.
GitHub's external-contributor approval policy must be `all_external_contributors`.
Do not use this runner for private model uploads, vendor SDKs, or deployment secrets.

## Isolation and limits

The runner is a dedicated, nonroot Docker container with no host bind mounts,
devices, Docker socket, SSH agent, or developer/GitHub credentials. The only runner
credentials are generated inside its writable container layer during registration.
Do not export that layer or commit an image after registration.

Docker shares the host kernel and its bridge permits network access: this is
defense in depth for trusted CI, **not a sandbox for hostile contributors**.
Jobs can retain state or access runner credentials inside this long-lived
container. Review dependency and workflow changes before execution. Remove the
runner if trust cannot be maintained; use a dedicated disposable VM for stronger
isolation. Labels and workflow `if` conditions are routing, not access controls.

## Provision

Use an authenticated `gh` session with repository administration access. The
registration token is short-lived, never written to a file, and sent over stdin
without printing it. Runner installation does not receive the developer's token.
Review image updates and build the digest-pinned recipe before registration:

```sh
docker build -f ci/runner.Dockerfile -t edge-comparator-runner:local .
docker run -d --name edge-comparator-ci --restart unless-stopped --init \
  --cpus 2 --memory 4g --pids-limit 512 --shm-size 512m \
  --log-opt max-size=10m --log-opt max-file=3 \
  --cap-drop ALL --security-opt no-new-privileges \
  edge-comparator-runner:local
gh api --method POST repos/L-series/edge-comparator/actions/runners/registration-token \
  --jq .token | docker exec -i edge-comparator-ci bash -c \
  'read -r token; ./config.sh --unattended --url https://github.com/L-series/edge-comparator --token "$token" --name edge-comparator-local --labels edge-comparator-local --work _work --disableupdate'
```

The entrypoint waits for registration before running the listener. Docker restarts
it after a host restart when the Docker service starts; deliberately stopping the
container keeps it stopped. Container recreation requires fresh registration.
The runner image is pinned rather than self-updating; rebuild and re-register
within GitHub's update window (normally 30 days, sooner for critical updates).

## Verify and operate

```sh
docker inspect edge-comparator-ci --format '{{.State.Status}}'
gh api repos/L-series/edge-comparator/actions/runners \
  --jq '.runners[] | {id, name, status, busy}'
gh workflow run ci.yml --ref main
gh run list --workflow ci.yml --limit 5
```

Verify an actual completed run's job metadata identifies this runner. A running
container alone is not evidence that GitHub can dispatch work. All quality checks
are blocking; reports contain only generated public test fixtures and expire after
14 days. Never upload arbitrary working directories or model files as CI artifacts.

To pause, use `docker stop edge-comparator-ci`; resume with `docker start`.
To retire, stop it, remove its specific registration ID through GitHub, and remove
the named container. Never prune unrelated Docker resources. Recreating the
container also clears its private writable job workspace.

The smaller `ci/Dockerfile` is an offline repository-tooling check environment,
not the complete application runner or an untrusted-model worker. Both recipes
use the same digest-pinned Node release. The runner additionally pins GitHub's
runner base, uv, Hadolint, and actionlint images.

The browser-capable runner uses Microsoft's digest-pinned Playwright Ubuntu image
for browser binaries and native dependencies, rather than installing unpinned
system packages during local jobs. The recipe copies GitHub's pinned runner and
the pinned Node/tool binaries into that base and runs as a dedicated nonroot user.
The Playwright npm version and image version must move together; governance tests
reject drift. This larger development image is not an application deployment image.
Hosted PRs additionally build and exercise both Docker recipes without access to
this machine's Docker socket.
