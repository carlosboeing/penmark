/**
 * Penmark marker well-formedness parser + degradation-ladder classifier.
 *
 * This is the spike's prototype parser (`spikes/anchor-torture-test/src/parse.mjs`),
 * graduated to a typed, strict-TypeScript test utility for the T11 formatter
 * golden gate. It is TEST INFRASTRUCTURE only — the production reconcile parser
 * is TDD'd fresh in v0.5. Behaviour is kept faithful to parse.mjs, which the
 * P0.1 spike ratified (`docs/1-discovery/2026-06-12-anchor-torture-test-spike.md`).
 *
 * Grammar under test (spec/penmark-format.md §4, ADR 0006):
 *   span pair : <!--pmk:s ID-->text<!--/pmk:s ID-->
 *   block     : <!--pmk:b ID-->            (own line, before a block)
 *   range pair: <!--pmk:r ID o--> … <!--pmk:r ID c-->
 *   entry     : <!--pmk:c ID\n<author> (human|agent) · <ts>\n> quote…\n\nbody\n-->
 *   review    : <!-- pmk:review v1 --> … <!-- /pmk:review -->
 *   IDs are RFC 4648 lowercase base32: [a-z2-7]{8}
 */

/** RFC 4648 lowercase base32 ID, exactly 8 chars. */
const ID = "[a-z2-7]{8}";

/** Regexes for each recognized `pmk:` token. Global flag — callers reset lastIndex. */
const RE = {
  spanOpen: new RegExp(`<!--pmk:s (${ID})-->`, "g"),
  spanClose: new RegExp(`<!--/pmk:s (${ID})-->`, "g"),
  block: new RegExp(`<!--pmk:b (${ID})-->`, "g"),
  range: new RegExp(`<!--pmk:r (${ID}) ([oc])-->`, "g"),
  entry: new RegExp(`<!--pmk:c (${ID})(?: re (${ID}))?\\n([\\s\\S]*?)-->`, "g"),
  reviewOpen: /<!-- pmk:review v1 -->/g,
  reviewClose: /<!-- \/pmk:review -->/g,
} as const;

/** Decode the `&#45;&#45;` escape used to carry literal `--` inside HTML comments. */
const decode = (s: string): string => s.replaceAll("&#45;&#45;", "--");

function allMatches(re: RegExp, text: string): RegExpMatchArray[] {
  re.lastIndex = 0;
  return [...text.matchAll(re)];
}

/** A `pmk:b` block anchor and whether it occupies its own line (a §4 requirement). */
export interface BlockInfo {
  readonly ownLine: boolean;
}

/** The two endpoints of a `pmk:r` range pair, by source offset. */
export interface RangeInfo {
  o?: number;
  c?: number;
}

/** A `pmk:c` review entry: its first metadata line, advisory quote, and parent (for `re`). */
export interface EntryInfo {
  readonly meta: string;
  readonly quote: string;
  readonly parent: string | null;
}

/** Result of {@link parseDoc}: every recognized token plus review-block and residue checks. */
export interface ParsedDoc {
  /** span opener id -> source offset */
  readonly spanOpens: Map<string, number>;
  /** span closer id -> source offset */
  readonly spanCloses: Map<string, number>;
  readonly blocks: Map<string, BlockInfo>;
  readonly ranges: Map<string, RangeInfo>;
  readonly entries: Map<string, EntryInfo>;
  /** Exactly one review open and one review close present. */
  readonly reviewPresent: boolean;
  /** The single review close is the last non-whitespace content in the file. */
  readonly reviewAtEof: boolean;
  /** Context snippets for any `pmk:` residue outside a recognized token (mangled markers). */
  readonly malformed: string[];
  readonly lineCount: number;
}

/**
 * Parse every `pmk:` token in a document and flag any `pmk:` residue that falls
 * outside a recognized token (a mangled / malformed marker).
 */
export function parseDoc(text: string): ParsedDoc {
  const consumed: Array<readonly [number, number]> = []; // [start, end) of every recognized token
  const note = (m: RegExpMatchArray): void => {
    const i = m.index ?? 0;
    consumed.push([i, i + m[0].length]);
  };

  const spanOpens = new Map<string, number>();
  for (const m of allMatches(RE.spanOpen, text)) {
    spanOpens.set(m[1] as string, m.index ?? 0);
    note(m);
  }
  const spanCloses = new Map<string, number>();
  for (const m of allMatches(RE.spanClose, text)) {
    spanCloses.set(m[1] as string, m.index ?? 0);
    note(m);
  }

  const lines = text.split("\n");
  const blocks = new Map<string, BlockInfo>();
  for (const m of allMatches(RE.block, text)) {
    const idx = m.index ?? 0;
    const lineStart = text.lastIndexOf("\n", idx) + 1;
    const lineEnd = text.indexOf("\n", idx);
    const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
    blocks.set(m[1] as string, { ownLine: line.trim() === m[0] });
    note(m);
  }

  const ranges = new Map<string, RangeInfo>();
  for (const m of allMatches(RE.range, text)) {
    const id = m[1] as string;
    const end = m[2] as "o" | "c";
    const r = ranges.get(id) ?? {};
    r[end] = m.index ?? 0;
    ranges.set(id, r);
    note(m);
  }

  const entries = new Map<string, EntryInfo>();
  for (const m of allMatches(RE.entry, text)) {
    const inner = m[3] as string;
    const innerLines = inner.split("\n");
    const meta = innerLines[0] ?? "";
    const quote = decode(
      innerLines
        .filter((l) => l.startsWith("> "))
        .map((l) => l.slice(2))
        .join("\n"),
    );
    entries.set(m[1] as string, { meta, quote, parent: m[2] ?? null });
    note(m);
  }

  const reviewOpens = allMatches(RE.reviewOpen, text);
  const reviewCloses = allMatches(RE.reviewClose, text);
  for (const m of [...reviewOpens, ...reviewCloses]) note(m);
  const reviewPresent = reviewOpens.length === 1 && reviewCloses.length === 1;
  const lastClose = reviewCloses[0];
  const reviewAtEof =
    reviewCloses.length === 1 &&
    lastClose !== undefined &&
    text.slice((lastClose.index ?? 0) + lastClose[0].length).trim() === "";

  // Any "pmk:" residue outside a recognized token = a mangled marker.
  const malformed: string[] = [];
  for (const m of allMatches(/pmk:/g, text)) {
    const idx = m.index ?? 0;
    if (!consumed.some(([s, e]) => idx >= s && idx < e)) {
      const ctxStart = Math.max(0, idx - 30);
      malformed.push(text.slice(ctxStart, idx + 30).replaceAll("\n", "\\n"));
    }
  }

  return {
    spanOpens,
    spanCloses,
    blocks,
    ranges,
    entries,
    reviewPresent,
    reviewAtEof,
    malformed,
    lineCount: lines.length,
  };
}

/** Where an anchor's `pmk:c` entry is anchored in the document. */
export type AnchorType = "span" | "block" | "range" | "unanchored";

/** Per the ADR 0006 degradation ladder. */
export type AnchorState = "intact" | "degraded-recovered" | "orphan" | "corruption";

/** Classification of a single pristine anchor against a mutated document. */
export interface AnchorResult {
  readonly id: string;
  readonly type: AnchorType;
  readonly state: AnchorState;
  /** Whether the anchor's `pmk:c` entry still exists in the mutated doc. */
  readonly entryPresent: boolean;
  readonly flags: string[];
}

/** Result of {@link classify}: per-anchor ladder states plus doc-level review/residue checks. */
export interface ClassifyResult {
  readonly anchors: AnchorResult[];
  readonly doc: {
    readonly reviewPresent: boolean;
    readonly reviewAtEof: boolean;
    readonly malformed: string[];
  };
}

const normWs = (s: string): string => s.replaceAll(/\s+/g, " ").trim();

/** Classify every pristine anchor against the mutated doc per the ADR 0006 ladder. */
export function classify(pristineText: string, mutatedText: string): ClassifyResult {
  const p = parseDoc(pristineText);
  const m = parseDoc(mutatedText);
  const results: AnchorResult[] = [];

  for (const [id, entry] of p.entries) {
    const type: AnchorType = p.spanOpens.has(id)
      ? "span"
      : p.blocks.has(id)
        ? "block"
        : p.ranges.has(id)
          ? "range"
          : "unanchored";
    let state: AnchorState;
    const flags: string[] = [];

    if (type === "span") {
      const open = m.spanOpens.get(id);
      const close = m.spanCloses.get(id);
      if (open !== undefined && close !== undefined && open < close) {
        state = "intact";
      } else if (open !== undefined) {
        state =
          entry.quote && normWs(mutatedText).includes(normWs(entry.quote))
            ? "degraded-recovered"
            : "orphan";
        flags.push("closer-destroyed");
      } else {
        state = "orphan";
        if (close !== undefined) flags.push("stray-closer");
      }
    } else if (type === "block") {
      const b = m.blocks.get(id);
      if (b) state = b.ownLine ? "intact" : "corruption";
      else state = "orphan";
      if (b && !b.ownLine) flags.push("marker-not-own-line");
    } else if (type === "range") {
      const r = m.ranges.get(id) ?? {};
      if (r.o !== undefined && r.c !== undefined && r.o < r.c) {
        state = "intact";
      } else {
        state = "orphan";
        if (r.o !== undefined || r.c !== undefined) flags.push("half-pair-stray");
      }
    } else {
      state = "orphan";
      flags.push("no-anchor-in-pristine");
    }

    results.push({ id, type, state, entryPresent: m.entries.has(id), flags });
  }

  return {
    anchors: results,
    doc: {
      reviewPresent: m.reviewPresent,
      reviewAtEof: m.reviewAtEof,
      malformed: m.malformed,
    },
  };
}
