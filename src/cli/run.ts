/**
 * The `penmark` process. Planning stays in src/core/comments/apply.ts.
 * This file reads, checks the hash, and writes.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
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
import { defaultSetupEnv, runDoctor, runSetup, type SetupEnv } from "./setup.js";

export interface Io {
  read(path: string): Buffer;
  write(path: string, text: string): void;
  stdin(): string;
  stdout(text: string): void;
  stderr(text: string): void;
  gitAuthor(dir: string): string | null;
  now(): string;
  setupEnv?(root: string, version: string): SetupEnv;
}

const defaultIo: Io = {
  read: (path) => readFileSync(path),
  write: (path, text) => writeFileSync(path, text),
  stdin: () => readFileSync(0, "utf8"),
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  gitAuthor,
  now: nowTimestamp,
};

interface ParsedArgs {
  positionals: string[];
  flags: Map<string, string | true>;
  help: boolean;
  error?: string;
}

export function run(argv: string[], io: Io = defaultIo): number {
  if (argv.length === 0) {
    io.stdout(HELP);
    return 0;
  }
  if (wantsVersion(argv)) {
    io.stdout(`penmark ${packageVersion()}\n`);
    return 0;
  }

  const args = parseArgv(argv);
  const cmd = args.positionals[0];
  const sub = args.positionals[1];
  if (args.help || cmd === "help") {
    io.stdout(helpText(cmd === "help" ? args.positionals.slice(1) : args.positionals));
    return 0;
  }
  const kind = kindOf(cmd, sub);
  const usage = usageFor(kind);
  if (args.error !== undefined) {
    const flag = args.error.startsWith("missing value for --")
      ? args.error.slice("missing value for --".length)
      : "";
    const reason = flag === "" ? args.error : `--${flag} needs a value`;
    return usageError(io, reason, usage);
  }
  if (cmd === undefined) return usageError(io, "penmark needs a command", usage);
  if (kind === null) return usageError(io, `unknown command: ${commandName(cmd, sub)}`, usage);
  if (kind === "comment") return usageError(io, "penmark comment needs apply or locate", usage);
  const unknown = unknownFlag(args.flags, kind);
  if (unknown !== null) return usageError(io, `unknown option: --${unknown}`, usage);
  if (kind === "setup" || kind === "doctor") {
    const rest = args.positionals.slice(1);
    if (rest.length > 0) return usageError(io, `unexpected argument: ${rest[0]}`, usage);
    const { root, version } = packageInfo();
    const env =
      io.setupEnv !== undefined
        ? io.setupEnv(root, version)
        : defaultSetupEnv(
            root,
            version,
            (text) => io.stdout(text),
            (text) => io.stderr(text),
          );
    return kind === "setup" ? runSetup(env) : runDoctor(env);
  }
  const file = args.flags.get("file");
  if (typeof file !== "string" || file === "") return usageError(io, `${commandLabel(kind)} needs --file`, usage);
  if (countFlag(argv, "--file") !== 1) return usageError(io, "pass --file once", usage);

  try {
    if (kind === "apply") return applyCommand(file, args.positionals.slice(2), args, io);
    if (kind === "locate") return locateCommand(file, args.positionals.slice(2), args, io);
    const rest = args.positionals.slice(1);
    if (kind === "validate") return validateCommand(file, rest, io);
    if (kind === "list") return listCommand(file, rest, io);
    if (kind === "resolve") return resolveCommand(file, rest, io);
    return exportCommand(file, rest, io);
  } catch (err) {
    const message = err instanceof Error ? err.message : "read failed";
    return fail(io, 1, message);
  }
}

function applyCommand(file: string, rest: string[], args: ParsedArgs, io: Io): number {
  if (rest.length > 0) return usageError(io, `unexpected argument: ${rest[0]}`, USAGE.apply);
  const dryRun = args.flags.get("dry-run") === true;
  const provenance = args.flags.get("provenance") ?? "agent";
  if (provenance !== "agent" && provenance !== "human") {
    return usageError(io, "--provenance must be agent or human", USAGE.apply);
  }
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
  if (rest.length > 0) return usageError(io, `unexpected argument: ${rest[0]}`, USAGE.locate);
  const quote = args.flags.get("quote");
  if (typeof quote !== "string" || quote.trim() === "") return usageError(io, "comment locate needs --quote", USAGE.locate);
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
  if (rest.length > 0) return usageError(io, `unexpected argument: ${rest[0]}`, USAGE.validate);
  const decoded = readUtf8(io, file);
  if (decoded === null) return fail(io, 1, "file is not valid UTF-8");
  const result = validateText(decoded.text);
  emit(io, result);
  return result.ok ? 0 : 4;
}

function listCommand(file: string, rest: string[], io: Io): number {
  if (rest.length > 0) return usageError(io, `unexpected argument: ${rest[0]}`, USAGE.list);
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
  if (rest.length !== 1) return usageError(io, "resolve takes one comment id", USAGE.resolve);
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
  if (rest.length > 0) return usageError(io, `unexpected argument: ${rest[0]}`, USAGE.export);
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

const USAGE = {
  apply: "Usage: penmark comment apply --file <path> [--author <name>] [--provenance agent|human] [--dry-run]",
  locate: "Usage: penmark comment locate --file <path> --quote <text>",
  list: "Usage: penmark list --file <path>",
  validate: "Usage: penmark validate --file <path>",
  resolve: "Usage: penmark resolve --file <path> <id>",
  export: "Usage: penmark export-prompt --file <path>",
  setup: "Usage: penmark setup",
  doctor: "Usage: penmark doctor",
  comment: "Usage: penmark comment apply|locate --file <path>",
  help: "Run penmark --help for the commands.",
} as const;

type Kind = "apply" | "locate" | "list" | "validate" | "resolve" | "export" | "setup" | "doctor" | "comment";

const FLAGS: Record<Exclude<Kind, "comment">, readonly string[]> = {
  apply: ["file", "author", "provenance", "dry-run"],
  locate: ["file", "quote"],
  list: ["file"],
  validate: ["file"],
  resolve: ["file"],
  export: ["file"],
  setup: [],
  doctor: [],
};

const HELP = `
  penmark — review comments in a markdown file

  Place a finding on a sentence. A second note on that sentence is a reply.

  USAGE
    penmark <command> --file <path>
    penmark setup | doctor
    penmark help                  Show this text

  COMMANDS
    comment apply --file <path>   Write findings from JSON on stdin
    comment locate --file <path>  Find where a quoted passage sits
    list --file <path>            List the comments in the file
    validate --file <path>        Check that the review block is intact
    resolve --file <path> <id>    Delete a comment. A root takes its replies
    export-prompt --file <path>   Print the open comments as text
    setup                         Install or update the extension and skill
    doctor                        Report command, editor, and skill state
    version                       Print the installed version

  OPTIONS
    --file <path>                 The markdown file. Required on every command
                                  except setup, doctor, help, and version
    --author <name>               comment apply. Defaults to git user.name
    --provenance agent|human      comment apply. Defaults to agent
    --dry-run                     comment apply. Report the plan and do not write
    --quote <text>                comment locate. The passage to find

  comment apply reads one JSON object on stdin:

    { "findings": [ { "quote": "the sentence", "body": "the note" } ] }

  start and end are optional and travel together. They are indexes into the
  file after it is decoded as text. Command results are JSON on stdout.

`;

function wantsVersion(argv: string[]): boolean {
  return argv.length > 0 && argv.every((arg) => arg === "version" || arg === "--version" || arg === "-v");
}

function helpText(words: string[]): string {
  const cmd = words[0];
  const sub = words[1];
  if (cmd === "comment" && sub === "apply") {
    return `
  penmark comment apply

  Write findings into the file. A second note on the same sentence is a reply.

  USAGE
    ${USAGE.apply}

  The findings are one JSON object on stdin:

    { "findings": [ { "quote": "the sentence", "body": "the note" } ] }

  The file changes only when every finding is accepted.

`;
  }
  if (cmd === "comment" && sub === "locate") {
    return commandHelp("comment locate", "Find where a quoted passage sits in the file.", USAGE.locate);
  }
  if (cmd === "comment") {
    return commandHelp("comment", "apply writes findings. locate finds a passage.", USAGE.comment);
  }
  if (cmd === "list") return commandHelp("list", "List the comments in the file.", USAGE.list);
  if (cmd === "validate") return commandHelp("validate", "Check that the review block is intact.", USAGE.validate);
  if (cmd === "resolve") {
    return commandHelp("resolve", "Delete a comment. Deleting a root also deletes its replies.", USAGE.resolve);
  }
  if (cmd === "export-prompt") {
    return commandHelp("export-prompt", "Print the open comments as text.", USAGE.export);
  }
  if (cmd === "setup") {
    return commandHelp("setup", "Install or update the extension in chosen editors and the review skill.", USAGE.setup);
  }
  if (cmd === "doctor") {
    return commandHelp("doctor", "Report whether the command, editor extensions, and skill are ready.", USAGE.doctor);
  }
  return HELP;
}

function commandHelp(name: string, sentence: string, usage: string): string {
  return `\n  penmark ${name}\n\n  ${sentence}\n\n  USAGE\n    ${usage}\n\n`;
}

function kindOf(cmd: string | undefined, sub: string | undefined): Kind | null {
  if (cmd === "comment" && sub === "apply") return "apply";
  if (cmd === "comment" && sub === "locate") return "locate";
  if (cmd === "comment" && sub === undefined) return "comment";
  if (cmd === "list") return "list";
  if (cmd === "validate") return "validate";
  if (cmd === "export-prompt") return "export";
  if (cmd === "resolve") return "resolve";
  if (cmd === "setup") return "setup";
  if (cmd === "doctor") return "doctor";
  return null;
}

function usageFor(kind: Kind | null): string {
  if (kind === null) return USAGE.help;
  return USAGE[kind];
}

function commandName(cmd: string, sub: string | undefined): string {
  if (cmd === "resolve" || cmd === "setup" || cmd === "doctor" || sub === undefined) return cmd;
  return `${cmd} ${sub}`;
}

function commandLabel(kind: Exclude<Kind, "comment">): string {
  if (kind === "apply") return "penmark comment apply";
  if (kind === "locate") return "penmark comment locate";
  if (kind === "export") return "penmark export-prompt";
  return `penmark ${kind}`;
}

function unknownFlag(flags: Map<string, string | true>, kind: Exclude<Kind, "comment">): string | null {
  for (const key of flags.keys()) {
    if (!FLAGS[kind].includes(key)) return key;
  }
  return null;
}

function usageError(io: Io, reason: string, action: string): number {
  io.stderr(`\nerror  ${reason}\n       ${action}\n\n`);
  return 1;
}

function packageInfo(): { root: string; version: string } {
  // The linked bin is a symlink, so follow it. tsx runs src/cli/main.ts and
  // the package is two levels up. The bundle is dist-cli/cli.js and the
  // package is one level up.
  const entry = process.argv[1] ?? "";
  const here = dirname(entry === "" ? entry : realpathSync(entry));
  for (const dir of [join(here, ".."), join(here, "../..")]) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
        name?: string;
        version?: string;
      };
      if (pkg.name === "penmark-markdown-review" && typeof pkg.version === "string") {
        return { root: dir, version: pkg.version };
      }
    } catch {
      // Try the other depth.
    }
  }
  return { root: here, version: "unknown" };
}

function packageVersion(): string {
  return packageInfo().version;
}

function parseArgv(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string | true>();
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (arg === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      if (key === "dry-run") {
        flags.set(key, true);
        continue;
      }
      const value = argv[i + 1];
      // A value may not start with "--", so --help here is still a help
      // request. -h is accepted as a value.
      if (value === "--help") {
        help = true;
        continue;
      }
      if (value === undefined || value.startsWith("--")) {
        return { positionals, flags, help, error: `missing value for --${key}` };
      }
      flags.set(key, value);
      i++;
      continue;
    }
    positionals.push(arg);
  }
  return { positionals, flags, help };
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
