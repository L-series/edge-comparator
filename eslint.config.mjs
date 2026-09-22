import js from "@eslint/js";

export default [
  {
    // The frontend has its own mandatory, type-aware lint step in CI.
    ignores: [
      "**/node_modules/**",
      "**/.venv/**",
      "**/dist/**",
      "**/.npm/**",
      "**/reports/**",
      "**/coverage/**",
      ".vscode/**",
      "frontend/**",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.mjs"],
    languageOptions: { globals: { process: "readonly", console: "readonly" } },
  },
];
