import { defineConfig, devices } from "@playwright/test";

const harnessPort = 4173;

export default defineConfig({
  // T12 widened the search to test/ so the layer-3 perf spec (test/perf/) is
  // discovered alongside the existing browser specs (test/browser/). testMatch
  // keeps it to *.spec.ts files only.
  testDir: "test",
  testMatch: ["browser/**/*.spec.ts", "perf/**/*.spec.ts"],
  // The visual goldens live under test/browser/__snapshots__/<file>/ — pin the
  // template to that root and key by the spec's BASENAME ({testFileName}) so the
  // committed theme goldens keep resolving after the testDir widening above
  // (testFilePath would now carry the browser/ prefix and miss the goldens).
  snapshotPathTemplate: "test/browser/__snapshots__/{testFileName}/{arg}{ext}",
  use: {
    baseURL: `http://localhost:${harnessPort}`,
    screenshot: "only-on-failure",
  },
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.05,
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `tsx test/harness/serve.ts`,
    url: `http://localhost:${harnessPort}`,
    reuseExistingServer: false,
    timeout: 10000,
  },
});
