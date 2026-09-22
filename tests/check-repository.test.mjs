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
    ]),
    [],
  );
  for (const file of [
    "backend/app.py",
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

const image = `node:24-bookworm-slim@sha256:${"a".repeat(64)}`;
const pipeline = `default:\n  image: ${image}\nquality:\n  script:\n    - npm run check\n`;

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "hw-comparator-governance-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  function write(path, content) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  write("docs/decisions/0001-record-decisions.md", adr);
  write(".gitlab-ci.yml", pipeline);
  write("ci/Dockerfile", `FROM ${image}\n`);
  write("AGENTS.md", "# Instructions\n");
  write("CONTRIBUTING.md", "# Contributing\n");
  write(".gitlab/merge_request_templates/Default.md", "# MR\n");
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

test("rejects invalid pipeline YAML, mutable images, environment drift, and weakened jobs", (t) => {
  const { root, write } = fixture(t);
  for (const invalid of [
    "quality: [",
    pipeline.replace(image, "node:latest"),
    pipeline.replace(image, image.replace(/a{64}$/, "b".repeat(64))),
    pipeline.replace("npm run check", "echo skipped"),
    pipeline.replace("script:\n    - npm run check", "script: echo npm run check"),
    `${pipeline}  allow_failure: true\n`,
    "null\n",
  ]) {
    write(".gitlab-ci.yml", invalid);
    assert.ok(checkRepository(root).length > 0, invalid);
  }
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
