import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { run, type Io } from "./run.js";

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
      gitAuthor: () => "Ada",
      now: () => "2026-11-13 12:00:00 +00:00",
    };
    const code = run(["comment", "apply", "--file", file, "--author", "Ada"], io);
    expect(code).toBe(3);
    expect(written).toBe("");
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
});
