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
  const unwired =
    /\.(py|pyi|pyw|js|cjs|jsx|ts|mts|cts|tsx|go|rs|c|cc|cpp|h|hpp|sh|bash|zsh|rb|java|kt|swift|cs|html|css|scss|svelte|vue|dart|php|lua|zig|pl|ex|erl|hs|nix)$/i;
  for (const file of files) {
    if (unwired.test(file)) {
      errors.push(
        `${file}: add language-specific lint, format, type/build and test CI before enabling this language in checkSources`,
      );
    }
    if (
      file.endsWith(".mjs") &&
      file !== "eslint.config.mjs" &&
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
  const ignored = new Set([".git", ".vscode", "node_modules", ".npm", "reports", "coverage"]);
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
    ".gitlab/merge_request_templates/Default.md",
    ".gitlab-ci.yml",
    "ci/Dockerfile",
  ]) {
    if (!existsSync(join(root, file))) errors.push(`Missing required file: ${file}`);
  }
  if (files.includes(".gitlab-ci.yml") && files.includes("ci/Dockerfile")) {
    const document = parseDocument(read(".gitlab-ci.yml"));
    if (!document.errors.length) {
      const pipeline = document.toJS();
      const image = pipeline?.default?.image;
      if (typeof image !== "string" || !/@sha256:[a-f0-9]{64}$/.test(image)) {
        errors.push("GitLab default image must be digest-pinned");
      } else if (!read("ci/Dockerfile").startsWith(`FROM ${image}\n`)) {
        errors.push("Local Docker and GitLab environments must use the same base digest");
      }
      if (
        !Array.isArray(pipeline?.quality?.script) ||
        !pipeline.quality.script.includes("npm run check") ||
        pipeline.quality.allow_failure
      ) {
        errors.push("GitLab must run blocking npm run check");
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
