import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, URL } from "node:url";
import {
  agentNames,
  checkAdr,
  checkAgent,
  checkRepository,
  checkSources,
  checkYaml,
} from "../tools/check-repository.mjs";

const adr = `# ADR-0001: Record decisions

Status: Accepted
Date: 2026-09-22

## Context
We need traceable decisions.
## Decision
Record significant choices.
## Alternatives considered
Unrecorded decisions lose rationale.
## Consequences
Reviewers maintain the decision log.
## Validation
CI checks document structure.
## References
https://architecture-decision-record.github.io/
`;

test("accepts a complete ADR and each lifecycle status", () => {
  for (const status of ["Proposed", "Accepted", "Rejected", "Deprecated", "Superseded"]) {
    assert.deepEqual(checkAdr("0001-record-decisions.md", adr.replace("Accepted", status)), []);
  }
});

test("rejects malformed ADR identities, dates, statuses, and empty sections", () => {
  for (const [filename, content] of [
    ["decision.md", adr],
    ["0002-record-decisions.md", adr],
    ["0001-record-decisions.md", adr.replace("Accepted", "Maybe")],
    ["0001-record-decisions.md", adr.replace("2026-09-22", "yesterday")],
    ["0001-record-decisions.md", adr.replace("2026-09-22", "2026-02-30")],
    ["0001-record-decisions.md", adr.replace("## Context", "## Background")],
    ["0001-record-decisions.md", adr.replace("We need traceable decisions.", "")],
  ]) {
    assert.ok(checkAdr(filename, content).length > 0);
  }
});

const agent = (name, model) => `---
name: ${name}
description: Own bounded implementation tasks.
model: ${model}
---

Read AGENTS.md and PLAN.md. Load ponytail before coding.
Follow the ADR and TDD requirements in CONTRIBUTING.md.
`;

test("requires the architect and specialist model tiers in valid agent profiles", () => {
  assert.deepEqual(
    checkAgent("principal-architect", agent("principal-architect", "gpt-6-astra")),
    [],
  );
  assert.deepEqual(
    checkAgent("backend-data-engineer", agent("backend-data-engineer", "gemini-3.8-flash")),
    [],
  );
  for (const content of [
    "No frontmatter",
    agent("principal-architect", "gemini-3.8-flash"),
    agent("other-name", "gpt-6-astra"),
    agent("principal-architect", "gpt-6-astra").replace("description:", "purpose:"),
    agent("principal-architect", "gpt-6-astra").replace("AGENTS.md", ""),
    agent("principal-architect", "gpt-6-astra").replace("ponytail", ""),
    agent("principal-architect", "gpt-6-astra").replace("name:", "name: ["),
  ]) {
    assert.ok(checkAgent("principal-architect", content).length > 0);
  }
});

test("rejects malformed YAML and duplicate keys instead of silently overriding them", () => {
  assert.deepEqual(checkYaml("job:\n  script: npm test\n"), []);
  assert.ok(checkYaml("job: [\n").length > 0);
  assert.ok(checkYaml("job: first\njob: second\n").length > 0);
});

test("blocks application code until its language-specific gates are implemented", () => {
  assert.deepEqual(
    checkSources([
      "PLAN.md",
      "tools/check-repository.mjs",
      "tests/check-repository.test.mjs",
      "eslint.config.mjs",
      "backend/src/edge_comparator/api.py",
      "backend/tests/test_api.py",
      "backend/stubs/openvino/__init__.pyi",
      "backend/stubs/openvino/frontend/__init__.pyi",
      "frontend/src/App.tsx",
      "frontend/src/style.css",
      "frontend/index.html",
      "frontend/vite.config.ts",
      "frontend/playwright.config.ts",
      "frontend/eslint.config.mjs",
      "frontend/e2e/inspect.spec.ts",
    ]),
    [],
  );
  for (const file of [
    "backend/app.py",
    "backend/stubs/unknown/__init__.pyi",
    "frontend/Button.tsx",
    "frontend/index.ts",
    "app.js",
    "app.jsx",
    "service/main.go",
    "worker/lib.rs",
    "scripts/build.sh",
    "firmware/main.c",
    "firmware/main.cpp",
    "frontend/uncovered.mjs",
    "tools/uncovered.mjs",
  ]) {
    assert.ok(checkSources([file]).length > 0, file);
  }
});

test("requires actual backend and frontend CI gates before accepting application sources", (t) => {
  const { root, write } = fixture(t);
  write("backend/src/edge_comparator/api.py", "# API\n");
  write("frontend/src/App.tsx", "// UI\n");
  assert.ok(checkRepository(root).some((error) => error.includes("Backend CI")));
  assert.ok(checkRepository(root).some((error) => error.includes("Frontend CI")));
  for (const path of [
    "backend/pyproject.toml",
    "backend/uv.lock",
    "frontend/package.json",
    "frontend/package-lock.json",
  ]) {
    write(path, "{}");
  }
  const steps = `
      - working-directory: backend
        run: |
          uv sync --frozen --all-groups
          uv run --frozen ruff check .
          uv run --frozen ruff format --check .
          uv run --frozen mypy src tests
          uv run --frozen pytest
          uv build --no-sources
      - run: npm --prefix frontend ci --ignore-scripts --no-audit --no-fund
      - run: npm --prefix frontend run check
`;
  write(".github/workflows/ci.yml", pipeline + steps);
  assert.deepEqual(checkRepository(root), []);
  write(
    ".github/workflows/ci.yml",
    pipeline + steps.replace("uv run --frozen pytest", "echo skipped"),
  );
  assert.ok(checkRepository(root).some((error) => error.includes("Backend CI")));
  write(
    ".github/workflows/ci.yml",
    pipeline +
      steps.replace(
        "      - run: npm --prefix frontend run check",
        "      - if: false\n        run: npm --prefix frontend run check",
      ),
  );
  assert.ok(checkRepository(root).some((error) => error.includes("Frontend CI")));

  write("frontend/e2e/inspect.spec.ts", "// Real browser flow\n");
  write(".github/workflows/ci.yml", pipeline + steps);
  assert.ok(checkRepository(root).some((error) => error.includes("Browser CI")));
  write(
    ".github/workflows/ci.yml",
    pipeline + steps + "      - run: npm --prefix frontend run test:e2e\n",
  );
  write(
    "frontend/package.json",
    JSON.stringify({ devDependencies: { "@playwright/test": "1.63.0" } }),
  );
  write(
    "ci/runner.Dockerfile",
    `FROM ${image} AS node\nFROM mcr.microsoft.com/playwright:v1.63.0-noble@sha256:${"a".repeat(64)}\n`,
  );
  assert.deepEqual(checkRepository(root), []);
  write(
    "frontend/package.json",
    JSON.stringify({ devDependencies: { "@playwright/test": "1.64.0" } }),
  );
  assert.ok(checkRepository(root).some((error) => error.includes("Playwright")));
  write("frontend/package.json", "{invalid");
  assert.ok(checkRepository(root).some((error) => error.includes("Invalid frontend package")));
});

test("requires an unconditional real-SDK integration gate when the compiler ships", (t) => {
  const { root, write } = fixture(t);
  write("backend/src/edge_comparator/compiler_worker.py", "# Compiler\n");
  const command =
    "uv run --frozen pytest -m integration --no-cov --junitxml=reports/compiler-integration.xml";
  write(".github/workflows/ci.yml", pipeline);
  assert.ok(checkRepository(root).some((error) => error.includes("Compiler CI")));
  const step = `
      - working-directory: backend
        run: ${command}
`;
  write(".github/workflows/ci.yml", pipeline + step);
  assert.ok(!checkRepository(root).some((error) => error.includes("Compiler CI")));
  write(
    ".github/workflows/ci.yml",
    pipeline + step.replace("        run:", "        if: false\n        run:"),
  );
  assert.ok(checkRepository(root).some((error) => error.includes("Compiler CI")));
});

const image = `node:24-bookworm-slim@sha256:${"a".repeat(64)}`;
const runner =
  "${{ github.event_name == 'pull_request' && 'ubuntu-24.04' || 'edge-comparator-local' }}";
const condition =
  "${{ github.repository == 'L-series/edge-comparator' && (github.event_name == 'pull_request' || (github.ref == 'refs/heads/main' && github.actor == github.repository_owner)) }}";
const pipeline = `name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
jobs:
  quality:
    if: ${condition}
    runs-on: ${runner}
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@${"a".repeat(40)}
        with:
          persist-credentials: false
      - run: npm run check
`;

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "hw-comparator-governance-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  function write(path, content) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  write("docs/decisions/0001-record-decisions.md", adr);
  write(".github/workflows/ci.yml", pipeline);
  write("ci/Dockerfile", `FROM ${image}\n`);
  write("ci/runner.Dockerfile", `FROM ${image} AS node\n`);
  write("AGENTS.md", "# Instructions\n");
  write("CONTRIBUTING.md", "# Contributing\n");
  write(".github/pull_request_template.md", "# PR\n");
  for (const name of agentNames) {
    write(
      `.github/agents/${name}.agent.md`,
      agent(name, name === "principal-architect" ? "gpt-6-astra" : "gemini-3.8-flash"),
    );
  }
  return { root, write };
}

test("accepts the real repository and a minimal valid fixture", (t) => {
  assert.deepEqual(checkRepository(fileURLToPath(new URL("..", import.meta.url))), []);
  const { root, write } = fixture(t);
  write("node_modules/ignored/index.js", "ignored");
  assert.deepEqual(checkRepository(root), []);
});

test("reports missing policies, agents, and decision records", (t) => {
  const { root } = fixture(t);
  rmSync(join(root, "AGENTS.md"));
  rmSync(join(root, "docs/decisions/0001-record-decisions.md"));
  rmSync(join(root, ".github/agents/qa-engineer.agent.md"));
  const errors = checkRepository(root);
  assert.ok(errors.includes("Missing required file: AGENTS.md"));
  assert.ok(errors.includes("Missing numbered architecture decision records"));
  assert.ok(errors.includes("Missing role agent: qa-engineer"));
});

test("rejects duplicate decision numbers and unwired application code", (t) => {
  const { root, write } = fixture(t);
  write("docs/decisions/0001-another-decision.md", adr);
  write("backend/app.py", "print('unwired')\n");
  const errors = checkRepository(root);
  assert.ok(errors.some((error) => error.includes("duplicate ADR number")));
  assert.ok(errors.some((error) => error.includes("language-specific lint")));
});

test("rejects unsafe triggers, runner routing, tokens, actions, and weakened CI jobs", (t) => {
  const { root, write } = fixture(t);
  for (const invalid of [
    "quality: [",
    pipeline.replace("pull_request:", "pull_request_target:"),
    pipeline.replace("[main]", "[other]"),
    pipeline.replace(runner, "self-hosted"),
    pipeline.replace(condition, "always()"),
    pipeline.replace("contents: read", "contents: write"),
    pipeline.replace("a".repeat(40), "v4"),
    pipeline.replace("persist-credentials: false", "persist-credentials: true"),
    pipeline.replace("npm run check", "echo skipped"),
    pipeline.replace("npm run check", "echo npm run check"),
    `${pipeline}        continue-on-error: true\n`,
    `${pipeline}        if: false\n`,
    pipeline.replace("    steps:", "    continue-on-error: true\n    steps:"),
    pipeline.replace("timeout-minutes: 20", "timeout-minutes: 360"),
    pipeline.replace("timeout-minutes: 20", "timeout-minutes: 0"),
    pipeline.replace(/ {4}steps:[\s\S]+/, "    steps: invalid\n"),
    pipeline.replace(/ {4}steps:[\s\S]+/, "    steps: [null, 42]\n"),
    `${pipeline}  another-job:\n    runs-on: self-hosted\n`,
    "null\n",
  ]) {
    write(".github/workflows/ci.yml", invalid);
    assert.ok(checkRepository(root).length > 0, invalid);
  }
});

test("rejects unexpected workflows rather than letting them bypass runner policy", (t) => {
  const { root, write } = fixture(t);
  write(".github/workflows/unreviewed.yml", "on: pull_request\n");
  assert.ok(checkRepository(root).some((error) => error.includes("Unreviewed workflow")));
});

test("requires digest-pinned Docker bases and matching local and runner Node versions", (t) => {
  const { root, write } = fixture(t);
  for (const invalid of [
    "# No base image\n",
    "FROM node:latest\n",
    `FROM ${image.replace(/a{64}$/, "b".repeat(64))} AS node\n`,
    `FROM ${image} AS node\nFROM ubuntu:latest\n`,
  ]) {
    write("ci/runner.Dockerfile", invalid);
    assert.ok(checkRepository(root).length > 0, invalid);
  }
  write("ci/runner.Dockerfile", `FROM ${image} AS node\n`);
  write("ci/Dockerfile", "FROM node:latest\n");
  assert.ok(checkRepository(root).length > 0);
});

test("CLI fails closed for invalid repositories and succeeds for valid ones", (t) => {
  const { root, write } = fixture(t);
  const tool = fileURLToPath(new URL("../tools/check-repository.mjs", import.meta.url));
  const run = () => spawnSync(process.execPath, [tool], { cwd: root, encoding: "utf8" });
  const valid = run();
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /checks passed/);
  write("unwired.ts", "export const missingTests = true;\n");
  const invalid = run();
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /unwired.ts/);
});
