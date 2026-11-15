import { readSync } from "fs";

export class CancelledError extends Error {
  constructor(message = "Cancelled by user") {
    super(message);
    this.name = "CancelledError";
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
 * Decode a raw keypress buffer into a logical KeyName.
 * Separated from terminal I/O so escape-sequence handling is unit-testable.
 */
export function decodeKeyChunk(chunk: string): KeyName {
  if (chunk.length === 0) {
    throw new CancelledError("End of input");
  }
  const first = chunk[0];
  if (first === "\x03") {
    throw new CancelledError("Cancelled by user");
  }
  if (first === "\x1b") {
    if (chunk.length === 1) {
      return "esc";
    }
    const intro = chunk[1];
    if (intro === "[") {
      let body = "";
      for (let i = 2; i < chunk.length; i++) {
        const ch = chunk[i]!;
        body += ch;
        if (isCsiFinal(ch.charCodeAt(0))) {
          break;
        }
      }
      return ARROWS[body] ?? "unknown";
    }
    if (intro === "O") {
      const code = chunk[2] ?? "";
      return ARROWS[code] ?? "unknown";
    }
    return "unknown";
  }
  if (first === "\r" || first === "\n") {
    return "enter";
  }
  if (first === " ") {
    return "space";
  }
  return "unknown";
}

const SLEEP_ARRAY = new Int32Array(new SharedArrayBuffer(4));

export function readRawKeyFromStdin(): KeyName {
  const stdin = process.stdin;
  const canRaw = Boolean(stdin.isTTY && typeof stdin.setRawMode === "function");
  if (canRaw) {
    stdin.setRawMode(true);
  }
  try {
    const buf = Buffer.alloc(64);
    let bytesRead = 0;
    for (;;) {
      try {
        bytesRead = readSync(0, buf, 0, buf.length, null);
        break;
      } catch (err) {
        const code =
          err && typeof err === "object" && "code" in err
            ? String((err as { code?: unknown }).code)
            : "";
        if (code === "EAGAIN" || code === "EWOULDBLOCK" || code === "EINTR") {
          Atomics.wait(SLEEP_ARRAY, 0, 0, 10);
          continue;
        }
        bytesRead = 0;
        break;
      }
    }
    if (bytesRead <= 0) {
      throw new CancelledError("End of input");
    }
    return decodeKeyChunk(buf.subarray(0, bytesRead).toString("latin1"));
  } finally {
    if (canRaw) {
      stdin.setRawMode(false);
    }
  }
}

/**
 * Run interactive steps in order. Pressing Esc on step N > 0 returns to step N - 1;
 * pressing Esc on step 0 rethrows CancelledError to abort the wizard.
 */
export function askInOrder(steps: readonly (() => void)[]): void {
  let index = 0;
  while (index < steps.length) {
    try {
      steps[index]!();
      index += 1;
    } catch (err) {
      if (err instanceof CancelledError) {
        if (index === 0) {
          throw err;
        }
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
        throw new CancelledError("Cancelled by user");
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
        throw new CancelledError("Cancelled by user");
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
