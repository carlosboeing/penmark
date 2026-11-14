/**
 * `penmark setup` and `penmark doctor`.
 *
 * `setup` asks which found editors get the VSIX, asks whether to copy the
 * `penmark-comments` skill into the harness skill directory, saves those
 * choices so the next run only asks about a newly found editor, packages and
 * sideloads into the chosen editors, copies the skill when accepted, and
 * prints the command version, each editor's version, where the skill went, and
 * that each editor window needs a reload.
 *
 * `doctor` changes nothing. It reports whether `penmark` is on `PATH`, the
 * extension version in each editor, and whether the loaded skill is the
 * repository's current skill or the old hand-writer.
 */

import { execFileSync } from "node:child_process";
import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";

const EXTENSION_ID = "local.penmark-markdown-review";

export interface IdeSpec {
  name: string;
  command: string;
  fallbacks: string[];
}

export function defaultIdes(home = homedir(), includeAppFallbacks = true): IdeSpec[] {
  return [
    { name: "VS Code", command: "code", fallbacks: [] },
    { name: "VS Code Insiders", command: "code-insiders", fallbacks: [] },
    { name: "Cursor", command: "cursor", fallbacks: [] },
    { name: "Windsurf", command: "windsurf", fallbacks: [] },
    {
      name: "Antigravity",
      command: "antigravity-ide",
      fallbacks: [
        ...(includeAppFallbacks
          ? ["/Applications/Antigravity IDE.app/Contents/Resources/app/bin/antigravity-ide"]
          : []),
        join(home, "Applications/Antigravity IDE.app/Contents/Resources/app/bin/antigravity-ide"),
      ],
    },
  ];
}

export interface SetupChoices {
  editors: Record<string, boolean>;
  skill?: boolean;
}

export interface SetupEnv {
  root: string;
  version: string;
  vsixPath: string;
  skillSourceDir: string;
  skillDestDir: string;
  configPath: string;
  pathEnv: string;
  ides: IdeSpec[];
  readLine(): string;
  stdout(text: string): void;
  stderr(text: string): void;
  exists(path: string): boolean;
  readText(path: string): string;
  writeText(path: string, text: string): void;
  copyDir(src: string, dest: string): void;
  run(cmd: string, args: string[], cwd?: string): string;
}

export function lineReaderFromLines(lines: string[]): () => string {
  let index = 0;
  return () => {
    const val = lines[index] ?? "";
    index += 1;
    return val;
  };
}

function readNextStdinLine(state: { lines: string[] | null; index: number }): string {
  if (!process.stdin.isTTY) {
    if (state.lines === null) {
      try {
        const text = readFileSync(0, "utf8");
        state.lines = text === "" ? [] : text.replace(/\r\n/g, "\n").split("\n");
      } catch {
        state.lines = [];
      }
    }
    const line = state.lines[state.index] ?? "";
    state.index += 1;
    return line;
  }
  let fd = 0;
  let closeFd = false;
  try {
    fd = openSync("/dev/tty", "r");
    closeFd = true;
  } catch {
    // Use standard input (fd 0).
  }
  const bytes: number[] = [];
  const buf = Buffer.alloc(1);
  try {
    while (true) {
      const n = readSync(fd, buf, 0, 1, null);
      if (n <= 0) break;
      const b = buf[0] ?? 0;
      if (b === 0x0a) break;
      if (b !== 0x0d) bytes.push(b);
    }
  } catch {
    // End of input.
  } finally {
    if (closeFd) {
      try {
        closeSync(fd);
      } catch {
        // Ignore close errors.
      }
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

export function defaultSetupEnv(
  root: string,
  version: string,
  stdout: (text: string) => void,
  stderr: (text: string) => void,
): SetupEnv {
  const home = process.env.HOME && process.env.HOME !== "" ? process.env.HOME : homedir();
  const xdg =
    process.env.XDG_CONFIG_HOME && process.env.XDG_CONFIG_HOME !== ""
      ? process.env.XDG_CONFIG_HOME
      : join(home, ".config");
  const skillRoot =
    process.env.PENMARK_SKILLS_DIR && process.env.PENMARK_SKILLS_DIR !== ""
      ? process.env.PENMARK_SKILLS_DIR
      : join(home, ".claude", "skills");
  const configPath =
    process.env.PENMARK_SETUP_CONFIG && process.env.PENMARK_SETUP_CONFIG !== ""
      ? process.env.PENMARK_SETUP_CONFIG
      : join(xdg, "penmark", "setup.json");
  const stdinState = { lines: null as string[] | null, index: 0 };
  return {
    root,
    version,
    vsixPath: join(root, `penmark-markdown-review-${version}.vsix`),
    skillSourceDir: join(root, "skills", "penmark-comments"),
    skillDestDir: join(skillRoot, "penmark-comments"),
    configPath,
    pathEnv: process.env.PATH ?? "",
    ides: defaultIdes(home, process.env.PENMARK_NO_APP_FALLBACKS !== "1"),
    readLine: () => readNextStdinLine(stdinState),
    stdout,
    stderr,
    exists: (path) => existsSync(path),
    readText: (path) => readFileSync(path, "utf8"),
    writeText: (path, text) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text, "utf8");
    },
    copyDir: (src, dest) => {
      mkdirSync(dirname(dest), { recursive: true });
      rmSync(dest, { recursive: true, force: true });
      cpSync(src, dest, { recursive: true });
    },
    run: (cmd, args, cwd) =>
      execFileSync(cmd, args, {
        encoding: "utf8",
        stdio: "pipe",
        ...(cwd !== undefined ? { cwd } : {}),
      }),
  };
}

export function resolveEditorCli(ide: IdeSpec, run: SetupEnv["run"]): string | null {
  for (const candidate of [ide.command, ...ide.fallbacks]) {
    try {
      run(candidate, ["--version"]);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

export function readInstalledVersion(cli: string, run: SetupEnv["run"]): string | null {
  let out: string;
  try {
    out = run(cli, ["--list-extensions", "--show-versions"]);
  } catch {
    return null;
  }
  const line = out.split(/\r?\n/).find((l) => l.startsWith(`${EXTENSION_ID}@`));
  return line ? line.slice(EXTENSION_ID.length + 1).trim() : null;
}

function readChoices(env: SetupEnv): SetupChoices {
  if (!env.exists(env.configPath)) return { editors: {} };
  try {
    const raw = JSON.parse(env.readText(env.configPath)) as unknown;
    if (raw === null || typeof raw !== "object") return { editors: {} };
    const rec = raw as Record<string, unknown>;
    const editors: Record<string, boolean> = {};
    if (rec.editors !== null && typeof rec.editors === "object") {
      for (const [k, v] of Object.entries(rec.editors as Record<string, unknown>)) {
        if (typeof v === "boolean") editors[k] = v;
      }
    }
    const skill = typeof rec.skill === "boolean" ? rec.skill : undefined;
    return skill === undefined ? { editors } : { editors, skill };
  } catch {
    return { editors: {} };
  }
}

function writeChoices(env: SetupEnv, choices: SetupChoices): void {
  env.writeText(env.configPath, JSON.stringify(choices, null, 2) + "\n");
}

function askYesNo(prompt: string, env: SetupEnv): boolean {
  env.stdout(prompt);
  const trimmed = env.readLine().trim().toLowerCase();
  if (trimmed === "" || trimmed === "y" || trimmed === "yes") return true;
  return false;
}

export function runSetup(env: SetupEnv): number {
  const choices = readChoices(env);
  const found: { ide: IdeSpec; cli: string }[] = [];
  for (const ide of env.ides) {
    const cli = resolveEditorCli(ide, env.run);
    if (cli !== null) found.push({ ide, cli });
  }

  for (const { ide } of found) {
    if (choices.editors[ide.name] === undefined) {
      choices.editors[ide.name] = askYesNo(
        `Install the Penmark extension in ${ide.name}? [Y/n] `,
        env,
      );
    }
  }
  if (choices.skill === undefined) {
    choices.skill = askYesNo(
      `Install the penmark-comments skill in ${env.skillDestDir}? [Y/n] `,
      env,
    );
  }

  writeChoices(env, choices);

  const selectedEditors = found.filter(({ ide }) => choices.editors[ide.name] === true);
  let failed = 0;

  if (selectedEditors.length > 0) {
    if (!env.exists(env.vsixPath)) {
      try {
        env.run("npm", ["run", "package"], env.root);
      } catch (err) {
        const msg = err instanceof Error ? err.message.split("\n")[0] : "package failed";
        env.stderr(`Packaging failed: ${msg}\n`);
        return 1;
      }
    }
    if (!env.exists(env.vsixPath)) {
      env.stderr(`No VSIX at ${env.vsixPath}\n`);
      return 1;
    }
  }

  env.stdout(`penmark ${env.version}\n`);

  if (found.length === 0) {
    env.stdout("editors: none found\n");
  } else {
    for (const { ide, cli } of found) {
      if (choices.editors[ide.name] !== true) {
        const current = readInstalledVersion(cli, env.run) ?? "not installed";
        env.stdout(`${ide.name}: ${current} (skipped)\n`);
        continue;
      }
      const before = readInstalledVersion(cli, env.run) ?? "none";
      try {
        env.run(cli, ["--install-extension", env.vsixPath, "--force"]);
      } catch (err) {
        const msg = err instanceof Error ? err.message.split("\n")[0] : "install failed";
        env.stderr(`${ide.name}: install failed — ${msg}\n`);
        failed += 1;
        continue;
      }
      const after = readInstalledVersion(cli, env.run);
      const ok = after === env.version;
      if (!ok) failed += 1;
      env.stdout(`${ide.name}: ${before} -> ${after ?? "none"} ${ok ? "ok" : "MISMATCH"}\n`);
    }
  }

  if (choices.skill) {
    if (!env.exists(env.skillSourceDir)) {
      env.stderr(`Skill source missing at ${env.skillSourceDir}\n`);
      return 1;
    }
    env.copyDir(env.skillSourceDir, env.skillDestDir);
    env.stdout(`skill: ${env.skillDestDir}\n`);
  } else {
    env.stdout(`skill: skipped\n`);
  }

  if (failed > 0) {
    env.stderr(
      `${failed} of ${selectedEditors.length} editors did not end up on ${env.version}.\n`,
    );
    return 1;
  }

  if (selectedEditors.length > 0) {
    env.stdout("Reload each editor window to pick up the extension.\n");
  }
  return 0;
}

export type SkillState =
  | { kind: "current"; path: string }
  | { kind: "old-hand-writer"; path: string }
  | { kind: "modified"; path: string }
  | { kind: "missing"; path: string };

export function inspectSkill(env: SetupEnv): SkillState {
  const installedSkillMd = join(env.skillDestDir, "SKILL.md");
  const repoSkillMd = join(env.skillSourceDir, "SKILL.md");
  if (!env.exists(installedSkillMd)) {
    return { kind: "missing", path: env.skillDestDir };
  }
  const installed = env.readText(installedSkillMd);
  const oldValidator = join(env.skillDestDir, "scripts", "validate-penmark-comments.mjs");
  const oldContract = join(env.skillDestDir, "references", "penmark-agent-contract-v1.md");
  if (
    env.exists(oldValidator) ||
    env.exists(oldContract) ||
    installed.includes("validate-penmark-comments.mjs") ||
    installed.includes("penmark-agent-contract-v1.md") ||
    installed.includes("Generate unique valid IDs")
  ) {
    return { kind: "old-hand-writer", path: env.skillDestDir };
  }
  if (env.exists(repoSkillMd) && installed === env.readText(repoSkillMd)) {
    return { kind: "current", path: env.skillDestDir };
  }
  return { kind: "modified", path: env.skillDestDir };
}

export function findCommandOnPath(env: SetupEnv): string | null {
  for (const entry of env.pathEnv.split(delimiter)) {
    if (entry === "") continue;
    const candidate = resolve(entry, "penmark");
    if (env.exists(candidate)) return candidate;
  }
  return null;
}

export function runDoctor(env: SetupEnv): number {
  const onPath = findCommandOnPath(env);
  if (onPath !== null) {
    env.stdout(`command: on PATH (${onPath}, penmark ${env.version})\n`);
  } else {
    env.stdout(`command: not on PATH (penmark ${env.version})\n`);
  }

  let anyEditor = false;
  for (const ide of env.ides) {
    const cli = resolveEditorCli(ide, env.run);
    if (cli === null) continue;
    anyEditor = true;
    const installed = readInstalledVersion(cli, env.run);
    env.stdout(`${ide.name}: ${installed ?? "not installed"}\n`);
  }
  if (!anyEditor) {
    env.stdout("editors: none found\n");
  }

  const skill = inspectSkill(env);
  if (skill.kind === "current") {
    env.stdout(`skill: current (${skill.path})\n`);
    return 0;
  }
  if (skill.kind === "old-hand-writer") {
    env.stdout(
      `skill: warning — old hand-writer loaded at ${skill.path} (mints markers by hand; run penmark setup)\n`,
    );
    return 1;
  }
  if (skill.kind === "modified") {
    env.stdout(
      `skill: warning — differs from repository skill at ${skill.path} (run penmark setup)\n`,
    );
    return 1;
  }
  env.stdout(`skill: not installed (${skill.path})\n`);
  return 0;
}
