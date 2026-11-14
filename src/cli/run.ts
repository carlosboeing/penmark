/**
 * The `penmark` process. Planning stays in src/core/comments/apply.ts.
 * This file reads, checks the hash, and writes.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  listComments,
  locateQuote,
  planFindings,
  planResolve,
  reviewPrompt,
  validateText,
  type Finding,
  type QuoteMatch,
} from "../core/comments/apply.js";

export interface Io {
  read(path: string): Buffer;
  write(path: string, text: string): void;
  stdin(): string;
  stdout(text: string): void;
  gitAuthor(dir: string): string | null;
  now(): string;
}

const defaultIo: Io = {
  read: (path) => readFileSync(path),
  write: (path, text) => writeFileSync(path, text),
  stdin: () => readFileSync(0, "utf8"),
  stdout: (text) => process.stdout.write(text),
  gitAuthor,
  now: nowTimestamp,
};

interface ParsedArgs {
  positionals: string[];
  flags: Map<string, string | true>;
  error?: string;
}

export function run(argv: string[], io: Io = defaultIo): number {
  const args = parseArgv(argv);
  if (args.error !== undefined) return fail(io, 1, args.error);
  const cmd = args.positionals[0];
  const sub = args.positionals[1];
  const file = args.flags.get("file");
  if (typeof file !== "string" || file === "") return fail(io, 1, "missing --file");
  if (countFlag(argv, "--file") !== 1) return fail(io, 1, "one file per invocation");

  try {
    if (cmd === "comment" && sub === "apply") {
      return applyCommand(file, args.positionals.slice(2), args, io);
    }
    if (cmd === "comment" && sub === "locate") {
      return locateCommand(file, args.positionals.slice(2), args, io);
    }
    const rest = args.positionals.slice(1);
    if (cmd === "validate") return validateCommand(file, rest, io);
    if (cmd === "list") return listCommand(file, rest, io);
    if (cmd === "resolve") return resolveCommand(file, rest, io);
    if (cmd === "export-prompt") return exportCommand(file, rest, io);
  } catch (err) {
    const message = err instanceof Error ? err.message : "read failed";
    return fail(io, 1, message);
  }
  return fail(io, 1, "unknown command");
}

function applyCommand(file: string, rest: string[], args: ParsedArgs, io: Io): number {
  if (rest.length > 0) return fail(io, 1, "one file per invocation");
  const dryRun = args.flags.get("dry-run") === true;
  const provenance = args.flags.get("provenance") ?? "agent";
  if (provenance !== "agent" && provenance !== "human") return fail(io, 1, "bad --provenance");
  const findings = readFindings(io.stdin());
  if (findings === null) return fail(io, 1, "bad findings JSON");

  const first = readUtf8(io, file);
  if (first === null) return fail(io, 1, "file is not valid UTF-8");
  const authorFlag = args.flags.get("author");
  const author = typeof authorFlag === "string" && authorFlag !== "" ? authorFlag : io.gitAuthor(dirname(file));
  if (author === null || author === "") return fail(io, 1, "missing author");
  if (/[\r\n]/.test(author) || author.includes("--")) return fail(io, 1, "bad author");

  const planned = planFindings(first.text, toTextRanges(findings, first.bom), {
    author,
    provenance,
    timestamp: io.now(),
  });
  const results = planned.results.map((r) =>
    r.matches === undefined ? r : { ...r, matches: toFileMatches(r.matches, first.bom) },
  );
  if (planned.code !== 0 || dryRun || planned.text === null) {
    emit(io, {
      file,
      dryRun,
      wrote: false,
      results,
      ...(planned.corruption !== undefined ? { corruption: planned.corruption } : {}),
    });
    return planned.code;
  }

  const again = readUtf8(io, file);
  if (again === null) return fail(io, 1, "file is not valid UTF-8");
  if (again.hash !== first.hash) {
    emit(io, { file, dryRun: false, wrote: false, results, reason: "changed" });
    return 3;
  }
  io.write(file, first.bom + planned.text);
  emit(io, { file, dryRun: false, wrote: true, results });
  return 0;
}

function locateCommand(file: string, rest: string[], args: ParsedArgs, io: Io): number {
  if (rest.length > 0) return fail(io, 1, "one file per invocation");
  const quote = args.flags.get("quote");
  if (typeof quote !== "string" || quote.trim() === "") return fail(io, 1, "missing --quote");
  const decoded = readUtf8(io, file);
  if (decoded === null) return fail(io, 1, "file is not valid UTF-8");
  const corruption = validateText(decoded.text);
  if (!corruption.ok) {
    emit(io, corruption);
    return 4;
  }
  const found = locateQuote(decoded.text, quote);
  emit(io, { matches: toFileMatches(found.matches, decoded.bom), truncated: found.truncated });
  return 0;
}

function validateCommand(file: string, rest: string[], io: Io): number {
  if (rest.length > 0) return fail(io, 1, "one file per invocation");
  const decoded = readUtf8(io, file);
  if (decoded === null) return fail(io, 1, "file is not valid UTF-8");
  const result = validateText(decoded.text);
  emit(io, result);
  return result.ok ? 0 : 4;
}

function listCommand(file: string, rest: string[], io: Io): number {
  if (rest.length > 0) return fail(io, 1, "one file per invocation");
  const decoded = readUtf8(io, file);
  if (decoded === null) return fail(io, 1, "file is not valid UTF-8");
  const result = listComments(decoded.text);
  if ("corruption" in result) {
    emit(io, { ok: false, corruption: result.corruption });
    return 4;
  }
  emit(io, result);
  return 0;
}

function resolveCommand(file: string, rest: string[], io: Io): number {
  if (rest.length !== 1) return fail(io, 1, "resolve takes one id");
  const id = rest[0] ?? "";
  const first = readUtf8(io, file);
  if (first === null) return fail(io, 1, "file is not valid UTF-8");
  const planned = planResolve(first.text, id);
  if (planned.code !== 0 || planned.text === null) {
    emit(io, {
      removed: planned.removed,
      ...(planned.corruption !== undefined ? { corruption: planned.corruption } : {}),
    });
    return planned.code;
  }
  const again = readUtf8(io, file);
  if (again === null) return fail(io, 1, "file is not valid UTF-8");
  if (again.hash !== first.hash) return fail(io, 3, "changed");
  io.write(file, first.bom + planned.text);
  emit(io, { removed: planned.removed });
  return 0;
}

function exportCommand(file: string, rest: string[], io: Io): number {
  if (rest.length > 0) return fail(io, 1, "one file per invocation");
  const decoded = readUtf8(io, file);
  if (decoded === null) return fail(io, 1, "file is not valid UTF-8");
  const result = reviewPrompt(decoded.text, file);
  if ("corruption" in result) {
    emit(io, { ok: false, corruption: result.corruption });
    return 4;
  }
  io.stdout(result.prompt);
  return 0;
}

function readFindings(raw: string): Finding[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || !("findings" in parsed)) return null;
  const findings = (parsed as { findings?: unknown }).findings;
  if (!Array.isArray(findings) || findings.length === 0) return null;
  const out: Finding[] = [];
  for (const item of findings) {
    if (item === null || typeof item !== "object") return null;
    const row = item as Record<string, unknown>;
    if (typeof row.quote !== "string" || typeof row.body !== "string") return null;
    const finding: Finding = { quote: row.quote, body: row.body };
    const hasStart = "start" in row && row.start !== undefined;
    const hasEnd = "end" in row && row.end !== undefined;
    if (hasStart !== hasEnd) return null;
    if (hasStart) {
      if (typeof row.start !== "number" || typeof row.end !== "number") return null;
      finding.start = row.start;
      finding.end = row.end;
    }
    out.push(finding);
  }
  return out;
}

/** U+FEFF, the byte order mark. Built from its code so no invisible character sits in this file. */
const BOM = String.fromCharCode(0xfeff);

interface Decoded {
  /** The file text after any leading byte order mark. */
  text: string;
  hash: string;
  /** The byte order mark the file starts with, or "". A write puts it back. */
  bom: string;
}

/**
 * Decode the file. A leading byte order mark is kept apart from `text`: the
 * frontmatter check and the block tokenizer both read the first characters of
 * the text, and a mark in front of them would hide a `---` or `#` line.
 */
function readUtf8(io: Io, path: string): Decoded | null {
  const buf = io.read(path);
  try {
    // Without ignoreBOM the decoder drops the mark, and a write would then
    // remove it from the file.
    const decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buf);
    const bom = decoded.startsWith(BOM) ? BOM : "";
    return {
      text: decoded.slice(bom.length),
      hash: createHash("sha256").update(buf).digest("hex"),
      bom,
    };
  } catch {
    return null;
  }
}

/**
 * `start` and `end` in the command's input and output index the decoded file,
 * where a byte order mark is index 0. The planner's text has no mark. These
 * two helpers move a range between the two. Index 0 stays 0 on the way in, so
 * a range may start at the mark, and a value that is not a valid index stays
 * invalid.
 */
function toTextRanges(findings: Finding[], bom: string): Finding[] {
  if (bom === "") return findings;
  const shift = (n: number) => (n > 0 ? n - bom.length : n);
  return findings.map((f) =>
    f.start === undefined || f.end === undefined
      ? f
      : { ...f, start: shift(f.start), end: shift(f.end) },
  );
}

function toFileMatches(matches: QuoteMatch[], bom: string): QuoteMatch[] {
  if (bom === "") return matches;
  return matches.map((m) => ({ ...m, start: m.start + bom.length, end: m.end + bom.length }));
}

function parseArgv(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (arg === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      if (key === "dry-run") {
        flags.set(key, true);
        continue;
      }
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) return { positionals, flags, error: `missing value for --${key}` };
      flags.set(key, value);
      i++;
      continue;
    }
    positionals.push(arg);
  }
  return { positionals, flags };
}

function countFlag(argv: string[], flag: string): number {
  return argv.filter((arg) => arg === flag).length;
}

function emit(io: Io, value: unknown): void {
  io.stdout(JSON.stringify(value) + "\n");
}

function fail(io: Io, code: number, error: string): number {
  emit(io, { error });
  return code;
}

function gitAuthor(dir: string): string | null {
  try {
    const name = execFileSync("git", ["config", "user.name"], { cwd: dir, encoding: "utf8" }).trim();
    return name === "" ? null : name;
  } catch {
    return null;
  }
}

export function nowTimestamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const abs = Math.abs(offset);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())} ` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}
