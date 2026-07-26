/**
 * Sideload the packaged VSIX into every IDE on this machine that can take it.
 *
 * Penmark is distributed local-first: there is no marketplace install, so every
 * test of a change means packaging and sideloading by hand, into as many as
 * three IDEs. This does that in one command.
 *
 * It packages first (unless --no-build), then installs into each IDE it can
 * find, then reads back the installed version so a silent failure cannot pass
 * for success. Installs use --force, so re-running with an unchanged version
 * number still replaces the bits — which matters during development, where the
 * version rarely moves between builds.
 *
 * Usage:
 *   npm run install:local             package, then install everywhere
 *   npm run install:local -- --no-build   install the existing VSIX as-is
 *   npm run install:local -- --dry-run    report what would happen
 *
 * Reload the IDE window afterwards: the extension host does not pick up a
 * swapped extension on its own.
 */

import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const EXTENSION_ID = "local.penmark-markdown-review";

/**
 * Where each IDE's CLI lives. `command` is tried on PATH first; `fallbacks` are
 * absolute paths for IDEs that do not install a PATH shim (Antigravity ships
 * its CLI inside the bundle and offers no "install shell command" by default).
 * Unknown IDEs are simply skipped, so this list can grow without breaking.
 */
const IDES = [
  { name: "VS Code", command: "code", fallbacks: [] },
  { name: "VS Code Insiders", command: "code-insiders", fallbacks: [] },
  { name: "Cursor", command: "cursor", fallbacks: [] },
  { name: "Windsurf", command: "windsurf", fallbacks: [] },
  {
    name: "Antigravity",
    command: "antigravity-ide",
    fallbacks: [
      "/Applications/Antigravity IDE.app/Contents/Resources/app/bin/antigravity-ide",
      `${process.env.HOME ?? ""}/Applications/Antigravity IDE.app/Contents/Resources/app/bin/antigravity-ide`,
    ],
  },
];

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: "utf8", stdio: "pipe", ...opts });
}

/** The CLI path for an IDE, or null when it is not installed here. */
export function resolveCli(ide) {
  const candidates = [ide.command, ...ide.fallbacks];
  for (const candidate of candidates) {
    try {
      run(candidate, ["--version"]);
      return candidate;
    } catch {
      // Not on PATH, not at that path, or not runnable — try the next.
    }
  }
  return null;
}

/** The installed version of `EXTENSION_ID` for a CLI, or null when absent. */
export function installedVersion(cli) {
  let out;
  try {
    out = run(cli, ["--list-extensions", "--show-versions"]);
  } catch {
    return null;
  }
  const line = out.split("\n").find((l) => l.startsWith(`${EXTENSION_ID}@`));
  return line ? line.slice(EXTENSION_ID.length + 1).trim() : null;
}

function main() {
  const args = process.argv.slice(2);
  const noBuild = args.includes("--no-build");
  const dryRun = args.includes("--dry-run");

  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const vsix = path.join(root, `${pkg.name}-${pkg.version}.vsix`);

  if (!noBuild && !dryRun) {
    console.log(`Packaging ${pkg.name} ${pkg.version}...`);
    run("npm", ["run", "package"], { cwd: root, stdio: "inherit" });
  }

  if (!fs.existsSync(vsix)) {
    console.error(`No VSIX at ${vsix}`);
    console.error(
      noBuild ? "Drop --no-build to package one first." : "Packaging did not produce it.",
    );
    process.exit(1);
  }

  const found = IDES.map((ide) => ({ ide, cli: resolveCli(ide) })).filter((r) => r.cli !== null);

  if (found.length === 0) {
    console.error("No supported IDE found on this machine — nothing to install into.");
    process.exit(1);
  }

  let failed = 0;
  for (const { ide, cli } of found) {
    const before = installedVersion(cli) ?? "none";
    if (dryRun) {
      console.log(`${ide.name}: would install ${pkg.version} (currently ${before})`);
      continue;
    }
    try {
      run(cli, ["--install-extension", vsix, "--force"]);
    } catch (err) {
      console.error(`${ide.name}: install failed — ${err.message.split("\n")[0]}`);
      failed++;
      continue;
    }
    // Read back rather than trusting the exit code: a sideload can report
    // success and leave the old version in place.
    const after = installedVersion(cli);
    const ok = after === pkg.version;
    if (!ok) failed++;
    console.log(`${ide.name}: ${before} -> ${after ?? "none"} ${ok ? "ok" : "MISMATCH"}`);
  }

  if (dryRun) return;

  if (failed > 0) {
    console.error(`\n${failed} of ${found.length} IDEs did not end up on ${pkg.version}.`);
    process.exit(1);
  }
  console.log(
    `\nAll ${found.length} IDEs on ${pkg.version}. Reload each IDE window to pick it up.`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
