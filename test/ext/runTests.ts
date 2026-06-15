// Extension integration test runner — uses @vscode/test-electron to download VS Code
// and run the mocha suite inside it. VSCODE_VERSION env var (default: "stable") is
// consumed here so the P0.4 CI matrix can override it per job.
import * as os from "os";
import * as path from "path";
import { fileURLToPath } from "url";
import { runTests } from "@vscode/test-electron";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const vscodeVersion = process.env["VSCODE_VERSION"] ?? "stable";

async function main(): Promise<void> {
  // Isolate the spawned VS Code from a parent extension-host environment. When
  // this runner is invoked from inside a VS Code / Cursor integrated terminal,
  // the host leaks env vars: ELECTRON_RUN_AS_NODE=1 makes the downloaded VS Code
  // binary run as plain Node, so it rejects every CLI flag ("bad option:
  // --user-data-dir", exit 9 before any test runs), and VSCODE_* vars (IPC hook,
  // PID, NLS config) can make it attach to the running editor. Strip them so the
  // child launches as a clean, standalone VS Code. No-op in CI, where these are
  // unset — so CI behavior is unchanged.
  delete process.env["ELECTRON_RUN_AS_NODE"];
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("VSCODE_")) delete process.env[key];
  }

  const extensionDevelopmentPath = path.resolve(__dirname, "../..");
  const extensionTestsPath = path.resolve(__dirname, "suite/index.js");

  // Use a short user-data-dir under /tmp to avoid the 103-char Unix socket limit
  // that triggers when the worktree path is long (common in .claude/worktrees/…).
  // Include the PID so parallel runs on the same host don't collide.
  const userDataDir = path.join(os.tmpdir(), `penmark-ext-test-${process.pid}`);

  await runTests({
    version: vscodeVersion,
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: ["--user-data-dir", userDataDir],
  });
}

main().catch((err: unknown) => {
  console.error("Extension test run failed:", err);
  process.exit(1);
});
