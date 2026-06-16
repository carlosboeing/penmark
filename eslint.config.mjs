import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/", "node_modules/", "spikes/", "coverage/", "*.mjs", "test/ext/suite/index.js"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  // ADR 0001 boundary: src/core is platform-agnostic and must never import vscode.
  {
    files: ["src/core/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "vscode",
              message: "src/core is platform-agnostic (ADR 0001) — no vscode imports.",
            },
          ],
        },
      ],
    },
  },
  // The webview talks to the host via the versioned message protocol only.
  {
    files: ["src/webview/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "vscode",
              message: "webview code communicates via the message protocol only (ADR 0001).",
            },
          ],
        },
      ],
    },
  },
);
