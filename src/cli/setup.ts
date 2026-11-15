/**
 * `penmark setup` and `penmark doctor`.
 *
 * `setup` installs the VSIX into user-selected editors (VS Code, VS Code
 * Insiders, Cursor, Windsurf, Antigravity) and copies `skills/penmark-comments`
 * into `~/.claude/skills/penmark-comments`. Choices are persisted in
 * `~/.config/penmark/setup.json` so subsequent runs update without re-asking
 * unless a newly installed editor is detected or `--reconfigure` is passed.
 *
 * `doctor` is read-only: it reports whether `penmark` is on PATH, the installed
 * extension version in each editor, and whether the loaded skill matches the
 * repository skill or is the older hand-writer.
 */

import { execFileSync } from "node:child_process";
import {
  accessSync,
  constants,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import {
  BackError,
  CancelledError,
  askInOrder,
  confirm,
  multiselect,
  readRawKeyFromStdin,
  select,
  type KeyName,
  type PromptOption,
  type PromptStream,
} from "./prompt.js";

export const EXTENSION_ID = "local.penmark-markdown-review";

export interface IdeSpec {
  name: string;
  command: string;
  fallbacks: string[];
}

export interface SetupChoices {
  editors: Record<string, boolean>;
  skill?: boolean;
}

export interface SetupOptions {
  yes?: boolean;
  defaults?: boolean;
  repair?: boolean;
  dryRun?: boolean;
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
  isTTY?: boolean;
  readKey?: () => KeyName;
  readLine: () => string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  exists: (path: string) => boolean;
  /** True when `path` is a regular file the shell can run. */
  isExecutable: (path: string) => boolean;
  readText: (path: string) => string;
  writeText: (path: string, text: string) => void;
  copyDir: (src: string, dest: string) => void;
  run: (cmd: string, args: string[], cwd?: string) => string;
}

export function defaultIdes(home = homedir(), includeAppFallbacks = true): IdeSpec[] {
  const specs: IdeSpec[] = [
    { name: "VS Code", command: "code", fallbacks: [] },
    { name: "VS Code Insiders", command: "code-insiders", fallbacks: [] },
    { name: "Cursor", command: "cursor", fallbacks: [] },
    { name: "Windsurf", command: "windsurf", fallbacks: [] },
    {
      name: "Antigravity",
      command: "antigravity-ide",
      fallbacks: [
        "/Applications/Antigravity IDE.app/Contents/Resources/app/bin/antigravity-ide",
        join(home, "Applications/Antigravity IDE.app/Contents/Resources/app/bin/antigravity-ide"),
      ],
    },
  ];
  if (!includeAppFallbacks) {
    return specs.map((s) => ({ ...s, fallbacks: [] }));
  }
  return specs;
}

export function lineReaderFromLines(lines: readonly string[]): () => string {
  let index = 0;
  return () => {
    if (index >= lines.length) throw new CancelledError("End of input");
    const line = lines[index] ?? "";
    index += 1;
    return line;
  };
}

// A trailing newline is not an extra blank line. Empty input is no answers.
function splitAnswerLines(text: string): string[] {
  if (text.length === 0) return [];
  const lines = text.split(/\r?\n/);
  if (text.endsWith("\n")) lines.pop();
  return lines;
}

function readNextStdinLine(state: { lines: string[] | null; index: number }): string {
  if (state.lines === null) {
    try {
      state.lines = splitAnswerLines(readFileSync(0, "utf8"));
    } catch {
      state.lines = [];
    }
  }
  if (state.index >= state.lines.length) {
    throw new CancelledError("End of input");
  }
  const line = state.lines[state.index] ?? "";
  state.index += 1;
  return line;
}

function extractCommandFailure(err: unknown, fallback: string): string {
  if (err && typeof err === "object" && "stderr" in err) {
    const rawStderr = (err as { stderr?: unknown }).stderr;
    const stderrText =
      typeof rawStderr === "string"
        ? rawStderr
        : Buffer.isBuffer(rawStderr)
          ? rawStderr.toString("utf8")
          : "";
    const trimmed = stderrText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (trimmed.length > 0) {
      return trimmed.slice(-3).join(" | ");
    }
  }
  if (err instanceof Error) {
    return err.message.split("\n")[0] ?? fallback;
  }
  return fallback;
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
  const isTTY =
    process.env.PENMARK_FORCE_TTY === "1" ||
    Boolean(process.stdin.isTTY && process.stdout.isTTY && process.env.PENMARK_FORCE_TTY !== "0");
  return {
    root,
    version,
    vsixPath: join(root, `penmark-markdown-review-${version}.vsix`),
    skillSourceDir: join(root, "skills", "penmark-comments"),
    skillDestDir: join(skillRoot, "penmark-comments"),
    configPath,
    pathEnv: process.env.PATH ?? "",
    ides: defaultIdes(home, process.env.PENMARK_NO_APP_FALLBACKS !== "1"),
    isTTY,
    readKey: readRawKeyFromStdin,
    readLine: () => readNextStdinLine(stdinState),
    stdout,
    stderr,
    exists: (path) => existsSync(path),
    isExecutable: isExecutableFile,
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
  // A blank line accepts the [Y/n] default. End of input throws before this.
  const trimmed = env.readLine().trim().toLowerCase();
  if (trimmed === "" || trimmed === "y" || trimmed === "yes" || trimmed === "1") return true;
  return false;
}

function reportCancelled(env: SetupEnv): void {
  env.stdout("Cancelled. Nothing was written.\n");
}

function acceptWizard(env: SetupEnv, steps: readonly (() => void)[]): boolean {
  try {
    askInOrder(steps);
    return true;
  } catch (err) {
    if (err instanceof CancelledError || err instanceof BackError) {
      reportCancelled(env);
      return false;
    }
    throw err;
  }
}

function buildWizardSteps(
  env: SetupEnv,
  found: readonly { ide: IdeSpec; cli: string }[],
  foundByName: ReadonlyMap<string, string>,
  choices: SetupChoices,
  promptIo: PromptStream,
): (() => void)[] {
  const steps: (() => void)[] = [];
  if (found.length > 0) {
    const options: PromptOption[] = env.ides.map((ide) => {
      const cli = foundByName.get(ide.name);
      if (cli !== undefined) {
        return {
          label: ide.name,
          consequence: "install VSIX extension",
          available: true,
        };
      }
      return {
        label: ide.name,
        consequence: "not found on this machine",
        available: false,
      };
    });
    let selectedIndices = env.ides
      .map((ide, idx) => ({ ide, idx }))
      .filter(({ ide }) => foundByName.has(ide.name) && (choices.editors[ide.name] ?? true))
      .map(({ idx }) => idx);

    steps.push(() => {
      selectedIndices = multiselect(
        "Which editors should receive the Penmark extension?",
        options,
        selectedIndices,
        promptIo,
      );
      const chosenSet = new Set(selectedIndices);
      for (let i = 0; i < env.ides.length; i++) {
        const ide = env.ides[i]!;
        if (foundByName.has(ide.name)) {
          choices.editors[ide.name] = chosenSet.has(i);
        }
      }
    });
  }

  let skillDefault = choices.skill ?? true;
  steps.push(() => {
    skillDefault = confirm(
      "Install the penmark-comments agent skill?",
      skillDefault,
      promptIo,
      `install into ${env.skillDestDir}`,
      "skip skill installation",
    );
    choices.skill = skillDefault;
  });
  return steps;
}

function promptInteractiveChoices(
  env: SetupEnv,
  found: readonly { ide: IdeSpec; cli: string }[],
  choices: SetupChoices,
  repair: boolean,
): boolean {
  const promptIo: PromptStream = {
    isTTY: true,
    utf8: true,
    readKey: env.readKey ?? readRawKeyFromStdin,
    readLine: env.readLine,
    write: env.stdout,
  };
  const foundByName = new Map(found.map((entry) => [entry.ide.name, entry.cli]));
  const hasSavedConfig =
    env.exists(env.configPath) &&
    (Object.keys(choices.editors).length > 0 || choices.skill !== undefined);
  const unconfiguredFound = found.filter(({ ide }) => choices.editors[ide.name] === undefined);

  if (!hasSavedConfig) {
    env.stdout(`Penmark ${env.version} — setup\n\n`);
    const steps = buildWizardSteps(env, found, foundByName, choices, promptIo);
    return acceptWizard(env, steps);
  }

  // When a newly installed editor appears on a configured machine, ask only for that editor.
  if (unconfiguredFound.length > 0 || choices.skill === undefined) {
    const steps: (() => void)[] = [];
    for (const { ide } of unconfiguredFound) {
      let defaultYes = true;
      steps.push(() => {
        defaultYes = confirm(
          `Install the Penmark extension in ${ide.name}?`,
          defaultYes,
          promptIo,
          "install extension",
          `skip ${ide.name}`,
        );
        choices.editors[ide.name] = defaultYes;
      });
    }
    if (choices.skill === undefined) {
      let skillDefault = true;
      steps.push(() => {
        skillDefault = confirm(
          "Install the penmark-comments agent skill?",
          skillDefault,
          promptIo,
          `install into ${env.skillDestDir}`,
          "skip skill installation",
        );
        choices.skill = skillDefault;
      });
    }
    return acceptWizard(env, steps);
  }

  if (repair) {
    return true;
  }

  // CopyDesk rerun fork when configuration already exists and no new editor appeared:
  const forkOptions: PromptOption[] = [
    {
      label: "Change settings",
      consequence: "pick editors and skill again",
      available: true,
    },
    {
      label: "Repair the install",
      consequence: "reinstall extension and skill with saved choices",
      available: true,
    },
  ];
  let forkChoice = 0;
  const askFork = () => {
    forkChoice = select(
      "Penmark is already installed. Choose an action:",
      forkOptions,
      forkChoice,
      promptIo,
    );
  };
  const askChangeSettings = () => {
    if (forkChoice !== 0) {
      return;
    }
    askInOrder(buildWizardSteps(env, found, foundByName, choices, promptIo));
  };

  return acceptWizard(env, [askFork, askChangeSettings]);
}

export function runSetup(env: SetupEnv, options: SetupOptions = {}): number {
  const choices = readChoices(env);
  const found: { ide: IdeSpec; cli: string }[] = [];
  for (const ide of env.ides) {
    const cli = resolveEditorCli(ide, env.run);
    if (cli !== null) found.push({ ide, cli });
  }

  const assumeDefaults = Boolean(options.yes || options.defaults);
  const repair = Boolean(options.repair);
  const dryRun = Boolean(options.dryRun);

  if (assumeDefaults) {
    for (const { ide } of found) {
      if (choices.editors[ide.name] === undefined) {
        choices.editors[ide.name] = true;
      }
    }
    if (choices.skill === undefined) {
      choices.skill = true;
    }
  } else if (env.isTTY) {
    const ok = promptInteractiveChoices(env, found, choices, repair);
    if (!ok) {
      return 0;
    }
  } else {
    try {
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
    } catch (err) {
      if (err instanceof CancelledError) {
        reportCancelled(env);
        return 0;
      }
      throw err;
    }
  }

  const selectedEditors = found.filter(({ ide }) => choices.editors[ide.name] === true);

  if (dryRun) {
    env.stdout(`Penmark ${env.version} (dry run)\n\n`);
    env.stdout("Command\n");
    env.stdout(`  penmark ${env.version}\n\n`);
    env.stdout("Editors\n");
    if (found.length === 0) {
      env.stdout("  editors: none found\n\n");
    } else {
      for (const { ide } of found) {
        const action = choices.editors[ide.name] === true ? "would install" : "skipped";
        env.stdout(`  ${ide.name}: ${action}\n`);
      }
      env.stdout("\n");
    }
    env.stdout("Skill\n");
    env.stdout(`  skill: ${choices.skill ? `would install (${env.skillDestDir})` : "skipped"}\n`);
    return 0;
  }

  writeChoices(env, choices);

  let failed = 0;

  if (selectedEditors.length > 0) {
    if (!env.exists(env.vsixPath)) {
      try {
        env.run("npm", ["run", "package"], env.root);
      } catch (err) {
        const msg = extractCommandFailure(err, "package failed");
        env.stderr(`Packaging failed: ${msg}\n`);
        return 1;
      }
    }
    if (!env.exists(env.vsixPath)) {
      env.stderr(`No VSIX at ${env.vsixPath}\n`);
      return 1;
    }
  }

  env.stdout(`Penmark ${env.version}\n\n`);
  env.stdout("Command\n");
  env.stdout(`  penmark ${env.version}\n\n`);
  env.stdout("Editors\n");

  if (found.length === 0) {
    env.stdout("  editors: none found\n\n");
  } else {
    for (const { ide, cli } of found) {
      if (choices.editors[ide.name] !== true) {
        const current = readInstalledVersion(cli, env.run) ?? "not installed";
        env.stdout(`  ${ide.name}: ${current} (skipped)\n`);
        continue;
      }
      const before = readInstalledVersion(cli, env.run) ?? "none";
      try {
        env.run(cli, ["--install-extension", env.vsixPath, "--force"]);
      } catch (err) {
        const msg = extractCommandFailure(err, "install failed");
        env.stderr(`${ide.name}: install failed — ${msg}\n`);
        failed += 1;
        continue;
      }
      const after = readInstalledVersion(cli, env.run);
      const ok = after === env.version;
      if (!ok) failed += 1;
      env.stdout(`  ${ide.name}: ${before} -> ${after ?? "none"} ${ok ? "ok" : "MISMATCH"}\n`);
    }
    env.stdout("\n");
  }

  env.stdout("Skill\n");
  if (choices.skill) {
    if (!env.exists(env.skillSourceDir)) {
      env.stderr(`Skill source missing at ${env.skillSourceDir}\n`);
      return 1;
    }
    env.copyDir(env.skillSourceDir, env.skillDestDir);
    env.stdout(`  skill: ${env.skillDestDir}\n`);
  } else {
    env.stdout("  skill: skipped\n");
  }

  if (failed > 0) {
    env.stderr(
      `${failed} of ${selectedEditors.length} editors did not end up on ${env.version}.\n`,
    );
    return 1;
  }

  if (selectedEditors.length > 0) {
    env.stdout("\nReload each editor window to pick up the extension.\n");
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

const WINDOWS_PATHEXT = ".COM;.EXE;.BAT;.CMD";

/**
 * Names a shell tries for `command`. Windows walks PATHEXT. A PATHEXT entry of
 * `.` is the bare name. Other platforms use the name as given.
 */
export function commandFileNames(
  command: string,
  platform: NodeJS.Platform = process.platform,
  pathExt?: string,
): string[] {
  if (platform !== "win32") return [command];
  const raw = pathExt === undefined ? process.env.PATHEXT : pathExt;
  const source = raw === undefined || raw.trim() === "" ? WINDOWS_PATHEXT : raw;
  const exts = source
    .split(";")
    .map((ext) => ext.trim())
    .filter((ext) => ext !== "")
    .map((ext) => (ext === "." || ext.startsWith(".") ? ext : `.${ext}`));
  const lower = command.toLowerCase();
  if (exts.some((ext) => ext !== "." && lower.endsWith(ext.toLowerCase()))) return [command];
  return exts.map((ext) => (ext === "." ? command : command + ext));
}

/** Regular file the current process may execute. A directory is not a command. */
export function isExecutableFile(filePath: string): boolean {
  try {
    if (!statSync(filePath).isFile()) return false;
    // Node's X_OK does not distinguish programs on Windows. PATHEXT does.
    if (process.platform === "win32") return true;
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** First runnable `penmark` on PATH. `platform` and `pathExt` default to this process. */
export function findCommandOnPath(
  env: SetupEnv,
  platform: NodeJS.Platform = process.platform,
  pathExt?: string,
): string | null {
  for (const entry of env.pathEnv.split(delimiter)) {
    if (entry === "") continue;
    for (const name of commandFileNames("penmark", platform, pathExt)) {
      const candidate = resolve(entry, name);
      if (env.isExecutable(candidate)) return candidate;
    }
  }
  return null;
}

export function runDoctor(env: SetupEnv): number {
  env.stdout(`Penmark ${env.version}\n\n`);
  env.stdout("Command\n");
  const onPath = findCommandOnPath(env);
  if (onPath !== null) {
    env.stdout(`  command: on PATH (${onPath}, penmark ${env.version})\n\n`);
  } else {
    env.stdout(`  command: not on PATH (penmark ${env.version})\n\n`);
  }

  env.stdout("Editors\n");
  let anyEditor = false;
  for (const ide of env.ides) {
    const cli = resolveEditorCli(ide, env.run);
    if (cli === null) continue;
    anyEditor = true;
    const installed = readInstalledVersion(cli, env.run);
    env.stdout(`  ${ide.name}: ${installed ?? "not installed"}\n`);
  }
  if (!anyEditor) {
    env.stdout("  editors: none found\n");
  }
  env.stdout("\n");

  env.stdout("Skill\n");
  const skill = inspectSkill(env);
  if (skill.kind === "current") {
    env.stdout(`  skill: current (${skill.path})\n`);
    return 0;
  }
  if (skill.kind === "old-hand-writer") {
    env.stdout(
      `  skill: warning — old hand-writer loaded at ${skill.path} (mints markers by hand; run penmark setup)\n`,
    );
    return 1;
  }
  if (skill.kind === "modified") {
    env.stdout(
      `  skill: warning — differs from repository skill at ${skill.path} (run penmark setup)\n`,
    );
    return 1;
  }
  env.stdout(`  skill: not installed (${skill.path})\n`);
  return 0;
}
