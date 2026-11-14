import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { run, type Io } from "./run.js";
import { defaultIdes, lineReaderFromLines, type IdeSpec, type SetupEnv } from "./setup.js";

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

function penmark(args: string[], input?: string, env?: NodeJS.ProcessEnv) {
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
      JSON.stringify({ findings: [{ quote: "eventual consistency", body: "Name the failure mode." }] }),
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
    penmark(["comment", "apply", "--file", file, "--author", "Ada"], input("Name the failure mode."));
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
    const file = write(dir, "note.md", "See eventual consistency early.\n\nSee eventual consistency later.\n");
    const before = readFileSync(file);
    const result = penmark(
      ["comment", "apply", "--file", file, "--author", "Ada"],
      JSON.stringify({ findings: [{ quote: "eventual consistency", body: "Which one?" }] }),
    );
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout).results[0].reason).toBe("ambiguous-quote");
    expect(readFileSync(file)).toEqual(before);
    const located = penmark(["comment", "locate", "--file", file, "--quote", "eventual consistency"]);
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
        findings: [{ quote: "title: secret", body: "No.", start, end: start + "title: secret".length }],
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
    const replied = penmark(["comment", "apply", "--file", file, "--author", "Ada"], input("Reply."));
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

    const located = penmark(["comment", "locate", "--file", file, "--quote", "eventual consistency"]);
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
        findings: [{ quote: "title: secret", body: "No.", start, end: start + "title: secret".length }],
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
    for (const name of ["comment apply", "comment locate", "list", "validate", "resolve", "export-prompt", "setup", "doctor", "version"]) {
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
            if (cmd === "code" || cmd === "cursor" || cmd === "/Applications/Antigravity") return "1.105.0";
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
    expect(first.stdout).toContain("Install the penmark-comments skill in /home/.claude/skills/penmark-comments?");
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
    expect(currentResult.stdout).toContain("skill: current (/home/.claude/skills/penmark-comments)");

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
    expect(missingResult.stdout).toContain("skill: not installed (/home/.claude/skills/penmark-comments)");
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
            return installedVersionAfter ? `local.penmark-markdown-review@${installedVersionAfter}\n` : "";
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
});
