import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { parseDocument } from "yaml";

export const agentNames = [
  "principal-architect",
  "ml-compiler-engineer",
  "backend-data-engineer",
  "frontend-engineer",
  "platform-security-engineer",
  "embedded-hil-engineer",
  "qa-engineer",
  "product-designer",
  "licensing-researcher",
  "catalog-curator",
];

const sections = [
  "Context",
  "Decision",
  "Alternatives considered",
  "Consequences",
  "Validation",
  "References",
];

export function checkAdr(filename, text) {
  const errors = [];
  const id = /^(\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.exec(filename)?.[1];
  if (!id || !text.startsWith(`# ADR-${id}: `)) errors.push("ADR filename/title mismatch");
  if (!/^Status: (Proposed|Accepted|Rejected|Deprecated|Superseded)$/m.test(text)) {
    errors.push("ADR requires an explicit lifecycle status");
  }
  const date = /^Date: (\d{4}-\d{2}-\d{2})$/m.exec(text)?.[1];
  const timestamp = Date.parse(date);
  if (
    !date ||
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString().slice(0, 10) !== date
  ) {
    errors.push("ADR requires a valid ISO calendar date");
  }
  for (const section of sections) {
    const body = new RegExp(`^## ${section}\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, "m")
      .exec(text)?.[1]
      ?.trim();
    if (!body) errors.push(`ADR requires a nonempty ${section} section`);
  }
  return errors;
}

export function checkYaml(text) {
  return parseDocument(text, { uniqueKeys: true }).errors.map((error) => error.message);
}

export function checkAgent(name, text) {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]+)$/.exec(text);
  if (!match) return ["Agent requires YAML frontmatter and instructions"];
  const errors = checkYaml(match[1]);
  if (errors.length) return errors;
  const profile = parseDocument(match[1]).toJS();
  const model = name === "principal-architect" ? "gpt-6-astra" : "gemini-3.8-flash";
  if (profile?.name !== name) errors.push("Agent name must match its filename");
  if (typeof profile?.description !== "string" || !profile.description.trim()) {
    errors.push("Agent requires a description");
  }
  if (profile?.model !== model) errors.push(`Agent must use ${model}`);
  for (const instruction of ["AGENTS.md", "ponytail", "CONTRIBUTING.md"]) {
    if (!match[2].includes(instruction)) errors.push(`Agent must reference ${instruction}`);
  }
  return errors;
}

export function checkSources(files) {
  const errors = [];
  const supported =
    /^(backend\/(?:src|tests)\/.+\.py|frontend\/(?:src\/.+\.(?:tsx?|css)|e2e\/.+\.ts|(?:vite|vitest|playwright)\.config\.ts|index\.html))$/;
  const unwired =
    /\.(py|pyi|pyw|js|cjs|jsx|ts|mts|cts|tsx|go|rs|c|cc|cpp|h|hpp|sh|bash|zsh|rb|java|kt|swift|cs|html|css|scss|svelte|vue|dart|php|lua|zig|pl|ex|erl|hs|nix)$/i;
  for (const file of files) {
    if (unwired.test(file) && !supported.test(file)) {
      errors.push(
        `${file}: add language-specific lint, format, type/build and test CI before enabling this language in checkSources`,
      );
    }
    if (
      file.endsWith(".mjs") &&
      file !== "eslint.config.mjs" &&
      file !== "frontend/eslint.config.mjs" &&
      !/^tests\/.+\.test\.mjs$/.test(file)
    ) {
      const test = file.replace(/^tools\//, "tests/").replace(/\.mjs$/, ".test.mjs");
      if (!file.startsWith("tools/") || !files.includes(test)) {
        errors.push(
          `${file}: bootstrap modules must live in tools/ and have a matching tests/*.test.mjs`,
        );
      }
    }
  }
  return errors;
}

export function checkRepository(root) {
  const ignored = new Set([
    ".git",
    ".vscode",
    "node_modules",
    ".npm",
    "reports",
    "coverage",
    ".venv",
    "__pycache__",
    ".mypy_cache",
    ".ruff_cache",
    ".pytest_cache",
    "dist",
    "test-results",
    "playwright-report",
  ]);
  function walk(directory = "") {
    return readdirSync(join(root, directory), { withFileTypes: true }).flatMap((entry) => {
      if (ignored.has(entry.name)) return [];
      const path = directory ? `${directory}/${entry.name}` : entry.name;
      return entry.isDirectory() ? walk(path) : [path];
    });
  }
  const files = walk();
  const errors = checkSources(files);
  const read = (file) => readFileSync(join(root, file), "utf8");
  const add = (file, findings) => errors.push(...findings.map((finding) => `${file}: ${finding}`));
  for (const file of files) {
    if (/\.ya?ml$/.test(file)) add(file, checkYaml(read(file)));
    if (/^\.github\/workflows\/.+\.ya?ml$/.test(file) && file !== ".github/workflows/ci.yml") {
      errors.push(`${file}: Unreviewed workflow; extend the tested runner policy first`);
    }
  }
  const adrs = files.filter((file) => /^docs\/decisions\/\d/.test(file));
  if (!adrs.length) errors.push("Missing numbered architecture decision records");
  const ids = new Set();
  for (const file of adrs) {
    add(file, checkAdr(basename(file), read(file)));
    const id = basename(file).slice(0, 4);
    if (ids.has(id)) errors.push(`${file}: duplicate ADR number ${id}`);
    ids.add(id);
  }
  for (const name of agentNames) {
    const file = `.github/agents/${name}.agent.md`;
    if (!files.includes(file)) errors.push(`Missing role agent: ${name}`);
    else add(file, checkAgent(name, read(file)));
  }
  for (const file of [
    "AGENTS.md",
    "CONTRIBUTING.md",
    ".github/pull_request_template.md",
    ".github/workflows/ci.yml",
    "ci/Dockerfile",
    "ci/runner.Dockerfile",
  ]) {
    if (!existsSync(join(root, file))) errors.push(`Missing required file: ${file}`);
  }
  for (const file of ["ci/Dockerfile", "ci/runner.Dockerfile"]) {
    if (!files.includes(file)) continue;
    const bases = [...read(file).matchAll(/^FROM (\S+)/gm)].map((match) => match[1]);
    if (!bases.length || bases.some((base) => !/@sha256:[a-f0-9]{64}$/.test(base))) {
      errors.push(`${file}: Docker bases must be digest-pinned`);
    }
  }
  if (files.includes("ci/Dockerfile") && files.includes("ci/runner.Dockerfile")) {
    const base = read("ci/Dockerfile").split("\n")[0];
    if (!read("ci/runner.Dockerfile").startsWith(`${base} AS node\n`)) {
      errors.push("Local quality image and CI runner must use the same Node base digest");
    }
  }
  if (files.includes(".github/workflows/ci.yml")) {
    const document = parseDocument(read(".github/workflows/ci.yml"));
    if (!document.errors.length) {
      const pipeline = document.toJS();
      const events = Object.keys(pipeline?.on ?? {})
        .sort()
        .join(",");
      if (
        events !== "pull_request,push,workflow_dispatch" ||
        JSON.stringify(pipeline.on.push?.branches) !== '["main"]' ||
        JSON.stringify(pipeline.on.pull_request?.branches) !== '["main"]'
      ) {
        errors.push(
          "CI must use main-only pushes/PRs and manual dispatch, never privileged PR triggers",
        );
      }
      if (JSON.stringify(pipeline?.permissions) !== '{"contents":"read"}') {
        errors.push("CI tokens must have only read access to repository contents");
      }
      const job = pipeline?.jobs?.quality;
      const routing =
        "${{ github.event_name == 'pull_request' && 'ubuntu-24.04' || 'edge-comparator-local' }}";
      const condition =
        "${{ github.repository == 'L-series/edge-comparator' && (github.event_name == 'pull_request' || (github.ref == 'refs/heads/main' && github.actor == github.repository_owner)) }}";
      if (
        Object.keys(pipeline?.jobs ?? {}).join(",") !== "quality" ||
        job?.["runs-on"] !== routing ||
        job?.if !== condition
      ) {
        errors.push("Only trusted owner/main jobs may use the local runner; PRs must run hosted");
      }
      const steps = Array.isArray(job?.steps) ? job.steps : [];
      if (
        files.some((file) => /^backend\/.+\.py$/.test(file)) &&
        (["backend/pyproject.toml", "backend/uv.lock"].some((file) => !files.includes(file)) ||
          !steps.some(
            (step) =>
              step?.["working-directory"] === "backend" &&
              !("if" in step) &&
              [
                "uv sync --frozen --all-groups",
                "uv run --frozen ruff check .",
                "uv run --frozen ruff format --check .",
                "uv run --frozen mypy src tests",
                "uv run --frozen pytest",
                "uv build --no-sources",
              ].every((command) => String(step.run).split("\n").includes(command)),
          ))
      ) {
        errors.push(
          "Backend CI requires locked dependencies, Ruff, strict typing, coverage tests, and packaging",
        );
      }
      if (
        files.some((file) => /^frontend\/.+\.(tsx?|css|html|mjs)$/.test(file)) &&
        (["frontend/package.json", "frontend/package-lock.json"].some(
          (file) => !files.includes(file),
        ) ||
          ![
            "npm --prefix frontend ci --ignore-scripts --no-audit --no-fund",
            "npm --prefix frontend run check",
          ].every((command) => steps.some((step) => step?.run === command && !("if" in step))))
      ) {
        errors.push(
          "Frontend CI requires locked dependencies and blocking lint/type/test/build checks",
        );
      }
      if (
        !Number.isInteger(job?.["timeout-minutes"]) ||
        job["timeout-minutes"] < 1 ||
        job["timeout-minutes"] > 30 ||
        job["continue-on-error"] ||
        !steps.some((step) => step?.run === "npm run check" && !("if" in step))
      ) {
        errors.push("GitHub Actions must run bounded, blocking npm run check");
      }
      for (const step of steps) {
        if (!step || typeof step !== "object") {
          errors.push("CI steps must be mappings");
          continue;
        }
        if (step["continue-on-error"]) errors.push("CI steps must not allow failures");
        if (step.uses && !/^[\w-]+\/[\w-]+@[a-f0-9]{40}$/.test(step.uses)) {
          errors.push("Actions must be pinned to full commit SHAs");
        }
        if (
          step.uses?.startsWith("actions/checkout@") &&
          step.with?.["persist-credentials"] !== false
        ) {
          errors.push("Checkout must not persist credentials");
        }
      }
    }
  }
  return errors;
}

if (import.meta.main) {
  const errors = checkRepository(process.cwd());
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  } else {
    console.log("Repository governance checks passed.");
  }
}
