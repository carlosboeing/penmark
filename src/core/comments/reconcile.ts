/**
 * Read-only reconcile engine — the degradation ladder (spec §8). Pure,
 * `vscode`-free.
 *
 * Given the raw document `text` and the {@link ParsedDoc} produced by
 * {@link parseDoc}, {@link reconcile} classifies every live entry against the
 * CURRENT document and surfaces what the user needs to act on. It is
 * **read-only by default** (spec §8, D13): it returns data only and NEVER
 * produces edits — its return type carries no `TextEdit`. Structural repairs
 * (relocating a misplaced review block, stripping stray closers, re-anchoring)
 * happen only on an explicit user action handled elsewhere (§8.5).
 *
 * The ladder, per spec §8:
 *   - Span (§8.1): opener before closer → `intact` (or `content-removed` when
 *     the markers are adjacent / the extent is empty, §8.3); opener only →
 *     §8.2 closer-destroyed fallback: whitespace-normalized quote match against
 *     the document, nearest-to-opener on multiple matches → `degraded-recovered`,
 *     else `orphan`; opener absent → `orphan` (with a `stray-closer` flag if a
 *     lone closer remains).
 *   - Block (§8.4): present on its own line → `intact`; present but not on its
 *     own line → `orphan` + `marker-not-own-line` (corruption surfacing, not a
 *     live highlight); absent → `orphan`.
 *   - Range (§8.4): both sides, `o` before `c` → `intact`; one side → `orphan`
 *     + `half-pair`; both absent → `orphan`.
 *   - Review block not at EOF → `reviewBlockMisplaced`; more than one block →
 *     `secondReviewBlock` (§5.1, §8.5).
 *
 * v2 reply entries (` re <parent-id>`, §5.3) are parsed-but-ignored in v1: they
 * are reconciled as ordinary entries — no threading, no reply collapse. The
 * parser already exposes `parentId`; reconcile does not act on it.
 */

import type { SourceRange } from "./placement.js";
import type { CommentState, ParsedAnchor, ParsedDoc, ParsedEntry } from "./types.js";

/** A reconcile flag: a non-fatal signal attached to a classified comment. */
export type ReconcileFlag =
  | "stray-closer"
  | "closer-destroyed"
  | "half-pair"
  | "marker-not-own-line";

/** One entry classified against the current document (spec §8). */
export interface ReconciledComment {
  entry: ParsedEntry;
  anchor?: ParsedAnchor;
  /** intact | content-removed | degraded-recovered | orphan (spec §8). */
  state: CommentState;
  /** Char range to highlight; undefined for orphan (and for unrecoverable spans). */
  extent?: SourceRange;
  /** Non-fatal signals; see {@link ReconcileFlag}. Empty for a clean comment. */
  flags: ReconcileFlag[];
}

/** The full reconcile result. Data only — never edits (read-only, §8). */
export interface ReconcileResult {
  /** Every live entry, classified, in document (append) order. */
  comments: ReconciledComment[];
  /** orphan + content-removed comments (the drawer's "needs attention"). */
  needsAttention: ReconciledComment[];
  /** Lone span closers and lone range halves with no live opener (§8.5). */
  strayClosers: { id: string; index: number }[];
  /** Review block present but not at EOF (§5.1) — relocate on user action. */
  reviewBlockMisplaced: boolean;
  /** More than one review block in the document (§9 corruption surfacing). */
  secondReviewBlock: boolean;
  /** needsAttention.length + corruption signals; drives the attention chip. */
  attentionCount: number;
}

const ID = "[a-z2-7]{8}";
const SPAN_CLOSE_RE = new RegExp(`<!--/pmk:s (${ID})-->`, "g");
const RANGE_RE = new RegExp(`<!--pmk:r (${ID}) ([oc])-->`, "g");
const BLOCK_RE = new RegExp(`<!--pmk:b (${ID})-->`, "g");

/** Scan `text` for every `<!--/pmk:s ID-->` closer, grouped by id. */
function scanSpanClosers(text: string): Map<string, number[]> {
  return scanByIdWithSide(text, SPAN_CLOSE_RE, () => true);
}

/** Scan `text` for `<!--pmk:r ID o|c-->` markers of one side, grouped by id. */
function scanRangeSide(text: string, side: "o" | "c"): Map<string, number[]> {
  return scanByIdWithSide(text, RANGE_RE, (m) => m[2] === side);
}

function scanByIdWithSide(
  text: string,
  re: RegExp,
  keep: (m: RegExpExecArray) => boolean,
): Map<string, number[]> {
  const out = new Map<string, number[]>();
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (!keep(m)) continue;
    const id = m[1] ?? "";
    const list = out.get(id) ?? [];
    list.push(m.index);
    out.set(id, list);
  }
  return out;
}

/**
 * Find block markers for `id` that exist in the text but were rejected by the
 * parser as not-own-line (and therefore have no live anchor). Returns their
 * char offsets. A block marker that IS own-line becomes a live anchor and never
 * reaches this path (the entry resolves to its anchor instead).
 */
function notOwnLineBlockMarkers(text: string, id: string): number[] {
  const out: number[] = [];
  BLOCK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BLOCK_RE.exec(text)) !== null) {
    if ((m[1] ?? "") !== id) continue;
    if (!isOwnLine(text, m.index, m.index + m[0].length)) out.push(m.index);
  }
  return out;
}

/** True iff the marker at [start,end) is the only non-whitespace on its line. */
function isOwnLine(text: string, start: number, end: number): boolean {
  let lineStart = start;
  while (lineStart > 0 && text.charAt(lineStart - 1) !== "\n") lineStart--;
  let lineEnd = end;
  while (lineEnd < text.length && text.charAt(lineEnd) !== "\n") lineEnd++;
  return text.slice(lineStart, start).trim() === "" && text.slice(end, lineEnd).trim() === "";
}

/** Line number (0-indexed) of `pos`, for nearest-match tie-breaking (§8.2). */
function lineOf(text: string, pos: number): number {
  let line = 0;
  const limit = Math.min(Math.max(pos, 0), text.length);
  for (let i = 0; i < limit; i++) {
    if (text.charAt(i) === "\n") line++;
  }
  return line;
}

/**
 * Recover a destroyed-closer span's extent by matching its advisory quote
 * (whitespace-normalized) against the document (§8.2). Returns the matched
 * char range, or null when the quote is empty or no longer matches.
 *
 * Whitespace normalization: any run of whitespace in the quote matches any run
 * of whitespace in the document. We build a regex from the quote where each
 * whitespace run becomes `\s+` and every other char is escaped literally, then
 * collect all matches and pick the one nearest to the surviving opener by line
 * distance (ties: the earliest such match).
 */
function recoverByQuote(
  text: string,
  quote: string,
  openerStart: number,
  searchEnd: number,
): SourceRange | null {
  const normalized = quote.trim();
  if (normalized === "") return null;
  const pattern = normalized
    .split(/\s+/)
    .map((tok) => tok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  const re = new RegExp(pattern, "g");
  const openerLine = lineOf(text, openerStart);

  let best: SourceRange | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    // Quote matching is over the document BODY only — the advisory quote text
    // also lives verbatim inside the entry's `> ` lines, which must never be
    // mistaken for the recovered extent (§5.2.2: the quote is advisory context).
    if (start >= searchEnd) break;
    const distance = Math.abs(lineOf(text, start) - openerLine);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { start, end };
    }
    if (m[0].length === 0) re.lastIndex++; // guard against zero-width loops
  }
  return best;
}

export function reconcile(text: string, doc: ParsedDoc): ReconcileResult {
  const spanClosers = scanSpanClosers(text);
  const liveOpenerIds = collectLiveSpanOpenerIds(doc);

  // Quote recovery (§8.2) searches the document body only — never the review
  // block, where the advisory quote text also appears verbatim.
  const bodyEnd = doc.review !== null ? doc.review.start : text.length;

  const comments: ReconciledComment[] = [];
  for (const entry of doc.entries) {
    comments.push(classify(text, doc, entry, spanClosers, bodyEnd));
  }

  const needsAttention = comments.filter(
    (c) =>
      c.state === "orphan" ||
      c.state === "content-removed" ||
      c.entry.fromExtraReviewBlock === true,
  );

  const strayClosers = collectStrayClosers(text, spanClosers, liveOpenerIds, doc);

  const reviewBlockMisplaced = doc.review !== null && !doc.review.atEof;
  const secondReviewBlock = doc.reviewCount > 1;

  // The chip aggregates everything the user must act on: every needs-attention
  // comment, every stray closer/half not tied to a live entry, and the two
  // document-level corruption signals.
  const attentionCount =
    needsAttention.length +
    strayClosers.length +
    (reviewBlockMisplaced ? 1 : 0) +
    (secondReviewBlock ? 1 : 0);

  return {
    comments,
    needsAttention,
    strayClosers,
    reviewBlockMisplaced,
    secondReviewBlock,
    attentionCount,
  };
}

/** Ids of every live span opener (anchors whose kind is span) in the doc. */
function collectLiveSpanOpenerIds(doc: ParsedDoc): Set<string> {
  const ids = new Set<string>();
  for (const a of doc.anchors.values()) {
    if (a.kind === "span") ids.add(a.id);
  }
  return ids;
}

/** Classify a single entry against the current document (the ladder, §8). */
function classify(
  text: string,
  doc: ParsedDoc,
  entry: ParsedEntry,
  spanClosers: Map<string, number[]>,
  bodyEnd: number,
): ReconciledComment {
  const anchor = doc.anchors.get(entry.id);

  if (anchor !== undefined) {
    if (anchor.kind === "span") return classifyLiveSpan(text, entry, anchor, bodyEnd);
    // Block (own-line) and range (both sides matched) anchors are intact: the
    // parser only records them when well-formed.
    return { entry, anchor, state: "intact", extent: anchorExtent(anchor), flags: [] };
  }

  // No live anchor: opener/block/range absent or rejected by the parser.
  return classifyOrphanOrigin(text, entry, spanClosers);
}

/** A live span anchor: intact, content-removed (§8.3), or §8.2 fallback. */
function classifyLiveSpan(
  text: string,
  entry: ParsedEntry,
  anchor: ParsedAnchor,
  bodyEnd: number,
): ReconciledComment {
  if (anchor.closerStart !== undefined) {
    // Both markers present. Empty extent → content removed (§8.3).
    const start = anchor.extentStart as number;
    const end = anchor.extentEnd as number;
    if (start === end) {
      return { entry, anchor, state: "content-removed", extent: { start, end }, flags: [] };
    }
    return { entry, anchor, state: "intact", extent: { start, end }, flags: [] };
  }

  // Opener present, closer destroyed → §8.2 advisory-quote fallback.
  const recovered = recoverByQuote(text, entry.quote, anchor.openerStart, bodyEnd);
  if (recovered !== null) {
    return {
      entry,
      anchor,
      state: "degraded-recovered",
      extent: recovered,
      flags: ["closer-destroyed"],
    };
  }
  return { entry, anchor, state: "orphan", flags: ["closer-destroyed"] };
}

/**
 * No live anchor for this entry. Determine WHY so the right flag surfaces:
 * a lone span closer (stray-closer), a block marker not on its own line
 * (marker-not-own-line), a range half-pair (half-pair), or nothing left
 * (plain orphan).
 */
function classifyOrphanOrigin(
  text: string,
  entry: ParsedEntry,
  spanClosers: Map<string, number[]>,
): ReconciledComment {
  const flags: ReconcileFlag[] = [];

  if ((spanClosers.get(entry.id)?.length ?? 0) > 0) flags.push("stray-closer");
  if (notOwnLineBlockMarkers(text, entry.id).length > 0) flags.push("marker-not-own-line");
  if (hasRangeHalf(text, entry.id)) flags.push("half-pair");

  return { entry, state: "orphan", flags };
}

/** The highlight extent for a live anchor (block has none → its marker span). */
function anchorExtent(anchor: ParsedAnchor): SourceRange {
  if (anchor.extentStart !== undefined && anchor.extentEnd !== undefined) {
    return { start: anchor.extentStart, end: anchor.extentEnd };
  }
  // Block anchor: no between-markers extent; the marker position locates it.
  return { start: anchor.openerStart, end: anchor.openerEnd };
}

/** True iff a range opener or closer for `id` exists anywhere in the text. */
function hasRangeHalf(text: string, id: string): boolean {
  RANGE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RANGE_RE.exec(text)) !== null) {
    if ((m[1] ?? "") === id) return true;
  }
  return false;
}

/**
 * Stray closers (§8.5): span closers with no live opener, plus range halves
 * (either side) whose id has no live range anchor. Reported as `{id, index}` at
 * the marker's char offset, in document order.
 */
function collectStrayClosers(
  text: string,
  spanClosers: Map<string, number[]>,
  liveSpanOpeners: Set<string>,
  doc: ParsedDoc,
): { id: string; index: number }[] {
  const out: { id: string; index: number }[] = [];

  for (const [id, offsets] of spanClosers) {
    if (liveSpanOpeners.has(id)) continue; // matched to a live opener → not stray
    for (const index of offsets) out.push({ id, index });
  }

  // Range halves with no live range anchor are strays too (§8.4).
  const liveRangeIds = new Set<string>();
  for (const a of doc.anchors.values()) {
    if (a.kind === "range") liveRangeIds.add(a.id);
  }
  for (const side of ["o", "c"] as const) {
    for (const [id, offsets] of scanRangeSide(text, side)) {
      if (liveRangeIds.has(id)) continue;
      for (const index of offsets) out.push({ id, index });
    }
  }

  out.sort((a, b) => a.index - b.index);
  return out;
}
