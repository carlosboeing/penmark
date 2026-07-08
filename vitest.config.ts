import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The host ("src/vscode") unit tests run under vitest with the real `vscode`
// module aliased to a minimal mock — the genuine module only exists inside the
// Electron host (layer-4 @vscode/test-electron, broken on this macOS host, D16).
const vscodeMock = fileURLToPath(new URL("./test/setup/vscode-mock.ts", import.meta.url));

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "core",
          include: [
            "src/core/**/*.test.ts",
            "test/unit/core/**/*.test.ts",
            // T11 formatter golden gate: in-memory formatter matrix over the
            // anchored conformance corpus (proves the P0.1 GO verdict holds in CI).
            "test/golden/formatters/**/*.test.ts",
            // R16 blocking acceptance gate: full ReconcileResult goldens over the
            // §8 desync scenarios + real-git concurrent-merge scenarios (design §11).
            "test/golden/reconcile/**/*.test.ts",
            "test/golden/merge/**/*.test.ts",
          ],
          environment: "node",
          sequence: { groupOrder: 0 },
        },
      },
      {
        test: {
          name: "perf",
          include: [
            // T12 layer-1 performance bench: first-render budget over the host
            // pipeline (design §8). Run after the parallel projects so CI runner
            // contention does not become the measured subject.
            "test/perf/**/*.test.ts",
          ],
          environment: "node",
          sequence: { groupOrder: 1 },
        },
      },
      {
        test: {
          name: "webview",
          include: ["src/webview/**/*.test.ts", "test/unit/webview/**/*.test.ts"],
          environment: "jsdom",
          setupFiles: ["test/setup/vscode-api-mock.ts"],
          sequence: { groupOrder: 0 },
        },
      },
      {
        // Host glue (src/vscode) logic units. The `vscode` import is aliased to
        // test/setup/vscode-mock.ts; coverage stays excluded (thin glue, D16).
        resolve: { alias: { vscode: vscodeMock } },
        test: {
          name: "host",
          include: ["src/vscode/**/*.test.ts", "test/unit/vscode/**/*.test.ts"],
          environment: "node",
          sequence: { groupOrder: 0 },
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/vscode/**/*.ts",
        // Mermaid lazy chunk (T9): browser-only DOM rendering (mermaid +
        // svg-pan-zoom) that needs a real SVG engine — covered by the Playwright
        // suite (test/browser/mermaid.spec.ts), not unit tests. The gating logic
        // lives in src/webview/mermaidLoader.ts, which IS unit-covered.
        "src/webview/mermaid.ts",
        "src/webview/mermaid/**/*.ts",
      ],
      reporter: ["text", "lcov", "json-summary"],
      thresholds: {
        "src/core/**": { lines: 85 },
        "src/core/comments/**": { lines: 95 }, // v0.5: format correctness is the product's trust foundation
        "src/webview/**": { lines: 80 },
      },
    },
  },
});
