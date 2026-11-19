import { readSync } from "fs";

export class CancelledError extends Error {
  constructor(message = "Cancelled by user") {
    super(message);
    this.name = "CancelledError";
  }
}

/** Escape asked to leave this step. Ctrl-C and end of input stay CancelledError. */
export class BackError extends Error {
  constructor() {
    super("Back");
    this.name = "BackError";
  }
}

export interface PromptOption {
  label: string;
  consequence: string;
  available: boolean;
}

export type KeyName = "up" | "down" | "left" | "right" | "enter" | "space" | "esc" | "unknown";

export interface PromptStream {
  isTTY: boolean;
  utf8?: boolean;
  readKey: () => KeyName;
  readLine: () => string;
  write: (text: string) => void;
}

const KEYS: Record<"select" | "multiselect" | "confirm", readonly string[]> = {
  select: ["{nav} to navigate", "Enter to confirm", "Esc to go back"],
  multiselect: ["{nav} to navigate", "Space to toggle", "Enter to confirm", "Esc to go back"],
  confirm: ["{nav} to navigate", "Enter to confirm", "Esc to go back"],
};

const NAV_GLYPH = "\u2191/\u2193";
const NAV_PLAIN = "up/down";
const SEP_GLYPH = " \u00b7 ";
const SEP_PLAIN = " - ";

const ARROWS: Record<string, KeyName> = {
  A: "up",
  B: "down",
  C: "right",
  D: "left",
};

export function keyBar(kind: "select" | "multiselect" | "confirm", utf8 = true): string {
  const nav = utf8 ? NAV_GLYPH : NAV_PLAIN;
  const sep = utf8 ? SEP_GLYPH : SEP_PLAIN;
  return KEYS[kind].map((part) => part.replace("{nav}", nav)).join(sep);
}

function isCsiFinal(code: number): boolean {
  return code >= 0x40 && code <= 0x7e;
}

/**
 * Consume one logical keypress from the front of `buffer`.
 * `key: null` means the buffer is an unfinished Escape, CSI, or SS3 sequence:
 * nothing was consumed, and the caller must wait for more bytes or a timeout.
 */
export function consumeKeySequence(buffer: string): { key: KeyName | null; rest: string } {
  if (buffer.length === 0) {
    throw new CancelledError("End of input");
  }
  const first = buffer[0];
  if (first === "\x03") {
    throw new CancelledError("Cancelled by user");
  }
  if (first === "\x1b") {
    if (buffer.length === 1) {
      return { key: null, rest: buffer };
    }
    const intro = buffer[1]!;
    if (intro === "\x03") {
      throw new CancelledError("Cancelled by user");
    }
    if (intro === "[") {
      if (buffer.length === 2) return { key: null, rest: buffer };
      let body = "";
      for (let i = 2; i < buffer.length; i++) {
        const ch = buffer[i]!;
        if (ch === "\x03") throw new CancelledError("Cancelled by user");
        const code = ch.charCodeAt(0);
        if (isCsiFinal(code)) {
          body += ch;
          return { key: ARROWS[body] ?? "unknown", rest: buffer.slice(i + 1) };
        }
        if (code >= 0x20 && code <= 0x3f) {
          body += ch;
          continue;
        }
        return { key: "unknown", rest: buffer.slice(i) };
      }
      return { key: null, rest: buffer };
    }
    if (intro === "O") {
      if (buffer.length < 3) return { key: null, rest: buffer };
      const code = buffer[2]!;
      if (code === "\x03") throw new CancelledError("Cancelled by user");
      return { key: ARROWS[code] ?? "unknown", rest: buffer.slice(3) };
    }
    return { key: "unknown", rest: buffer.slice(2) };
  }
  if (first === "\r" || first === "\n") {
    const rest = first === "\r" && buffer[1] === "\n" ? buffer.slice(2) : buffer.slice(1);
    return { key: "enter", rest };
  }
  if (first === " ") {
    return { key: "space", rest: buffer.slice(1) };
  }
  return { key: "unknown", rest: buffer.slice(1) };
}

/** A quiet stdin after an unfinished sequence. Lone Escape is Esc; a partial CSI or SS3 is not. */
function expireIncompleteKey(buffer: string): { key: KeyName; rest: string } {
  if (buffer === "\x1b") return { key: "esc", rest: "" };
  return { key: "unknown", rest: "" };
}

export function decodeKeyChunk(chunk: string): KeyName {
  const parsed = consumeKeySequence(chunk);
  if (parsed.key !== null) return parsed.key;
  return expireIncompleteKey(chunk).key;
}

/**
 * Replay raw reads. `null` means the escape timeout fired before another byte.
 * A trailing unfinished sequence is resolved the same way, as if the stream then went quiet.
 */
export function decodeKeyReads(reads: readonly (string | null)[]): KeyName[] {
  let pending = "";
  const keys: KeyName[] = [];

  const drain = (): void => {
    for (;;) {
      if (pending.length === 0) return;
      const parsed = consumeKeySequence(pending);
      if (parsed.key === null) return;
      keys.push(parsed.key);
      pending = parsed.rest;
    }
  };

  const flushQuiet = (): void => {
    if (pending.length === 0) return;
    const expired = expireIncompleteKey(pending);
    keys.push(expired.key);
    pending = expired.rest;
    drain();
  };

  for (const read of reads) {
    if (read === null) {
      flushQuiet();
      continue;
    }
    pending += read;
    drain();
  }
  flushQuiet();
  return keys;
}

const SLEEP_ARRAY = new Int32Array(new SharedArrayBuffer(4));
let pendingRawBytes = "";

// Lone Escape and the rest of a CSI or SS3 sequence may arrive in a later read.
// The wait ends on EAGAIN. libuv leaves process.stdin non-blocking.
const ESC_SEQUENCE_TIMEOUT_MS = 50;

function readErrorCode(err: unknown): string {
  if (err && typeof err === "object" && "code" in err) {
    return String((err as { code?: unknown }).code);
  }
  return "";
}

/** `null` means `timeoutMs` passed with no byte. `timeoutMs` null waits until a byte or EOF. */
function readStdinChunk(timeoutMs: number | null): string | null {
  const buf = Buffer.alloc(64);
  const started = Date.now();
  for (;;) {
    try {
      const n = readSync(0, buf, 0, buf.length, null);
      if (n <= 0) throw new CancelledError("End of input");
      return buf.subarray(0, n).toString("latin1");
    } catch (err) {
      if (err instanceof CancelledError) throw err;
      const code = readErrorCode(err);
      if (code === "EAGAIN" || code === "EWOULDBLOCK" || code === "EINTR") {
        const elapsed = Date.now() - started;
        if (timeoutMs !== null && elapsed >= timeoutMs) return null;
        const wait = timeoutMs === null ? 10 : Math.max(1, Math.min(10, timeoutMs - elapsed));
        Atomics.wait(SLEEP_ARRAY, 0, 0, wait);
        continue;
      }
      throw new CancelledError("End of input");
    }
  }
}

export function readRawKeyFromStdin(): KeyName {
  const stdin = process.stdin;
  const canRaw = Boolean(stdin.isTTY && typeof stdin.setRawMode === "function");
  if (canRaw) {
    stdin.setRawMode(true);
  }
  try {
    for (;;) {
      if (pendingRawBytes.length > 0) {
        try {
          const parsed = consumeKeySequence(pendingRawBytes);
          if (parsed.key !== null) {
            pendingRawBytes = parsed.rest;
            return parsed.key;
          }
        } catch (err) {
          pendingRawBytes = "";
          throw err;
        }
      }
      let chunk: string | null = null;
      try {
        chunk = readStdinChunk(pendingRawBytes.length > 0 ? ESC_SEQUENCE_TIMEOUT_MS : null);
      } catch (err) {
        pendingRawBytes = "";
        throw err;
      }
      if (chunk === null) {
        const expired = expireIncompleteKey(pendingRawBytes);
        pendingRawBytes = expired.rest;
        return expired.key;
      }
      pendingRawBytes += chunk;
    }
  } finally {
    if (canRaw) {
      stdin.setRawMode(false);
    }
  }
}

/**
 * Run steps in order. BackError on a later step returns to the previous one.
 * BackError on the first step, and every CancelledError, propagate to the caller.
 */
export function askInOrder(steps: readonly (() => void)[]): void {
  let index = 0;
  while (index < steps.length) {
    try {
      steps[index]!();
      index += 1;
    } catch (err) {
      if (err instanceof BackError) {
        if (index === 0) throw err;
        index -= 1;
        continue;
      }
      throw err;
    }
  }
}

function selectRaw(
  question: string,
  options: readonly PromptOption[],
  defaultIndex: number,
  io: PromptStream,
): number {
  let current = Math.max(0, Math.min(defaultIndex, options.length - 1));
  const bar = keyBar("select", io.utf8 ?? true);
  let linesRendered = 0;

  io.write("\x1b[?25l");
  try {
    for (;;) {
      if (linesRendered > 0) {
        io.write(`\x1b[${linesRendered}A\x1b[0J`);
      }

      const outLines: string[] = [question];
      for (let i = 0; i < options.length; i++) {
        const opt = options[i]!;
        const cursor = i === current ? ">" : " ";
        const marker = i === current ? "(*)" : "( )";
        const suffix = opt.consequence ? ` - ${opt.consequence}` : "";
        const avail = opt.available ? "" : " (unavailable)";
        outLines.push(`${cursor} ${marker} ${opt.label}${suffix}${avail}`);
      }
      outLines.push("");
      outLines.push(bar);

      io.write(outLines.join("\n") + "\n");
      linesRendered = outLines.length;

      const key = io.readKey();
      if (key === "up") {
        current = (current - 1 + options.length) % options.length;
      } else if (key === "down") {
        current = (current + 1) % options.length;
      } else if (key === "enter") {
        if (options[current]?.available) {
          return current;
        }
      } else if (key === "esc") {
        throw new BackError();
      }
    }
  } finally {
    io.write("\x1b[?25h\n");
  }
}

function multiselectRaw(
  question: string,
  options: readonly PromptOption[],
  preselected: readonly number[],
  io: PromptStream,
): number[] {
  let current = 0;
  const selected = new Set<number>(
    preselected.filter((i) => i >= 0 && i < options.length && options[i]?.available),
  );
  const bar = keyBar("multiselect", io.utf8 ?? true);
  let linesRendered = 0;

  io.write("\x1b[?25l");
  try {
    for (;;) {
      if (linesRendered > 0) {
        io.write(`\x1b[${linesRendered}A\x1b[0J`);
      }

      const outLines: string[] = [question];
      for (let i = 0; i < options.length; i++) {
        const opt = options[i]!;
        const cursor = i === current ? ">" : " ";
        const marker = selected.has(i) ? "[x]" : "[ ]";
        const suffix = opt.consequence ? ` - ${opt.consequence}` : "";
        const avail = opt.available ? "" : " (unavailable)";
        outLines.push(`${cursor} ${marker} ${opt.label}${suffix}${avail}`);
      }
      outLines.push("");
      outLines.push(bar);

      io.write(outLines.join("\n") + "\n");
      linesRendered = outLines.length;

      const key = io.readKey();
      if (key === "up") {
        current = (current - 1 + options.length) % options.length;
      } else if (key === "down") {
        current = (current + 1) % options.length;
      } else if (key === "space") {
        if (options[current]?.available) {
          if (selected.has(current)) {
            selected.delete(current);
          } else {
            selected.add(current);
          }
        }
      } else if (key === "enter") {
        return Array.from(selected).sort((a, b) => a - b);
      } else if (key === "esc") {
        throw new BackError();
      }
    }
  } finally {
    io.write("\x1b[?25h\n");
  }
}

function selectNumbered(
  question: string,
  options: readonly PromptOption[],
  defaultIndex: number,
  io: PromptStream,
): number {
  io.write(`${question}\n`);
  for (let i = 0; i < options.length; i++) {
    const opt = options[i]!;
    const suffix = opt.consequence ? ` - ${opt.consequence}` : "";
    const avail = opt.available ? "" : " (unavailable)";
    io.write(`  ${i + 1}) ${opt.label}${suffix}${avail}\n`);
  }
  const defaultDisplay =
    defaultIndex >= 0 && defaultIndex < options.length ? ` [${defaultIndex + 1}]` : "";
  const promptLine = `Choice (1 to ${options.length})${defaultDisplay}: `;
  for (;;) {
    io.write(promptLine);
    const raw = io.readLine();
    const line = raw.trim();
    if (line === "") {
      if (defaultIndex >= 0 && defaultIndex < options.length && options[defaultIndex]?.available) {
        return defaultIndex;
      }
      throw new CancelledError("End of input");
    }
    const lower = line.toLowerCase();
    if ((lower === "y" || lower === "yes") && options[0]?.available) {
      return 0;
    }
    if ((lower === "n" || lower === "no") && options[1]?.available) {
      return 1;
    }
    const num = Number.parseInt(line, 10);
    if (!Number.isNaN(num) && num >= 1 && num <= options.length) {
      const idx = num - 1;
      if (!options[idx]?.available) {
        io.write(`Option ${num} is not available. Choose another.\n`);
        continue;
      }
      return idx;
    }
    io.write(`Please enter a number from 1 to ${options.length}.\n`);
  }
}

function multiselectNumbered(
  question: string,
  options: readonly PromptOption[],
  preselected: readonly number[],
  io: PromptStream,
): number[] {
  io.write(`${question}\n`);
  for (let i = 0; i < options.length; i++) {
    const opt = options[i]!;
    const suffix = opt.consequence ? ` - ${opt.consequence}` : "";
    const avail = opt.available ? "" : " (unavailable)";
    io.write(`  ${i + 1}) ${opt.label}${suffix}${avail}\n`);
  }
  const validPre = preselected.filter((i) => i >= 0 && i < options.length && options[i]?.available);
  const defaultDisplay = validPre.length > 0 ? ` [${validPre.map((i) => i + 1).join(",")}]` : "";
  const promptLine = `Choice (comma-separated 1 to ${options.length})${defaultDisplay}: `;
  for (;;) {
    io.write(promptLine);
    const line = io.readLine().trim();
    if (line === "") {
      return validPre;
    }
    if (line.toLowerCase() === "none" || line === "0") {
      return [];
    }
    const parts = line
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    const selected: number[] = [];
    let valid = true;
    for (const part of parts) {
      const num = Number.parseInt(part, 10);
      if (Number.isNaN(num) || num < 1 || num > options.length) {
        valid = false;
        break;
      }
      const idx = num - 1;
      if (!options[idx]?.available) {
        io.write(`Option ${num} is not available.\n`);
        valid = false;
        break;
      }
      if (!selected.includes(idx)) {
        selected.push(idx);
      }
    }
    if (valid) {
      return selected.sort((a, b) => a - b);
    }
    io.write(`Please enter numbers from 1 to ${options.length} separated by commas.\n`);
  }
}

export function select(
  question: string,
  options: readonly PromptOption[],
  defaultIndex: number,
  io: PromptStream,
): number {
  if (io.isTTY) {
    return selectRaw(question, options, defaultIndex, io);
  }
  return selectNumbered(question, options, defaultIndex, io);
}

export function multiselect(
  question: string,
  options: readonly PromptOption[],
  preselected: readonly number[],
  io: PromptStream,
): number[] {
  if (io.isTTY) {
    return multiselectRaw(question, options, preselected, io);
  }
  return multiselectNumbered(question, options, preselected, io);
}

export function confirm(
  question: string,
  defaultYes: boolean,
  io: PromptStream,
  yesConsequence = "",
  noConsequence = "",
): boolean {
  const options: PromptOption[] = [
    { label: "Yes", consequence: yesConsequence, available: true },
    { label: "No", consequence: noConsequence, available: true },
  ];
  const chosen = select(question, options, defaultYes ? 0 : 1, io);
  return chosen === 0;
}
