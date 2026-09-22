import js from "@eslint/js";

export default [
  { ignores: ["node_modules/**", ".npm/**", "reports/**", "coverage/**", ".vscode/**"] },
  js.configs.recommended,
  {
    files: ["**/*.mjs"],
    languageOptions: { globals: { process: "readonly", console: "readonly" } },
  },
];
