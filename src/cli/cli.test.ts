import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BackError,
  CancelledError,
  askInOrder,
  decodeKeyChunk,
  decodeKeyReads,
  keyBar,
  multiselect,
  select,
  type KeyName,
  type PromptOption,
  type PromptStream,
} from "./prompt.js";
import { run, type Io } from "./run.js";
import {
  commandFileNames,
  commandSpawn,
  defaultIdes,
  findCommandOnPath,
  isExecutableFile,
  lineReaderFromLines,
  resolveCommandFile,
  resolveEditorCli,
  runDoctor,
  runFile,
  type IdeSpec,
  type SetupEnv,
} from "./setup.js";

const ROOT = join(__dirname, "../..");
const TSX = join(ROOT, "node_modules/.bin/tsx");
const MAIN = join(ROOT, "src/cli/main.ts");
/** U+FEFF, built from its code so no invisible character sits in this file. */
const BOM = String.fromCharCode(0xfeff);
const BOM_BYTES = [0xef, 0xbb, 0xbf];
const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "penmark-cli-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function penmark(args: string[], input?: string | Uint8Array, env?: NodeJS.ProcessEnv) {
  return spawnSync(TSX, [MAIN, ...args], {
    input,
    encoding: "utf8",
    cwd: ROOT,
    env: { ...process.env, ...env },
  });
}

function write(dir: string, name: string, text: string): string {
  const path = join(dir, name);
  writeFileSync(path, text);
  return path;
}

describe("penmark process", () => {
  it("places a unique quote and reports wrote", () => {
    const dir = tempDir();
    const file = write(dir, "note.md", "The eventual consistency model waits.\n");
    const result = penmark(
      ["comment", "apply", "--file", file, "--author", "Ada"],
      JSON.stringify({
        findings: [{ quote: "eventual consistency", body: "Name the failure mode." }],
      }),
    );
    expect(result.status).toBe(0);
    const body = JSON.parse(result.stdout);
    expect(body.wrote).toBe(true);
    expect(body.dryRun).toBe(false);
    expect(body.results[0].action).toBe("placed");
    expect(readFileSync(file, "utf8")).toContain("<!--pmk:s");
  });

  it("replies on a second note and does not add a marker", () => {
    const dir = tempDir();
    const file = write(dir, "note.md", "The eventual consistency model waits.\n");
    const input = (body: string) =>
      JSON.stringify({ findings: [{ quote: "eventual consistency", body }] });
    penmark(
      ["comment", "apply", "--file", file, "--author", "Ada"],
      input("Name the failure mode."),
    );
    const before = readFileSync(file, "utf8");
    const markers = before.match(/<!--pmk:s/g)?.length ?? 0;
    const result = penmark(
      ["comment", "apply", "--file", file, "--author", "Ada"],
      input("Say what happens on timeout."),
    );
    expect(result.status).toBe(0);
    const body = JSON.parse(result.stdout);
    expect(body.wrote).toBe(true);
    expect(body.results[0].action).toBe("replied");
    const after = readFileSync(file, "utf8");
    expect(after.match(/<!--pmk:s/g)?.length).toBe(markers);
    expect(after).toContain(" re ");
  });

  it("rejects an author that would break the review entry", () => {
    const dir = tempDir();
    const file = write(dir, "note.md", "The eventual consistency model waits.\n");
    const before = readFileSync(file);
    const input = JSON.stringify({
      findings: [{ quote: "eventual consistency", body: "Name the failure mode." }],
    });
    for (const author of ["Ada\nBob", "Ada--Bob"]) {
      const result = penmark(["comment", "apply", "--file", file, "--author", author], input);
      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout).error).toBe("bad author");
      expect(readFileSync(file)).toEqual(before);
    }
  });

  it("skips a repeated body and leaves the file bytes unchanged", () => {
    const dir = tempDir();
    const file = write(dir, "note.md", "The eventual consistency model waits.\n");
    const input = JSON.stringify({
      findings: [{ quote: "eventual consistency", body: "Name the failure mode." }],
    });
    penmark(["comment", "apply", "--file", file, "--author", "Ada"], input);
    const before = readFileSync(file);
    const result = penmark(["comment", "apply", "--file", file, "--author", "Ada"], input);
    expect(result.status).toBe(0);
    const body = JSON.parse(result.stdout);
    expect(body.wrote).toBe(false);
    expect(body.results[0].action).toBe("skipped");
    expect(readFileSync(file)).toEqual(before);
  });

  it("refuses two passages and locate lists both", () => {
    const dir = tempDir();
    const file = write(
      dir,
      "note.md",
      "See eventual consistency early.\n\nSee eventual consistency later.\n",
    );
    const before = readFileSync(file);
    const result = penmark(
      ["comment", "apply", "--file", file, "--author", "Ada"],
      JSON.stringify({ findings: [{ quote: "eventual consistency", body: "Which one?" }] }),
    );
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout).results[0].reason).toBe("ambiguous-quote");
    expect(readFileSync(file)).toEqual(before);
    const located = penmark([
      "comment",
      "locate",
      "--file",
      file,
      "--quote",
      "eventual consistency",
    ]);
    expect(located.status).toBe(0);
    expect(JSON.parse(located.stdout).matches).toHaveLength(2);
  });

  it("refuses a missing quote and an uncommentable range without writing", () => {
    const dir = tempDir();
    const file = write(dir, "note.md", "---\ntitle: secret\n---\n\nBody paragraph.\n");
    const before = readFileSync(file);
    const missing = penmark(
      ["comment", "apply", "--file", file, "--author", "Ada"],
      JSON.stringify({ findings: [{ quote: "not in file", body: "No." }] }),
    );
    expect(missing.status).toBe(2);
    const text = readFileSync(file, "utf8");
    const start = text.indexOf("title");
    const bad = penmark(
      ["comment", "apply", "--file", file, "--author", "Ada"],
      JSON.stringify({
        findings: [
          { quote: "title: secret", body: "No.", start, end: start + "title: secret".length },
        ],
      }),
    );
    expect(bad.status).toBe(2);
    expect(JSON.parse(bad.stdout).results[0].reason).toBe("uncommentable");
    expect(readFileSync(file)).toEqual(before);
  });

  it("writes nothing when one finding in the batch is rejected", () => {
    const dir = tempDir();
    const file = write(dir, "note.md", "The eventual consistency model waits.\n");
    const before = readFileSync(file);
    const result = penmark(
      ["comment", "apply", "--file", file, "--author", "Ada"],
      JSON.stringify({
        findings: [
          { quote: "eventual consistency", body: "Keep." },
          { quote: "missing phrase", body: "Drop." },
        ],
      }),
    );
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout).wrote).toBe(false);
    expect(readFileSync(file)).toEqual(before);
  });

  it("dry-run reports the plan and does not touch the file", () => {
    const dir = tempDir();
    const file = write(dir, "note.md", "The eventual consistency model waits.\n");
    const before = readFileSync(file);
    const result = penmark(
      ["comment", "apply", "--file", file, "--author", "Ada", "--dry-run"],
      JSON.stringify({ findings: [{ quote: "eventual consistency", body: "Name it." }] }),
    );
    expect(result.status).toBe(0);
    const body = JSON.parse(result.stdout);
    expect(body.dryRun).toBe(true);
    expect(body.wrote).toBe(false);
    expect(body.results[0].action).toBe("placed");
    expect(readFileSync(file)).toEqual(before);
  });

  it("exits 4 on an unreadable review block for apply and validate", () => {
    const dir = tempDir();
    const file = write(dir, "note.md", "Body.\n\n<!-- pmk:review v2 -->\n<!-- /pmk:review -->\n");
    const before = readFileSync(file);
    const applied = penmark(
      ["comment", "apply", "--file", file, "--author", "Ada"],
      JSON.stringify({ findings: [{ quote: "Body", body: "Note." }] }),
    );
    expect(applied.status).toBe(4);
    const validated = penmark(["validate", "--file", file]);
    expect(validated.status).toBe(4);
    expect(JSON.parse(validated.stdout).ok).toBe(false);
    expect(readFileSync(file)).toEqual(before);
  });

  it("validate succeeds and lists an orphan", () => {
    const dir = tempDir();
    const file = write(
      dir,
      "note.md",
      "No anchor left.\n\n<!-- pmk:review v1 -->\n" +
        "<!--pmk:c aaaaaaaa\nAda (human) · 2026-11-13 12:00:00 +00:00\n> missing\n\nOrphan note.\n-->\n" +
        "<!-- /pmk:review -->\n",
    );
    const result = penmark(["validate", "--file", file]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ ok: true, orphans: ["aaaaaaaa"] });
  });

  it("resolve removes a root and its reply, and a reply alone leaves the root", () => {
    const dir = tempDir();
    const file = write(dir, "note.md", "The eventual consistency model waits.\n");
    const input = (body: string) =>
      JSON.stringify({ findings: [{ quote: "eventual consistency", body }] });
    const placed = penmark(["comment", "apply", "--file", file, "--author", "Ada"], input("Root."));
    const rootId = JSON.parse(placed.stdout).results[0].id as string;
    const replied = penmark(
      ["comment", "apply", "--file", file, "--author", "Ada"],
      input("Reply."),
    );
    const replyId = JSON.parse(replied.stdout).results[0].id as string;
    const onlyReply = penmark(["resolve", "--file", file, replyId]);
    expect(onlyReply.status).toBe(0);
    expect(JSON.parse(onlyReply.stdout).removed).toEqual([replyId]);
    expect(readFileSync(file, "utf8")).toContain(`<!--pmk:c ${rootId}`);
    penmark(["comment", "apply", "--file", file, "--author", "Ada"], input("Reply again."));
    const rootGone = penmark(["resolve", "--file", file, rootId]);
    expect(rootGone.status).toBe(0);
    expect(JSON.parse(rootGone.stdout).removed).toContain(rootId);
    expect(readFileSync(file, "utf8")).toBe("The eventual consistency model waits.\n");
  });

  it("exits 1 when git has no author and --author is absent", () => {
    const dir = tempDir();
    const file = write(dir, "note.md", "The eventual consistency model waits.\n");
    const before = readFileSync(file);
    const result = penmark(
      ["comment", "apply", "--file", file],
      JSON.stringify({ findings: [{ quote: "eventual consistency", body: "Name it." }] }),
      {
        GIT_CONFIG_GLOBAL: "/nonexistent-penmark-gitconfig",
        GIT_CONFIG_SYSTEM: "/nonexistent-penmark-gitconfig",
        GIT_CONFIG_NOSYSTEM: "1",
        HOME: dir,
      },
    );
    expect(result.status).toBe(1);
    expect(readFileSync(file)).toEqual(before);
  });

  it("exits 1 on invalid UTF-8 and does not write", () => {
    const dir = tempDir();
    const file = write(dir, "note.md", "ok");
    writeFileSync(file, Buffer.from([0xff, 0xfe, 0x61]));
    const before = readFileSync(file);
    const result = penmark(
      ["comment", "apply", "--file", file, "--author", "Ada"],
      JSON.stringify({ findings: [{ quote: "a", body: "b" }] }),
    );
    expect(result.status).toBe(1);
    expect(readFileSync(file)).toEqual(before);
  });

  it("keeps a byte order mark and reads explicit offsets against the file text", () => {
    const dir = tempDir();
    const file = write(
      dir,
      "note.md",
      BOM + "See eventual consistency early.\n\nSee eventual consistency later.\n",
    );
    const before = readFileSync(file);
    expect(Array.from(before.subarray(0, 3))).toEqual(BOM_BYTES);
    // Buffer.toString keeps the mark, so the mark is index 0 of the file text.
    const fileText = before.toString("utf8");
    const start = fileText.lastIndexOf("eventual consistency");

    const located = penmark([
      "comment",
      "locate",
      "--file",
      file,
      "--quote",
      "eventual consistency",
    ]);
    expect(located.status).toBe(0);
    const matches = JSON.parse(located.stdout).matches as { start: number; end: number }[];
    expect(matches.map((m) => fileText.slice(m.start, m.end))).toEqual([
      "eventual consistency",
      "eventual consistency",
    ]);
    expect(matches[1]?.start).toBe(start);

    const result = penmark(
      ["comment", "apply", "--file", file, "--author", "Ada"],
      JSON.stringify({
        findings: [
          {
            quote: "eventual consistency",
            body: "Name the bound.",
            start,
            end: start + "eventual consistency".length,
          },
        ],
      }),
    );
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).results[0].action).toBe("placed");
    const after = readFileSync(file);
    expect(Array.from(after.subarray(0, 3))).toEqual(BOM_BYTES);
    expect(after.subarray(3).toString("utf8")).toMatch(
      /^See eventual consistency early\.\n\nSee <!--pmk:s [a-z2-7]{8}-->eventual consistency<!--\/pmk:s [a-z2-7]{8}--> later\.\n/,
    );
  });

  it("lists ambiguous matches as file-text offsets behind a byte order mark", () => {
    const dir = tempDir();
    const file = write(
      dir,
      "note.md",
      BOM + "See eventual consistency early.\n\nSee eventual consistency later.\n",
    );
    const before = readFileSync(file);
    const fileText = before.toString("utf8");
    const result = penmark(
      ["comment", "apply", "--file", file, "--author", "Ada"],
      JSON.stringify({ findings: [{ quote: "eventual consistency", body: "Which one?" }] }),
    );
    expect(result.status).toBe(2);
    const rejected = JSON.parse(result.stdout).results[0] as {
      reason: string;
      matches: { start: number; end: number }[];
    };
    expect(rejected.reason).toBe("ambiguous-quote");
    expect(rejected.matches.map((m) => fileText.slice(m.start, m.end))).toEqual([
      "eventual consistency",
      "eventual consistency",
    ]);
    expect(readFileSync(file)).toEqual(before);
  });

  it("refuses a frontmatter range behind a byte order mark", () => {
    const dir = tempDir();
    const file = write(dir, "note.md", BOM + "---\ntitle: secret\n---\n\nBody paragraph.\n");
    const before = readFileSync(file);
    const start = before.toString("utf8").indexOf("title: secret");
    const result = penmark(
      ["comment", "apply", "--file", file, "--author", "Ada"],
      JSON.stringify({
        findings: [
          { quote: "title: secret", body: "No.", start, end: start + "title: secret".length },
        ],
      }),
    );
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout).results[0].reason).toBe("uncommentable");
    expect(readFileSync(file)).toEqual(before);
  });

  it("resolve leaves the byte order mark in place", () => {
    const dir = tempDir();
    const file = write(dir, "note.md", BOM + "The eventual consistency model waits.\n");
    const before = readFileSync(file);
    const placed = penmark(
      ["comment", "apply", "--file", file, "--author", "Ada"],
      JSON.stringify({ findings: [{ quote: "eventual consistency", body: "Name it." }] }),
    );
    expect(placed.status).toBe(0);
    expect(Array.from(readFileSync(file).subarray(0, 3))).toEqual(BOM_BYTES);
    const id = JSON.parse(placed.stdout).results[0].id as string;
    const resolved = penmark(["resolve", "--file", file, id]);
    expect(resolved.status).toBe(0);
    expect(readFileSync(file)).toEqual(before);
  });

  it("exits 3 when the bytes change after the read", () => {
    const file = "/tmp/penmark-does-not-need-to-exist.md";
    const first = Buffer.from("The eventual consistency model waits.\n");
    const second = Buffer.from("The eventual consistency model waits.\nEdited.\n");
    let reads = 0;
    let written = "";
    const io: Io = {
      read: () => {
        reads += 1;
        return reads === 1 ? first : second;
      },
      write: (_path, text) => {
        written = text;
      },
      stdin: () =>
        JSON.stringify({ findings: [{ quote: "eventual consistency", body: "Name it." }] }),
      stdout: () => {},
      stderr: () => {},
      gitAuthor: () => "Ada",
      now: () => "2026-11-13 12:00:00 +00:00",
    };
    const code = run(["comment", "apply", "--file", file, "--author", "Ada"], io);
    expect(code).toBe(3);
    expect(written).toBe("");
  });

  it("writes a result larger than the pipe buffer in full", () => {
    const dir = tempDir();
    // About 300 KB: past the 64 KB pipe buffer, under the 1 MB spawnSync limit.
    const note = Array.from({ length: 12000 }, (_, i) => `Line ${i} of a long note.`).join("\n");
    const file = write(
      dir,
      "note.md",
      "No anchor left.\n\n<!-- pmk:review v1 -->\n" +
        `<!--pmk:c aaaaaaaa\nAda (human) · 2026-11-13 12:00:00 +00:00\n> missing\n\n${note}\n-->\n` +
        "<!-- /pmk:review -->\n",
    );
    const result = penmark(["list", "--file", file]);
    expect(result.status).toBe(0);
    expect(result.stdout.endsWith("\n")).toBe(true);
    expect(JSON.parse(result.stdout).comments[0].body).toBe(note);
  });

  it("prints usage when invoked with no arguments", () => {
    const result = penmark([]);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("penmark — review comments in a markdown file");
    for (const name of [
      "comment apply",
      "comment locate",
      "list",
      "validate",
      "resolve",
      "export-prompt",
      "setup",
      "doctor",
      "version",
    ]) {
      expect(result.stdout).toContain(name);
    }
  });

  it("prints usage for --help, -h, and help", () => {
    for (const args of [
      ["--help"],
      ["-h"],
      ["help"],
      ["comment", "apply", "--help"],
      ["comment", "apply", "--author", "--help"],
      ["setup", "--help"],
      ["doctor", "--help"],
      ["help", "setup"],
      ["help", "doctor"],
    ]) {
      const result = penmark(args);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("USAGE");
      expect(result.stdout).not.toContain("missing value");
    }
    const apply = penmark(["comment", "apply", "--help"]);
    expect(apply.stdout).toContain("penmark comment apply");
    expect(apply.stdout).toContain("findings");
  });

  it("reads -h as an option value rather than a help flag", () => {
    const dir = tempDir();
    const file = write(dir, "note.md", "Use -h for help.\n");
    const located = penmark(["comment", "locate", "--file", file, "--quote", "-h"]);
    expect(located.status).toBe(0);
    expect(located.stdout).not.toContain("USAGE");
    const matches = JSON.parse(located.stdout).matches as { start: number; end: number }[];
    expect(matches.map((m) => [m.start, m.end])).toEqual([[4, 6]]);

    const applied = penmark(
      ["comment", "apply", "--file", file, "--author", "-h"],
      JSON.stringify({ findings: [{ quote: "Use -h", body: "Name the flag." }] }),
    );
    expect(applied.status).toBe(0);
    expect(JSON.parse(applied.stdout).wrote).toBe(true);
    const listed = penmark(["list", "--file", file]);
    expect(JSON.parse(listed.stdout).comments[0].author).toBe("-h");
  });

  it("does not treat a positional after -- as a help flag", () => {
    const dir = tempDir();
    const file = write(dir, "note.md", "Body.\n");
    const result = penmark(["list", "--file", file, "--", "--help"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("unexpected argument: --help");
    expect(result.stderr).not.toContain("USAGE");
  });

  it("prints the version", () => {
    const version = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version as string;
    const result = penmark(["--version"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`penmark ${version}\n`);
  });

  it("prints a usage error for a missing file and an unknown command", () => {
    const missing = penmark(["list"]);
    expect(missing.status).toBe(1);
    expect(missing.stdout).toBe("");
    expect(missing.stderr).toContain("needs --file");
    expect(missing.stderr).toContain("Usage: penmark list --file <path>");

    const unknown = penmark(["frob"]);
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toContain("unknown command: frob");
    expect(unknown.stderr).toContain("penmark --help");
  });

  it("prints the review prompt as text", () => {
    const dir = tempDir();
    const file = write(dir, "note.md", "The eventual consistency model waits.\n");
    penmark(
      ["comment", "apply", "--file", file, "--author", "Ada"],
      JSON.stringify({ findings: [{ quote: "eventual consistency", body: "Name it." }] }),
    );
    const result = penmark(["export-prompt", "--file", file]);
    expect(result.status).toBe(0);
    expect(result.stdout.startsWith("# Penmark review —")).toBe(true);
    expect(result.stdout).toContain("Name it.");
  });

  it("keeps status unused as an unknown command", () => {
    const result = penmark(["status"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unknown command: status");
  });

  it("setup asks for found editors and skill, installs chosen ones, and remembers choices", () => {
    const files = new Map<string, string>();
    const dirsCopied: { src: string; dest: string }[] = [];
    const installed = new Map<string, string>([
      ["code", "0.5.0"],
      ["cursor", "0.5.0"],
    ]);
    let foundIdes: IdeSpec[] = [
      { name: "VS Code", command: "code", fallbacks: [] },
      { name: "Cursor", command: "cursor", fallbacks: [] },
    ];
    const repoSkillPath = "/repo/skills/penmark-comments/SKILL.md";
    files.set("/repo/penmark-markdown-review-0.6.0.vsix", "vsix");
    files.set("/repo/skills/penmark-comments", "dir");
    files.set(repoSkillPath, "# Repo skill\n");

    const runSetupWith = (stdinLines: string[]) => {
      let stdout = "";
      let stderr = "";
      const env: SetupEnv = {
        root: "/repo",
        version: "0.6.0",
        vsixPath: "/repo/penmark-markdown-review-0.6.0.vsix",
        skillSourceDir: "/repo/skills/penmark-comments",
        skillDestDir: "/home/.claude/skills/penmark-comments",
        configPath: "/home/.config/penmark/setup.json",
        pathEnv: "/usr/local/bin",
        ides: foundIdes,
        readLine: lineReaderFromLines(stdinLines),
        stdout: (t) => {
          stdout += t;
        },
        stderr: (t) => {
          stderr += t;
        },
        exists: (p) => files.has(p),
        isExecutable: (p) => files.has(p),
        readText: (p) => files.get(p) ?? "",
        writeText: (p, t) => {
          files.set(p, t);
        },
        copyDir: (src, dest) => {
          dirsCopied.push({ src, dest });
          files.set(join(dest, "SKILL.md"), files.get(repoSkillPath) ?? "");
        },
        run: (cmd, args) => {
          if (args[0] === "--version") {
            if (cmd === "code" || cmd === "cursor" || cmd === "/Applications/Antigravity")
              return "1.105.0";
            throw new Error("not found");
          }
          if (args[0] === "--list-extensions") {
            const ver = installed.get(cmd);
            return ver ? `local.penmark-markdown-review@${ver}\n` : "";
          }
          if (args[0] === "--install-extension") {
            installed.set(cmd, "0.6.0");
            return "installed";
          }
          throw new Error(`unexpected ${cmd}`);
        },
      };
      const io: Io = {
        read: () => Buffer.alloc(0),
        write: () => {},
        stdin: () => "",
        stdout: (t) => {
          stdout += t;
        },
        stderr: (t) => {
          stderr += t;
        },
        gitAuthor: () => null,
        now: () => "",
        setupEnv: () => env,
      };
      const code = run(["setup"], io);
      return { code, stdout, stderr };
    };

    // First run: yes to VS Code, no to Cursor, yes to skill.
    const first = runSetupWith(["y", "n", "y"]);
    expect(first.code).toBe(0);
    expect(first.stderr).toBe("");
    expect(first.stdout).toContain("Install the Penmark extension in VS Code?");
    expect(first.stdout).toContain("Install the Penmark extension in Cursor?");
    expect(first.stdout).toContain(
      "Install the penmark-comments skill in /home/.claude/skills/penmark-comments?",
    );
    expect(first.stdout).toContain("penmark 0.6.0");
    expect(first.stdout).toContain("VS Code: 0.5.0 -> 0.6.0 ok");
    expect(first.stdout).toContain("Cursor: 0.5.0 (skipped)");
    expect(first.stdout).toContain("skill: /home/.claude/skills/penmark-comments");
    expect(first.stdout).toContain("Reload each editor window to pick up the extension.");
    expect(dirsCopied).toEqual([
      { src: "/repo/skills/penmark-comments", dest: "/home/.claude/skills/penmark-comments" },
    ]);

    // Second run with the same editors: asks no questions and updates VS Code + skill.
    const second = runSetupWith([]);
    expect(second.code).toBe(0);
    expect(second.stdout).not.toContain("Install the Penmark extension");
    expect(second.stdout).not.toContain("Install the penmark-comments skill");
    expect(second.stdout).toContain("VS Code: 0.6.0 -> 0.6.0 ok");
    expect(second.stdout).toContain("Cursor: 0.5.0 (skipped)");

    // Third run after Antigravity is installed: asks only about Antigravity.
    foundIdes = [
      ...foundIdes,
      { name: "Antigravity", command: "antigravity-ide", fallbacks: ["/Applications/Antigravity"] },
    ];
    const third = runSetupWith(["y"]);
    expect(third.code).toBe(0);
    expect(third.stdout).not.toContain("Install the Penmark extension in VS Code?");
    expect(third.stdout).not.toContain("Install the Penmark extension in Cursor?");
    expect(third.stdout).not.toContain("Install the penmark-comments skill");
    expect(third.stdout).toContain("Install the Penmark extension in Antigravity?");
    expect(third.stdout).toContain("Antigravity: none -> 0.6.0 ok");
  });

  it("doctor reports PATH, editor versions, and warns on the old hand-writer skill", () => {
    const files = new Map<string, string>();
    const repoSkill = readFileSync(join(ROOT, "skills/penmark-comments/SKILL.md"), "utf8");
    files.set("/repo/skills/penmark-comments/SKILL.md", repoSkill);
    files.set("/usr/local/bin/penmark", "bin");
    files.set(
      "/home/.claude/skills/penmark-comments/SKILL.md",
      "Read references/penmark-agent-contract-v1.md and Generate unique valid IDs.",
    );
    files.set("/home/.claude/skills/penmark-comments/scripts/validate-penmark-comments.mjs", "old");

    const runDoctorOnce = () => {
      let stdout = "";
      let stderr = "";
      const env: SetupEnv = {
        root: "/repo",
        version: "0.6.0",
        vsixPath: "/repo/penmark-markdown-review-0.6.0.vsix",
        skillSourceDir: "/repo/skills/penmark-comments",
        skillDestDir: "/home/.claude/skills/penmark-comments",
        configPath: "/home/.config/penmark/setup.json",
        pathEnv: "/usr/bin:/usr/local/bin",
        ides: defaultIdes("/home"),
        readLine: lineReaderFromLines([]),
        stdout: (t) => {
          stdout += t;
        },
        stderr: (t) => {
          stderr += t;
        },
        exists: (p) => files.has(p),
        isExecutable: (p) => files.has(p),
        readText: (p) => files.get(p) ?? "",
        writeText: () => {
          throw new Error("doctor must not write");
        },
        copyDir: () => {
          throw new Error("doctor must not copy");
        },
        run: (cmd, args) => {
          if (args[0] === "--version") {
            if (cmd === "code" || cmd === "cursor") return "1.105.0";
            throw new Error("not installed");
          }
          if (args[0] === "--list-extensions") {
            if (cmd === "code") return "local.penmark-markdown-review@0.6.0\n";
            return "";
          }
          throw new Error("doctor must not install");
        },
      };
      const io: Io = {
        read: () => Buffer.alloc(0),
        write: () => {},
        stdin: () => "",
        stdout: (t) => {
          stdout += t;
        },
        stderr: (t) => {
          stderr += t;
        },
        gitAuthor: () => null,
        now: () => "",
        setupEnv: () => env,
      };
      const code = run(["doctor"], io);
      return { code, stdout, stderr };
    };

    const oldResult = runDoctorOnce();
    expect(oldResult.code).toBe(1);
    expect(oldResult.stdout).toContain("command: on PATH (/usr/local/bin/penmark, penmark 0.6.0)");
    expect(oldResult.stdout).toContain("VS Code: 0.6.0");
    expect(oldResult.stdout).toContain("Cursor: not installed");
    expect(oldResult.stdout).toContain("skill: warning — old hand-writer loaded");

    // Replace with the repo skill and remove the old validator script.
    files.delete("/home/.claude/skills/penmark-comments/scripts/validate-penmark-comments.mjs");
    files.set("/home/.claude/skills/penmark-comments/SKILL.md", repoSkill);
    const currentResult = runDoctorOnce();
    expect(currentResult.code).toBe(0);
    expect(currentResult.stdout).toContain(
      "skill: current (/home/.claude/skills/penmark-comments)",
    );

    // Replace with a modified skill that is neither the repo skill nor the old writer.
    files.set("/home/.claude/skills/penmark-comments/SKILL.md", "# Custom modified skill\n");
    const modifiedResult = runDoctorOnce();
    expect(modifiedResult.code).toBe(1);
    expect(modifiedResult.stdout).toContain("skill: warning — differs from repository skill");

    // Remove the installed skill and the command on PATH.
    files.delete("/home/.claude/skills/penmark-comments/SKILL.md");
    files.delete("/usr/local/bin/penmark");
    const missingResult = runDoctorOnce();
    expect(missingResult.code).toBe(0);
    expect(missingResult.stdout).toContain("command: not on PATH (penmark 0.6.0)");
    expect(missingResult.stdout).toContain(
      "skill: not installed (/home/.claude/skills/penmark-comments)",
    );
  });

  it("doctor skips a directory and a non-executable penmark, then reports a later executable", () => {
    const root = tempDir();
    const empty = join(root, "empty");
    const dirHit = join(root, "dir-hit");
    const plainHit = join(root, "plain-hit");
    const execHit = join(root, "exec-hit");
    mkdirSync(empty);
    mkdirSync(dirHit);
    mkdirSync(plainHit);
    mkdirSync(execHit);
    mkdirSync(join(dirHit, "penmark"));
    const plain = join(plainHit, "penmark");
    writeFileSync(plain, "not a command\n");
    chmodSync(plain, 0o644);
    const command = join(execHit, "penmark");
    writeFileSync(command, "#!/bin/sh\n");
    chmodSync(command, 0o755);

    expect(isExecutableFile(join(dirHit, "penmark"))).toBe(false);
    // POSIX mode bits. Windows accepts every regular file; PATHEXT is the next test.
    if (process.platform === "win32") return;

    expect(isExecutableFile(plain)).toBe(false);
    expect(isExecutableFile(command)).toBe(true);

    let stdout = "";
    const env: SetupEnv = {
      root: "/repo",
      version: "0.6.0",
      vsixPath: "/repo/missing.vsix",
      skillSourceDir: "/repo/skills/penmark-comments",
      skillDestDir: "/home/.claude/skills/penmark-comments",
      configPath: "/home/.config/penmark/setup.json",
      pathEnv: [empty, dirHit, plainHit, execHit].join(delimiter),
      ides: [],
      readLine: lineReaderFromLines([]),
      stdout: (t) => {
        stdout += t;
      },
      stderr: () => {},
      exists: existsSync,
      isExecutable: isExecutableFile,
      readText: () => "",
      writeText: () => {
        throw new Error("doctor must not write");
      },
      copyDir: () => {
        throw new Error("doctor must not copy");
      },
      run: () => {
        throw new Error("doctor must not spawn");
      },
    };

    expect(findCommandOnPath(env)).toBe(command);
    expect(runDoctor(env)).toBe(0);
    expect(stdout).toContain(`command: on PATH (${command}, penmark 0.6.0)`);

    stdout = "";
    env.pathEnv = [empty, dirHit, plainHit].join(delimiter);
    expect(findCommandOnPath(env)).toBeNull();
    expect(runDoctor(env)).toBe(0);
    expect(stdout).toContain("command: not on PATH (penmark 0.6.0)");
    expect(stdout).not.toContain(dirHit);
    expect(stdout).not.toContain(plainHit);
  });

  it("tries Windows PATHEXT names and keeps searching after a non-runnable one", () => {
    expect(commandFileNames("penmark", "linux")).toEqual(["penmark"]);
    expect(commandFileNames("penmark", "darwin")).toEqual(["penmark"]);
    expect(commandFileNames("penmark", "win32", ".COM;.EXE;.BAT;.CMD")).toEqual([
      "penmark.COM",
      "penmark.EXE",
      "penmark.BAT",
      "penmark.CMD",
    ]);
    expect(commandFileNames("penmark.CMD", "win32", ".COM;.EXE;.BAT;.CMD")).toEqual([
      "penmark.CMD",
    ]);
    expect(commandFileNames("penmark", "win32", ".EXE;.;.CMD")).toEqual([
      "penmark.EXE",
      "penmark",
      "penmark.CMD",
    ]);
    expect(commandFileNames("penmark", "win32", "")).toEqual([
      "penmark.COM",
      "penmark.EXE",
      "penmark.BAT",
      "penmark.CMD",
    ]);

    const root = tempDir();
    const earlier = join(root, "earlier");
    const later = join(root, "later");
    const exe = join(earlier, "penmark.EXE");
    const cmd = join(earlier, "penmark.CMD");
    const laterExe = join(later, "penmark.EXE");
    const env: SetupEnv = {
      root: "/repo",
      version: "0.6.0",
      vsixPath: "/repo/missing.vsix",
      skillSourceDir: "/repo/skills/penmark-comments",
      skillDestDir: "/home/.claude/skills/penmark-comments",
      configPath: "/home/.config/penmark/setup.json",
      pathEnv: [earlier, later].join(delimiter),
      ides: [],
      readLine: lineReaderFromLines([]),
      stdout: () => {},
      stderr: () => {},
      exists: (p) => p === exe || p === cmd || p === laterExe,
      isExecutable: (p) => p === cmd || p === laterExe,
      readText: () => "",
      writeText: () => {},
      copyDir: () => {},
      run: () => "",
    };
    expect(findCommandOnPath(env, "win32", ".EXE;.CMD")).toBe(cmd);
  });

  it("runs Windows CMD shims through cmd.exe and keeps direct execution otherwise", () => {
    const exe = "C:\\Tools\\code.EXE";
    const npmCmd = "C:\\Program Files\\nodejs\\npm.CMD";
    const codeCmd = "C:\\Program Files (x86)\\code.CMD";
    expect(commandSpawn("code", ["--version"], "linux", null)).toEqual({
      file: "code",
      args: ["--version"],
      windowsVerbatimArguments: false,
    });
    expect(commandSpawn("code", ["--version"], "win32", exe)).toEqual({
      file: exe,
      args: ["--version"],
      windowsVerbatimArguments: false,
    });
    expect(commandSpawn("code", ["--version"], "win32", null)).toEqual({
      file: "code",
      args: ["--version"],
      windowsVerbatimArguments: false,
    });
    expect(commandSpawn("npm", ["run", "package"], "win32", npmCmd)).toEqual({
      file: "cmd.exe",
      args: ["/d", "/s", "/c", '^"C:\\Program^ Files\\nodejs\\npm.CMD^" run package'],
      windowsVerbatimArguments: true,
    });
    expect(commandSpawn("code", ["--version"], "win32", codeCmd)).toEqual({
      file: "cmd.exe",
      args: ["/d", "/s", "/c", '^"C:\\Program^ Files^ ^(x86^)\\code.CMD^" --version'],
      windowsVerbatimArguments: true,
    });
    expect(
      commandSpawn(
        "code",
        ["--install-extension", "C:\\Program Files\\a&b.vsix", "--force"],
        "win32",
        "C:\\bin\\code.CMD",
      ),
    ).toEqual({
      file: "cmd.exe",
      args: [
        "/d",
        "/s",
        "/c",
        // Three carets: the second escape also escapes the caret from the first.
        'C:\\bin\\code.CMD --install-extension ^^^"C:\\Program^^^ Files\\a^^^&b.vsix^^^" --force',
      ],
      windowsVerbatimArguments: true,
    });

    const root = tempDir();
    const earlier = join(root, "earlier");
    const later = join(root, "later");
    mkdirSync(earlier);
    mkdirSync(later);
    const earlierExe = join(earlier, "code.EXE");
    const earlierCmd = join(earlier, "code.CMD");
    const laterCmd = join(later, "npm.CMD");
    const fallback = join(later, "antigravity.CMD");
    writeFileSync(earlierExe, "");
    writeFileSync(earlierCmd, "@echo off\r\n");
    writeFileSync(laterCmd, "@echo off\r\n");
    writeFileSync(fallback, "@echo off\r\n");
    const pathEnv = [earlier, later].join(delimiter);
    const pathExt = ".COM;.EXE;.BAT;.CMD";

    expect(resolveCommandFile("code", pathEnv, "win32", pathExt, existsSync)).toBe(earlierExe);
    expect(resolveCommandFile("code", pathEnv, "win32", pathExt, (p) => p === earlierCmd)).toBe(
      earlierCmd,
    );
    expect(resolveCommandFile("npm", pathEnv, "win32", pathExt, existsSync)).toBe(laterCmd);
    expect(resolveCommandFile(fallback, "", "win32", pathExt, existsSync)).toBe(fallback);
    expect(resolveCommandFile("missing", pathEnv, "win32", pathExt, existsSync)).toBeNull();
    expect(resolveCommandFile("code", pathEnv, "linux", pathExt, existsSync)).toBeNull();

    const direct: string[] = [];
    expect(
      runFile("code", ["--version"], {
        platform: "linux",
        execFile: (file, args) => {
          direct.push(`${file} ${args.join(" ")}`);
          return "ok\n";
        },
      }),
    ).toBe("ok\n");
    expect(direct).toEqual(["code --version"]);

    const exeCalls: string[] = [];
    expect(
      runFile("code", ["--version"], {
        platform: "win32",
        pathEnv,
        pathExt,
        exists: existsSync,
        execFile: (file, args, opts) => {
          exeCalls.push(`${file} ${args.join(" ")}`);
          if (opts.windowsVerbatimArguments === true) throw new Error("exe went through cmd");
          return "1.2.3\n";
        },
      }),
    ).toBe("1.2.3\n");
    expect(exeCalls).toEqual([`${earlierExe} --version`]);

    const calls: { file: string; args: readonly string[]; cwd?: string }[] = [];
    const execFile = (
      file: string,
      args: readonly string[],
      opts: { cwd?: string; windowsVerbatimArguments?: boolean },
    ) => {
      calls.push({ file, args, cwd: opts.cwd });
      if (opts.windowsVerbatimArguments !== true) throw new Error(`direct spawn ${file}`);
      const script = args[3] ?? "";
      if (script.includes("antigravity.CMD") && script.includes("--version")) return "1.105.0\n";
      if (script.includes("code.CMD") && script.includes("--version")) return "1.105.0\n";
      throw new Error(`unexpected ${script}`);
    };
    const shimRun = (cmd: string, args: string[], cwd?: string) =>
      runFile(cmd, args, {
        cwd,
        platform: "win32",
        pathEnv,
        pathExt,
        exists: (p) => p === earlierCmd || p === laterCmd || p === fallback,
        execFile,
      });

    expect(resolveEditorCli({ name: "VS Code", command: "code", fallbacks: [] }, shimRun)).toBe(
      "code",
    );
    expect(
      resolveEditorCli(
        { name: "Antigravity", command: "missing-ide", fallbacks: [fallback] },
        shimRun,
      ),
    ).toBe(fallback);

    const files = new Map<string, string>();
    files.set("/repo/skills/penmark-comments", "dir");
    let installed = false;
    const setupExec = (
      file: string,
      args: readonly string[],
      opts: { cwd?: string; windowsVerbatimArguments?: boolean },
    ) => {
      calls.push({ file, args, cwd: opts.cwd });
      if (file !== "cmd.exe" || opts.windowsVerbatimArguments !== true) {
        throw new Error(`direct spawn ${file}`);
      }
      const script = args[3] ?? "";
      if (script.includes(`${earlierCmd}`) && script.includes(" --version")) return "1.105.0\n";
      if (script.includes(laterCmd) && script.includes(" run package")) {
        if (opts.cwd !== "/repo") throw new Error("package cwd");
        files.set("/repo/penmark-markdown-review-0.6.0.vsix", "vsix");
        return "packaged\n";
      }
      if (script.includes(earlierCmd) && script.includes("--list-extensions")) {
        return installed ? "local.penmark-markdown-review@0.6.0\n" : "";
      }
      if (
        script.includes(earlierCmd) &&
        script.includes("--install-extension") &&
        script.includes("/repo/penmark-markdown-review-0.6.0.vsix")
      ) {
        installed = true;
        return "installed\n";
      }
      throw new Error(`unexpected ${script}`);
    };
    calls.length = 0;
    let stdout = "";
    const setupEnv: SetupEnv = {
      root: "/repo",
      version: "0.6.0",
      vsixPath: "/repo/penmark-markdown-review-0.6.0.vsix",
      skillSourceDir: "/repo/skills/penmark-comments",
      skillDestDir: "/home/.claude/skills/penmark-comments",
      configPath: "/home/.config/penmark/setup.json",
      pathEnv,
      ides: [{ name: "VS Code", command: "code", fallbacks: [] }],
      readLine: lineReaderFromLines([]),
      stdout: (t) => {
        stdout += t;
      },
      stderr: () => {},
      exists: (p) => files.has(p),
      isExecutable: (p) => files.has(p),
      readText: (p) => files.get(p) ?? "",
      writeText: (p, t) => {
        files.set(p, t);
      },
      copyDir: () => {},
      run: (cmd, args, cwd) =>
        runFile(cmd, args, {
          cwd,
          platform: "win32",
          pathEnv,
          pathExt,
          exists: (p) => p === earlierCmd || p === laterCmd,
          execFile: setupExec,
        }),
    };
    const io: Io = {
      read: () => Buffer.alloc(0),
      write: () => {},
      stdin: () => "",
      stdout: (t) => {
        stdout += t;
      },
      stderr: () => {},
      gitAuthor: () => null,
      now: () => "",
      setupEnv: () => setupEnv,
    };
    expect(run(["setup", "--yes"], io)).toBe(0);
    expect(stdout).toContain("VS Code: none -> 0.6.0 ok");
    expect(calls.map((call) => call.args[3] ?? "")).toEqual([
      expect.stringContaining(`${earlierCmd} --version`),
      expect.stringContaining(`${laterCmd} run package`),
      expect.stringContaining("--list-extensions"),
      expect.stringContaining("--install-extension"),
      expect.stringContaining("--list-extensions"),
    ]);
    expect(calls.every((call) => call.file === "cmd.exe" && call.args[0] === "/d")).toBe(true);
    expect(calls[1]?.cwd).toBe("/repo");
  });

  it("setup packages when VSIX is absent, and reports packaging or install failures", () => {
    const files = new Map<string, string>();
    const repoSkill = readFileSync(join(ROOT, "skills/penmark-comments/SKILL.md"), "utf8");
    files.set("/repo/skills/penmark-comments", "dir");
    files.set("/repo/skills/penmark-comments/SKILL.md", repoSkill);

    let packageBuildsVsix = true;
    let installThrows = false;
    let installedVersionAfter: string | null = "0.6.0";

    const runOnce = (stdinLines: string[]) => {
      let stdout = "";
      let stderr = "";
      const env: SetupEnv = {
        root: "/repo",
        version: "0.6.0",
        vsixPath: "/repo/penmark-markdown-review-0.6.0.vsix",
        skillSourceDir: "/repo/skills/penmark-comments",
        skillDestDir: "/home/.claude/skills/penmark-comments",
        configPath: "/home/.config/penmark/setup.json",
        pathEnv: "",
        ides: [{ name: "VS Code", command: "code", fallbacks: [] }],
        readLine: lineReaderFromLines(stdinLines),
        stdout: (t) => {
          stdout += t;
        },
        stderr: (t) => {
          stderr += t;
        },
        exists: (p) => files.has(p),
        isExecutable: (p) => files.has(p),
        readText: (p) => files.get(p) ?? "",
        writeText: (p, t) => {
          files.set(p, t);
        },
        copyDir: () => {},
        run: (cmd, args) => {
          if (cmd === "npm" && args[1] === "package") {
            if (packageBuildsVsix) files.set("/repo/penmark-markdown-review-0.6.0.vsix", "vsix");
            return "packaged";
          }
          if (args[0] === "--version") return "1.105.0";
          if (args[0] === "--list-extensions") {
            return installedVersionAfter
              ? `local.penmark-markdown-review@${installedVersionAfter}\n`
              : "";
          }
          if (args[0] === "--install-extension") {
            if (installThrows) throw new Error("disk full");
            return "ok";
          }
          throw new Error(`unexpected ${cmd}`);
        },
      };
      const io: Io = {
        read: () => Buffer.alloc(0),
        write: () => {},
        stdin: () => "",
        stdout: (t) => {
          stdout += t;
        },
        stderr: (t) => {
          stderr += t;
        },
        gitAuthor: () => null,
        now: () => "",
        setupEnv: () => env,
      };
      const code = run(["setup"], io);
      return { code, stdout, stderr };
    };

    // Packaging succeeds and installs VSIX, declining skill.
    const okRun = runOnce(["y", "n"]);
    expect(okRun.code).toBe(0);
    expect(okRun.stdout).toContain("skill: skipped");

    // Version mismatch after install returns exit 1.
    installedVersionAfter = "0.5.0";
    const mismatchRun = runOnce([]);
    expect(mismatchRun.code).toBe(1);
    expect(mismatchRun.stdout).toContain("MISMATCH");
    expect(mismatchRun.stderr).toContain("1 of 1 editors did not end up on 0.6.0.");

    // Install throwing returns exit 1.
    installThrows = true;
    const failedRun = runOnce([]);
    expect(failedRun.code).toBe(1);
    expect(failedRun.stderr).toContain("VS Code: install failed — disk full");

    // Missing VSIX after packaging returns exit 1.
    files.delete("/repo/penmark-markdown-review-0.6.0.vsix");
    packageBuildsVsix = false;
    const noVsixRun = runOnce([]);
    expect(noVsixRun.code).toBe(1);
    expect(noVsixRun.stderr).toContain("No VSIX at /repo/penmark-markdown-review-0.6.0.vsix");
  });

  it("runs setup and doctor end-to-end through the CLI process in an isolated directory", () => {
    const dir = tempDir();
    const skillRoot = join(dir, "skills");
    const configPath = join(dir, "config", "setup.json");
    const env = {
      HOME: dir,
      PENMARK_SKILLS_DIR: skillRoot,
      PENMARK_SETUP_CONFIG: configPath,
      PENMARK_NO_APP_FALLBACKS: "1",
      PATH: dirname(process.execPath),
    };

    const setupRes = penmark(["setup"], "y\n", env);
    expect(setupRes.status).toBe(0);
    expect(setupRes.stdout).toContain("editors: none found");
    expect(setupRes.stdout).toContain(`skill: ${join(skillRoot, "penmark-comments")}`);
    expect(readFileSync(join(skillRoot, "penmark-comments", "SKILL.md"), "utf8")).toBe(
      readFileSync(join(ROOT, "skills", "penmark-comments", "SKILL.md"), "utf8"),
    );

    const doctorRes = penmark(["doctor"], undefined, env);
    expect(doctorRes.status).toBe(0);
    expect(doctorRes.stdout).toContain("command: not on PATH");
    expect(doctorRes.stdout).toContain("editors: none found");
    expect(doctorRes.stdout).toContain(`skill: current (${join(skillRoot, "penmark-comments")})`);
  });

  it("cancels setup when stdin ends before every answer, and still accepts a blank line as yes", () => {
    const dir = tempDir();
    const skillRoot = join(dir, "skills");
    const configPath = join(dir, "config", "setup.json");
    const skillFile = join(skillRoot, "penmark-comments", "SKILL.md");
    const env = {
      HOME: dir,
      PENMARK_SKILLS_DIR: skillRoot,
      PENMARK_SETUP_CONFIG: configPath,
      PENMARK_NO_APP_FALLBACKS: "1",
      PATH: dirname(process.execPath),
    };

    const closed = penmark(["setup"], Buffer.alloc(0), env);
    expect(closed.status).toBe(0);
    expect(closed.stdout).toContain("Cancelled. Nothing was written.");
    expect(closed.stdout).not.toContain(`skill: ${join(skillRoot, "penmark-comments")}`);
    expect(existsSync(skillFile)).toBe(false);
    expect(existsSync(configPath)).toBe(false);

    const blank = penmark(["setup"], "\n", env);
    expect(blank.status).toBe(0);
    expect(blank.stdout).toContain(`skill: ${join(skillRoot, "penmark-comments")}`);
    expect(existsSync(skillFile)).toBe(true);
    expect(existsSync(configPath)).toBe(true);

    const files = new Map<string, string>();
    const installs: string[] = [];
    const copies: string[] = [];
    const runPartial = (stdinLines: string[]) => {
      let stdout = "";
      installs.length = 0;
      copies.length = 0;
      const setupEnv: SetupEnv = {
        root: "/repo",
        version: "0.6.0",
        vsixPath: "/repo/penmark-markdown-review-0.6.0.vsix",
        skillSourceDir: "/repo/skills/penmark-comments",
        skillDestDir: "/home/.claude/skills/penmark-comments",
        configPath: "/home/.config/penmark/setup.json",
        pathEnv: "",
        ides: [{ name: "VS Code", command: "code", fallbacks: [] }],
        readLine: lineReaderFromLines(stdinLines),
        stdout: (t) => {
          stdout += t;
        },
        stderr: () => {},
        exists: (p) => files.has(p),
        isExecutable: (p) => files.has(p),
        readText: (p) => files.get(p) ?? "",
        writeText: (p, t) => {
          files.set(p, t);
        },
        copyDir: (_src, dest) => {
          copies.push(dest);
        },
        run: (cmd, args) => {
          if (args[0] === "--version") return "1.105.0";
          if (args[0] === "--list-extensions") return "local.penmark-markdown-review@0.6.0\n";
          if (args[0] === "--install-extension") {
            installs.push(cmd);
            return "ok";
          }
          throw new Error(`unexpected ${cmd}`);
        },
      };
      const io: Io = {
        read: () => Buffer.alloc(0),
        write: () => {},
        stdin: () => "",
        stdout: () => {},
        stderr: () => {},
        gitAuthor: () => null,
        now: () => "",
        setupEnv: () => setupEnv,
      };
      return { code: run(["setup"], io), stdout };
    };

    files.set("/repo/penmark-markdown-review-0.6.0.vsix", "vsix");
    files.set("/repo/skills/penmark-comments", "dir");
    const missing = runPartial([]);
    expect(missing.code).toBe(0);
    expect(missing.stdout).toContain("Cancelled. Nothing was written.");
    expect(files.has("/home/.config/penmark/setup.json")).toBe(false);
    expect(installs).toEqual([]);
    expect(copies).toEqual([]);

    const short = runPartial(["n"]);
    expect(short.code).toBe(0);
    expect(short.stdout).toContain("Cancelled. Nothing was written.");
    expect(files.has("/home/.config/penmark/setup.json")).toBe(false);
    expect(installs).toEqual([]);
    expect(copies).toEqual([]);

    const blankAnswers = runPartial(["n", ""]);
    expect(blankAnswers.code).toBe(0);
    expect(blankAnswers.stdout).not.toContain("Cancelled");
    expect(installs).toEqual([]);
    expect(copies).toEqual(["/home/.claude/skills/penmark-comments"]);
    expect(JSON.parse(files.get("/home/.config/penmark/setup.json") ?? "{}")).toEqual({
      editors: { "VS Code": false },
      skill: true,
    });
  });

  it("decodes raw-mode key sequences and supports interactive multiselect, select, and back-navigation", () => {
    expect(decodeKeyChunk("\x1b[A")).toBe("up");
    expect(decodeKeyChunk("\x1b[B")).toBe("down");
    expect(decodeKeyChunk("\x1b[C")).toBe("right");
    expect(decodeKeyChunk("\x1b[D")).toBe("left");
    expect(decodeKeyChunk("\x1bOA")).toBe("up");
    expect(decodeKeyChunk("\x1b[1;5A")).toBe("unknown");
    expect(decodeKeyChunk("\x1b")).toBe("esc");
    expect(decodeKeyChunk("\r")).toBe("enter");
    expect(decodeKeyChunk("\n")).toBe("enter");
    expect(decodeKeyChunk(" ")).toBe("space");
    expect(decodeKeyChunk("x")).toBe("unknown");
    expect(() => decodeKeyChunk("\x03")).toThrow(CancelledError);
    expect(() => decodeKeyChunk("")).toThrow(CancelledError);
    expect(decodeKeyChunk("\x1b[")).toBe("unknown");

    const arrows: readonly [string, KeyName][] = [
      ["\x1b[A", "up"],
      ["\x1b[B", "down"],
      ["\x1b[C", "right"],
      ["\x1b[D", "left"],
      ["\x1bOA", "up"],
      ["\x1bOB", "down"],
      ["\x1bOC", "right"],
      ["\x1bOD", "left"],
    ];
    for (const [seq, name] of arrows) {
      for (let cut = 1; cut < seq.length; cut++) {
        expect(decodeKeyReads([seq.slice(0, cut), seq.slice(cut)])).toEqual([name]);
      }
      expect(decodeKeyReads([...seq])).toEqual([name]);
    }
    expect(decodeKeyReads(["\x1b", null])).toEqual(["esc"]);
    expect(decodeKeyReads(["\x1b[", null])).toEqual(["unknown"]);
    expect(decodeKeyReads(["\x1bO", null])).toEqual(["unknown"]);
    expect(decodeKeyReads(["\x1b[1", null])).toEqual(["unknown"]);
    expect(decodeKeyReads(["\x1b", null, "[A"])).toEqual(["esc", "unknown", "unknown"]);
    expect(decodeKeyReads(["\x1b", "[1;5", "A"])).toEqual(["unknown"]);
    expect(() => decodeKeyReads(["\x1b", "\x03"])).toThrow(CancelledError);

    const stepped: string[] = [];
    expect(() =>
      askInOrder([
        () => {
          stepped.push("editors");
        },
        () => {
          stepped.push("skill");
          throw new CancelledError("Cancelled by user");
        },
      ]),
    ).toThrow(CancelledError);
    expect(stepped).toEqual(["editors", "skill"]);

    let nestedHits = 0;
    expect(() =>
      askInOrder([
        () => {},
        () => {
          askInOrder([
            () => {},
            () => {
              nestedHits += 1;
              if (nestedHits === 1) throw new CancelledError("End of input");
            },
          ]);
        },
      ]),
    ).toThrow(CancelledError);
    expect(nestedHits).toBe(1);

    const backed: string[] = [];
    let skillTries = 0;
    askInOrder([
      () => {
        backed.push("fork");
      },
      () => {
        askInOrder([
          () => {
            backed.push("editors");
          },
          () => {
            backed.push("skill");
            skillTries += 1;
            if (skillTries === 1) throw new BackError();
          },
        ]);
      },
    ]);
    expect(backed).toEqual(["fork", "editors", "skill", "editors", "skill"]);

    expect(keyBar("multiselect", true)).toContain("↑/↓ to navigate");
    expect(keyBar("multiselect", false)).toContain("up/down to navigate - Space to toggle");

    // Non-TTY numbered select and multiselect fallback
    let nonTtyOut = "";
    const nonTtyIo: PromptStream = {
      isTTY: false,
      readKey: () => "enter",
      readLine: lineReaderFromLines(["invalid", "2", "1, 2"]),
      write: (t) => {
        nonTtyOut += t;
      },
    };
    const opts: PromptOption[] = [
      { label: "VS Code", consequence: "detected", available: true },
      { label: "Cursor", consequence: "detected", available: true },
      { label: "Windsurf", consequence: "not found", available: false },
    ];
    expect(select("Pick one", opts, 0, nonTtyIo)).toBe(1);
    expect(multiselect("Pick many", opts, [0], nonTtyIo)).toEqual([0, 1]);
    expect(nonTtyOut).toContain("Please enter a number from 1 to 3.");

    // Interactive TTY multiselect + confirm with Esc back-navigation
    const keys: KeyName[] = [
      "down", // move to Cursor
      "space", // uncheck Cursor
      "enter", // confirm multiselect -> [0] (VS Code only)
      "esc", // on skill confirm, press Esc to go back to editor multiselect!
      "down", // move to Cursor again
      "space", // re-check Cursor
      "enter", // confirm multiselect -> [0, 1]
      "enter", // confirm skill -> Yes
    ];
    let keyIdx = 0;
    const files = new Map<string, string>();
    const repoSkill = readFileSync(join(ROOT, "skills/penmark-comments/SKILL.md"), "utf8");
    files.set("/repo/penmark-markdown-review-0.6.0.vsix", "vsix");
    files.set("/repo/skills/penmark-comments", "dir");
    files.set("/repo/skills/penmark-comments/SKILL.md", repoSkill);

    let stdout = "";
    let stderr = "";
    const env: SetupEnv = {
      root: "/repo",
      version: "0.6.0",
      vsixPath: "/repo/penmark-markdown-review-0.6.0.vsix",
      skillSourceDir: "/repo/skills/penmark-comments",
      skillDestDir: "/home/.claude/skills/penmark-comments",
      configPath: "/home/.config/penmark/setup.json",
      pathEnv: "",
      ides: [
        { name: "VS Code", command: "code", fallbacks: [] },
        { name: "Cursor", command: "cursor", fallbacks: [] },
        { name: "Windsurf", command: "windsurf", fallbacks: [] },
      ],
      isTTY: true,
      readKey: () => keys[keyIdx++] ?? "enter",
      readLine: lineReaderFromLines([]),
      stdout: (t) => {
        stdout += t;
      },
      stderr: (t) => {
        stderr += t;
      },
      exists: (p) => files.has(p),
      isExecutable: (p) => files.has(p),
      readText: (p) => files.get(p) ?? "",
      writeText: (p, t) => {
        files.set(p, t);
      },
      copyDir: (_src, dest) => {
        files.set(join(dest, "SKILL.md"), repoSkill);
      },
      run: (cmd, args) => {
        if (args[0] === "--version") {
          if (cmd === "code" || cmd === "cursor") return "1.105.0";
          throw new Error("missing");
        }
        if (args[0] === "--list-extensions") return "local.penmark-markdown-review@0.6.0\n";
        if (args[0] === "--install-extension") return "ok";
        throw new Error(`unexpected ${cmd}`);
      },
    };
    const io: Io = {
      read: () => Buffer.alloc(0),
      write: () => {},
      stdin: () => "",
      stdout: (t) => {
        stdout += t;
      },
      stderr: (t) => {
        stderr += t;
      },
      gitAuthor: () => null,
      now: () => "",
      setupEnv: () => env,
    };

    const code = run(["setup"], io);
    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("Which editors should receive the Penmark extension?");
    expect(stdout).toContain("VS Code: 0.6.0 -> 0.6.0 ok");
    expect(stdout).toContain("Cursor: 0.6.0 -> 0.6.0 ok");
    expect(JSON.parse(files.get("/home/.config/penmark/setup.json") ?? "{}")).toEqual({
      editors: { "VS Code": true, Cursor: true },
      skill: true,
    });

    // Second interactive run shows the rerun fork ("Change settings" / "Repair the install")
    stdout = "";
    keyIdx = 0;
    const rerunKeys: KeyName[] = [
      "enter", // select "Change settings" (index 0)
      "space", // uncheck VS Code
      "enter", // confirm multiselect -> [1] (Cursor only)
      "down", // move to No on skill
      "enter", // confirm skill -> No
    ];
    env.readKey = () => rerunKeys[keyIdx++] ?? "enter";
    const rerunCode = run(["setup"], io);
    expect(rerunCode).toBe(0);
    expect(stdout).toContain("Penmark is already installed. Choose an action:");
    expect(stdout).toContain("VS Code: 0.6.0 (skipped)");
    expect(stdout).toContain("Cursor: 0.6.0 -> 0.6.0 ok");
    expect(JSON.parse(files.get("/home/.config/penmark/setup.json") ?? "{}")).toEqual({
      editors: { "VS Code": false, Cursor: true },
      skill: false,
    });

    // Ctrl-C on the skill step of the rerun wizard aborts and keeps the saved choices.
    stdout = "";
    let rerunHits = 0;
    env.readKey = () => {
      rerunHits += 1;
      if (rerunHits === 1) return "enter";
      if (rerunHits === 2) return "space";
      if (rerunHits === 3) return "enter";
      throw new CancelledError("Cancelled by user");
    };
    expect(run(["setup"], io)).toBe(0);
    expect(stdout).toContain("Cancelled. Nothing was written.");
    expect(JSON.parse(files.get("/home/.config/penmark/setup.json") ?? "{}")).toEqual({
      editors: { "VS Code": false, Cursor: true },
      skill: false,
    });

    // Pressing Esc at the first prompt cancels without writing
    files.delete("/home/.config/penmark/setup.json");
    stdout = "";
    keyIdx = 0;
    const cancelKeys: KeyName[] = ["esc"];
    env.readKey = () => cancelKeys[keyIdx++] ?? "esc";
    const cancelCode = run(["setup"], io);
    expect(cancelCode).toBe(0);
    expect(stdout).toContain("Cancelled. Nothing was written.");
    expect(files.has("/home/.config/penmark/setup.json")).toBe(false);

    // End of input on the skill step of a fresh wizard writes nothing.
    files.delete("/home/.config/penmark/setup.json");
    stdout = "";
    let freshHits = 0;
    env.readKey = () => {
      freshHits += 1;
      if (freshHits === 1) return "enter";
      throw new CancelledError("End of input");
    };
    expect(run(["setup"], io)).toBe(0);
    expect(stdout).toContain("Cancelled. Nothing was written.");
    expect(files.has("/home/.config/penmark/setup.json")).toBe(false);
  });

  it("supports setup --yes, --defaults, --dry-run, --repair, and surfaces subprocess stderr on package failure", () => {
    const files = new Map<string, string>();
    const repoSkill = readFileSync(join(ROOT, "skills/penmark-comments/SKILL.md"), "utf8");
    files.set("/repo/penmark-markdown-review-0.6.0.vsix", "vsix");
    files.set("/repo/skills/penmark-comments", "dir");
    files.set("/repo/skills/penmark-comments/SKILL.md", repoSkill);

    let packageThrowsStderr = false;
    const makeIo = (isTTY = false) => {
      let stdout = "";
      let stderr = "";
      const env: SetupEnv = {
        root: "/repo",
        version: "0.6.0",
        vsixPath: "/repo/penmark-markdown-review-0.6.0.vsix",
        skillSourceDir: "/repo/skills/penmark-comments",
        skillDestDir: "/home/.claude/skills/penmark-comments",
        configPath: "/home/.config/penmark/setup.json",
        pathEnv: "",
        ides: [{ name: "VS Code", command: "code", fallbacks: [] }],
        isTTY,
        readLine: lineReaderFromLines(["n", "n"]),
        stdout: (t) => {
          stdout += t;
        },
        stderr: (t) => {
          stderr += t;
        },
        exists: (p) => files.has(p),
        isExecutable: (p) => files.has(p),
        readText: (p) => files.get(p) ?? "",
        writeText: (p, t) => {
          files.set(p, t);
        },
        copyDir: (_src, dest) => {
          files.set(join(dest, "SKILL.md"), repoSkill);
        },
        run: (cmd, args) => {
          if (cmd === "npm" && args[1] === "package") {
            if (packageThrowsStderr) {
              const err = new Error("Command failed: npm run package") as Error & {
                stderr?: Buffer;
              };
              err.stderr = Buffer.from("npm error code ELSPROBLEMS\nnpm error extraneous: pkg\n");
              throw err;
            }
            return "ok";
          }
          if (args[0] === "--version") return "1.105.0";
          if (args[0] === "--list-extensions") return "local.penmark-markdown-review@0.6.0\n";
          if (args[0] === "--install-extension") return "ok";
          throw new Error(`unexpected ${cmd}`);
        },
      };
      const io: Io = {
        read: () => Buffer.alloc(0),
        write: () => {},
        stdin: () => "",
        stdout: (t) => {
          stdout += t;
        },
        stderr: (t) => {
          stderr += t;
        },
        gitAuthor: () => null,
        now: () => "",
        setupEnv: () => env,
      };
      return { io, getStdout: () => stdout, getStderr: () => stderr };
    };

    // --dry-run prints plan and writes nothing
    const dry = makeIo();
    expect(run(["setup", "--yes", "--dry-run"], dry.io)).toBe(0);
    expect(dry.getStdout()).toContain("Penmark 0.6.0 (dry run)");
    expect(dry.getStdout()).toContain("VS Code: would install");
    expect(files.has("/home/.config/penmark/setup.json")).toBe(false);

    // -y installs without reading stdin lines
    const yesRun = makeIo();
    expect(run(["setup", "-y"], yesRun.io)).toBe(0);
    expect(yesRun.getStdout()).toContain("VS Code: 0.6.0 -> 0.6.0 ok");
    expect(JSON.parse(files.get("/home/.config/penmark/setup.json") ?? "{}")).toEqual({
      editors: { "VS Code": true },
      skill: true,
    });

    // --repair updates existing install in TTY mode without prompting
    const repairRun = makeIo(true);
    expect(run(["setup", "--repair"], repairRun.io)).toBe(0);
    expect(repairRun.getStdout()).not.toContain("Choose an action:");
    expect(repairRun.getStdout()).toContain("VS Code: 0.6.0 -> 0.6.0 ok");

    // Subprocess stderr is surfaced when packaging fails
    files.delete("/repo/penmark-markdown-review-0.6.0.vsix");
    packageThrowsStderr = true;
    const pkgFail = makeIo(true);
    expect(run(["setup", "--repair"], pkgFail.io)).toBe(1);
    expect(pkgFail.getStderr()).toContain("ELSPROBLEMS");
  });
});
