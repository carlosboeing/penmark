/**
 * Production format parser for the Penmark comment format (spec §3–§9).
 *
 * `parseDoc` is a pure function: source string in, {@link ParsedDoc} out. It
 * NEVER throws on any input (including the negative fixture) and keeps the
 * well-formed comments intact around any corruption it finds. It scans the
 * document body for anchor markers (§4), detects and parses the review block
 * (§5), and classifies every malformed `pmk:`-shaped construct as corruption
 * (§9). It does NOT apply the §8 degradation ladder — that is the reconcile
 * engine's job; this parser only records the live markers and entries reconcile
 * needs.
 *
 * Corruption rule keys (stable; the conformance test pins these exactly):
 *   §3-invalid-alphabet        — ID slot contains a char outside [a-z2-7]
 *   §3-wrong-length            — ID slot is not exactly 8 chars
 *   §9-stray-closer            — `/pmk:s ID` closer with no matching opener
 *   §8.4-range-half-pair       — range `o` or `c` with no matching opposite half
 *   §4.2-block-not-own-line    — `pmk:b ID` sharing a line with other content
 *   §4-unknown-kind            — kind letter other than s/b/r/c
 *   §5.1-malformed-review-header — header not the exact `<!-- pmk:review v1 -->`
 *   §5.1-second-review-block   — more than one review block in the document
 *   §5.1-unclosed-review-block — authoritative header with no closing delimiter
 *   §5.2-malformed-entry       — a `pmk:c` construct in the review region that
 *                                does not satisfy the §5.2 entry grammar
 *   §9-residue                 — any other `pmk:`-prefixed comment that does not
 *                                parse as a defined marker
 *
 * Line endings: entry parsing is line-ending-agnostic (CRLF tolerated) — see
 * `parseEntry`. The raw document text is never normalized, so all recorded char
 * offsets stay anchored to the original document for the host's WorkspaceEdit.
 */

import { isValidId } from "./ids.js";
import { decodeEntryText } from "./escape.js";
import type {
  CorruptionItem,
  ParsedAnchor,
  ParsedDoc,
  ParsedEntry,
  Provenance,
  ReviewBlockInfo,
} from "./types.js";

export type {
  AnchorKind,
  CommentState,
  CorruptionItem,
  ParsedAnchor,
  ParsedDoc,
  ParsedEntry,
  Provenance,
  ReviewBlockInfo,
} from "./types.js";

const RULE = {
  INVALID_ALPHABET: "§3-invalid-alphabet",
  WRONG_LENGTH: "§3-wrong-length",
  STRAY_CLOSER: "§9-stray-closer",
  RANGE_HALF_PAIR: "§8.4-range-half-pair",
  BLOCK_NOT_OWN_LINE: "§4.2-block-not-own-line",
  UNKNOWN_KIND: "§4-unknown-kind",
  MALFORMED_REVIEW_HEADER: "§5.1-malformed-review-header",
  SECOND_REVIEW_BLOCK: "§5.1-second-review-block",
  UNCLOSED_REVIEW_BLOCK: "§5.1-unclosed-review-block",
  MALFORMED_ENTRY: "§5.2-malformed-entry",
  RESIDUE: "§9-residue",
} as const;

const REVIEW_OPEN = "<!-- pmk:review v1 -->";
const REVIEW_CLOSE = "<!-- /pmk:review -->";

const ID = "[a-z2-7]{8}";

// Live anchor markers — strict (valid IDs only). Capture the id.
const SPAN_OPEN_RE = new RegExp(`<!--pmk:s (${ID})-->`, "g");
const SPAN_CLOSE_RE = new RegExp(`<!--/pmk:s (${ID})-->`, "g");
const BLOCK_RE = new RegExp(`<!--pmk:b (${ID})-->`, "g");
const RANGE_RE = new RegExp(`<!--pmk:r (${ID}) ([oc])-->`, "g");

// Generic pmk: comment scanner for corruption classification. Matches any HTML
// comment whose body — after optional surrounding whitespace — starts with an
// optional `/` then `pmk:`. The body (captured group, trimmed by the caller) is
// non-greedy up to the first `-->`. The optional inner whitespace is what lets
// the sweep see malformed review headers like `<!-- pmk:review v0 -->`, whose
// `<!-- ` … ` -->` spacing differs from the spaceless anchor markers. Used to
// find every construct the strict matchers above did NOT consume.
const PMK_COMMENT_RE = /<!--\s*(\/?pmk:[^>]*?)\s*-->/g;

/** Classify the ID slot of a marker, returning the corruption rule or null. */
function idCorruptionRule(rawId: string): string | null {
  if (rawId.length !== 8) return RULE.WRONG_LENGTH;
  if (!isValidId(rawId)) return RULE.INVALID_ALPHABET;
  return null;
}

/** True iff the marker at [start,end) is the only non-whitespace on its line. */
function isOwnLine(text: string, start: number, end: number): boolean {
  let lineStart = start;
  while (lineStart > 0 && text.charAt(lineStart - 1) !== "\n") lineStart--;
  let lineEnd = end;
  while (lineEnd < text.length && text.charAt(lineEnd) !== "\n") lineEnd++;
  const before = text.slice(lineStart, start);
  const after = text.slice(end, lineEnd);
  return before.trim() === "" && after.trim() === "";
}

interface MatchInfo {
  start: number;
  end: number;
}

function matchAll(re: RegExp, text: string): Array<{ id: string; side?: string; m: MatchInfo }> {
  const out: Array<{ id: string; side?: string; m: MatchInfo }> = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({
      id: m[1] ?? "",
      side: m[2],
      m: { start: m.index, end: m.index + m[0].length },
    });
  }
  return out;
}

/**
 * Locate the authoritative review block. Per §5.1/§8.5 the EOF block is
 * authoritative, so the authoritative header is the LAST `<!-- pmk:review v1 -->`
 * that has a matching `<!-- /pmk:review -->` close after it. If no header is
 * closed, the last header is authoritative but `unclosed` (surfaced as
 * corruption, §9). Returns the block region, all header indices (for the
 * second-review-block check), the authoritative header's index into
 * `headerIndices`, and where the body ends for anchor scanning (the EARLIEST
 * header, so no review block is ever scanned as body).
 */
function locateReview(text: string): {
  info: ReviewBlockInfo | null;
  headerIndices: number[];
  bodyEnd: number;
  authIdx: number;
  unclosed: boolean;
} {
  const headerIndices: number[] = [];
  let idx = text.indexOf(REVIEW_OPEN);
  while (idx !== -1) {
    headerIndices.push(idx);
    idx = text.indexOf(REVIEW_OPEN, idx + REVIEW_OPEN.length);
  }

  if (headerIndices.length === 0) {
    return { info: null, headerIndices, bodyEnd: text.length, authIdx: -1, unclosed: false };
  }

  // Prefer the last header that actually has a closing delimiter after it — a
  // genuinely-closed block must not lose its entries to a later unclosed stray.
  let authIdx = -1;
  let closeIdx = -1;
  for (let i = headerIndices.length - 1; i >= 0; i--) {
    const h = headerIndices[i] as number;
    const c = text.indexOf(REVIEW_CLOSE, h + REVIEW_OPEN.length);
    if (c !== -1) {
      authIdx = i;
      closeIdx = c;
      break;
    }
  }
  let unclosed = false;
  if (authIdx === -1) {
    // No header is closed; the last header is authoritative but unterminated.
    authIdx = headerIndices.length - 1;
    unclosed = true;
  }

  const start = headerIndices[authIdx] as number;
  const end = closeIdx === -1 ? text.length : closeIdx + REVIEW_CLOSE.length;
  const atEof = closeIdx !== -1 && text.slice(end).trim() === "";

  return {
    info: { start, end, atEof },
    headerIndices,
    bodyEnd: headerIndices[0] as number,
    authIdx,
    unclosed,
  };
}

/** Parse one entry HTML comment whose inner text (after `pmk:c `) is `inner`. */
function parseEntry(inner: string, rawStart: number, rawEnd: number): ParsedEntry | null {
  // inner is everything between `<!--pmk:c ` and the terminating `-->`. Strip a
  // trailing CR from each line so CRLF-authored documents (Windows / VS Code
  // `files.eol`) parse identically to LF ones — without this the `$`-anchored
  // meta regex and the blank-separator check would fail on the leftover `\r` and
  // every entry would be silently dropped. Offsets are unaffected (the raw text
  // is never normalized; only the in-memory line content used for parsing).
  const lines = inner.split("\n").map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
  const line1 = lines[0] ?? "";

  // Line 1: ID, optionally ` re <parent-id>` (v2, parsed-but-ignored, §5.3).
  const m1 = /^([a-z2-7]{8})(?: re ([a-z2-7]{8}))?\s*$/.exec(line1);
  if (m1 === null) return null;
  const id = m1[1] as string;
  const parentId = m1[2];

  const line2 = lines[1] ?? "";
  // Meta line: `<author> (human|agent) · <timestamp>`. Split on the LAST
  // provenance tag, then ` · ` separates the tag from the timestamp (§5.2.1).
  const meta =
    /^(.*) \((human|agent)\) · (\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})? [+-]\d{2}:\d{2})$/.exec(
      line2,
    );
  if (meta === null) return null;
  const author = meta[1] as string;
  const provenance = meta[2] as Provenance;
  const timestamp = meta[3] as string;

  // Quote lines: zero or more `> ` lines starting at line 3.
  const quoteLines: string[] = [];
  let i = 2;
  while (i < lines.length && (lines[i] ?? "").startsWith("> ")) {
    quoteLines.push((lines[i] as string).slice(2));
    i++;
  }
  const quote = decodeEntryText(quoteLines.join("\n"));

  // Exactly one blank line separates the quote from the body (§5.2).
  if (i >= lines.length || (lines[i] ?? "") !== "") return null;
  i++;

  // Body: remaining lines to the terminator (trailing blank from the `\n-->`
  // is dropped).
  const bodyLines = lines.slice(i);
  while (bodyLines.length > 0 && (bodyLines[bodyLines.length - 1] ?? "") === "") {
    bodyLines.pop();
  }
  const body = decodeEntryText(bodyLines.join("\n"));

  const entry: ParsedEntry = { id, author, provenance, timestamp, quote, body, rawStart, rawEnd };
  if (parentId !== undefined) entry.parentId = parentId;
  return entry;
}

/**
 * Parse the entries inside the authoritative review block region. A `pmk:c`
 * construct that does not satisfy the §5.2 grammar is NOT silently dropped — it
 * is surfaced as `§5.2-malformed-entry` corruption so the review data lands in
 * the "needs attention" path (§8.5: reconcile MUST NEVER silently discard).
 */
function parseEntries(
  text: string,
  info: ReviewBlockInfo,
  corruption: CorruptionItem[],
): ParsedEntry[] {
  const region = text.slice(info.start, info.end);
  const entries: ParsedEntry[] = [];
  const entryRe = /<!--pmk:c ([\s\S]*?)-->/g;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(region)) !== null) {
    const inner = m[1] ?? "";
    const rawStart = info.start + m.index;
    const rawEnd = rawStart + m[0].length;
    const entry = parseEntry(inner, rawStart, rawEnd);
    if (entry !== null) {
      entries.push(entry);
    } else {
      corruption.push({
        rule: RULE.MALFORMED_ENTRY,
        detail: "pmk:c entry does not satisfy the §5.2 entry grammar",
        index: rawStart,
      });
    }
  }
  return entries;
}

export function parseDoc(text: string): ParsedDoc {
  const anchors = new Map<string, ParsedAnchor>();
  const corruption: CorruptionItem[] = [];

  const { info: review, headerIndices, bodyEnd, authIdx, unclosed } = locateReview(text);
  const body = text.slice(0, bodyEnd);

  // Track which char ranges were consumed by a valid live marker so the generic
  // residue scan can skip them.
  const consumed: Array<[number, number]> = [];
  const markConsumed = (s: number, e: number): void => {
    consumed.push([s, e]);
  };

  // --- Span pairs (§4.1) ------------------------------------------------------
  const spanOpens = matchAll(SPAN_OPEN_RE, body);
  const spanCloses = matchAll(SPAN_CLOSE_RE, body);
  // Match openers to closers by id in document order. A surviving lone opener is
  // NOT corruption (it is §8.2 degradation, reconcile's job); a lone closer is a
  // stray closer (§9).
  const closersById = new Map<string, MatchInfo[]>();
  for (const c of spanCloses) {
    const list = closersById.get(c.id) ?? [];
    list.push(c.m);
    closersById.set(c.id, list);
  }
  const matchedCloser = new Set<MatchInfo>();
  for (const o of spanOpens) {
    markConsumed(o.m.start, o.m.end);
    const list = closersById.get(o.id);
    let closer: MatchInfo | undefined;
    if (list !== undefined) {
      // First closer after this opener that is not already matched.
      closer = list.find((c) => c.start >= o.m.end && !matchedCloser.has(c));
    }
    const anchor: ParsedAnchor = {
      id: o.id,
      kind: "span",
      openerStart: o.m.start,
      openerEnd: o.m.end,
    };
    if (closer !== undefined) {
      matchedCloser.add(closer);
      markConsumed(closer.start, closer.end);
      anchor.closerStart = closer.start;
      anchor.closerEnd = closer.end;
      anchor.extentStart = o.m.end;
      anchor.extentEnd = closer.start;
    }
    anchors.set(o.id, anchor);
  }
  // Stray closers: any closer not consumed by an opener (§9).
  for (const c of spanCloses) {
    if (!matchedCloser.has(c.m)) {
      markConsumed(c.m.start, c.m.end);
      corruption.push({
        rule: RULE.STRAY_CLOSER,
        detail: `closing span marker /pmk:s ${c.id} has no matching opener`,
        index: c.m.start,
      });
    }
  }

  // --- Block anchors (§4.2) ---------------------------------------------------
  for (const b of matchAll(BLOCK_RE, body)) {
    markConsumed(b.m.start, b.m.end);
    if (!isOwnLine(body, b.m.start, b.m.end)) {
      corruption.push({
        rule: RULE.BLOCK_NOT_OWN_LINE,
        detail: `block marker pmk:b ${b.id} is not alone on its line`,
        index: b.m.start,
      });
      continue;
    }
    anchors.set(b.id, {
      id: b.id,
      kind: "block",
      openerStart: b.m.start,
      openerEnd: b.m.end,
      blockMarkerLineOwnLine: true,
    });
  }

  // --- Range pairs (§4.3) -----------------------------------------------------
  const rangeMarks = matchAll(RANGE_RE, body);
  const rangeOpeners = rangeMarks.filter((r) => r.side === "o");
  const rangeClosers = rangeMarks.filter((r) => r.side === "c");
  const usedRangeCloser = new Set<MatchInfo>();
  for (const o of rangeOpeners) {
    markConsumed(o.m.start, o.m.end);
    const closer = rangeClosers.find(
      (c) => c.id === o.id && c.m.start >= o.m.end && !usedRangeCloser.has(c.m),
    );
    if (closer === undefined) {
      corruption.push({
        rule: RULE.RANGE_HALF_PAIR,
        detail: `range opener pmk:r ${o.id} o has no matching closer`,
        index: o.m.start,
      });
      continue;
    }
    usedRangeCloser.add(closer.m);
    markConsumed(closer.m.start, closer.m.end);
    anchors.set(o.id, {
      id: o.id,
      kind: "range",
      openerStart: o.m.start,
      openerEnd: o.m.end,
      closerStart: closer.m.start,
      closerEnd: closer.m.end,
      extentStart: o.m.end,
      extentEnd: closer.m.start,
    });
  }
  // Range closers with no matching opener are half-pairs too (§8.4).
  for (const c of rangeClosers) {
    if (!usedRangeCloser.has(c.m)) {
      markConsumed(c.m.start, c.m.end);
      corruption.push({
        rule: RULE.RANGE_HALF_PAIR,
        detail: `range closer pmk:r ${c.id} c has no matching opener`,
        index: c.m.start,
      });
    }
  }

  // --- Review block detection (§5.1) ------------------------------------------
  // More than one review block is corruption: the authoritative (EOF) block wins,
  // every other header is flagged (§9). The authoritative block's entries are
  // still parsed below; the non-authoritative blocks' entries being surfaced for
  // needs-attention is reconcile's job (§8.5).
  if (headerIndices.length > 1) {
    for (let h = 0; h < headerIndices.length; h++) {
      if (h === authIdx) continue;
      corruption.push({
        rule: RULE.SECOND_REVIEW_BLOCK,
        detail: "more than one review block; the authoritative (EOF) block wins",
        index: headerIndices[h] as number,
      });
    }
  }

  // An authoritative header with no closing delimiter is malformed (§9): surface
  // it rather than treating the unterminated block as well-formed.
  if (review !== null && unclosed) {
    corruption.push({
      rule: RULE.UNCLOSED_REVIEW_BLOCK,
      detail: "review block header has no matching <!-- /pmk:review --> closer",
      index: review.start,
    });
  }

  const entries = review === null ? [] : parseEntries(text, review, corruption);

  // --- Generic corruption sweep (§9) ------------------------------------------
  // Scan the WHOLE document for any pmk:-shaped comment not already consumed as
  // a valid marker, a valid entry, or a valid review delimiter. Classify the
  // residue: malformed IDs, unknown kinds, malformed review headers, leftovers.
  const inConsumed = (start: number, end: number): boolean =>
    consumed.some(([s, e]) => start >= s && end <= e);
  const inReviewRegion = (start: number): boolean =>
    review !== null && start >= review.start && start < review.end;

  PMK_COMMENT_RE.lastIndex = 0;
  let pm: RegExpExecArray | null;
  while ((pm = PMK_COMMENT_RE.exec(text)) !== null) {
    const whole = pm[0];
    const inner = (pm[1] ?? "").trim();
    const start = pm.index;
    const end = start + whole.length;

    if (inConsumed(start, end)) continue;

    // Review delimiters (valid spacing) and entries inside the authoritative
    // block are handled elsewhere — skip them here.
    if (whole === REVIEW_OPEN || whole === REVIEW_CLOSE) continue;
    if (inReviewRegion(start)) {
      // pmk:c entries (handled by parseEntries) and the closing delimiter live
      // here; ignore them in the residue sweep.
      continue;
    }

    classifyResidue(inner, start, corruption);
  }

  return {
    anchors,
    entries,
    review,
    reviewCount: headerIndices.length,
    corruption,
  };
}

/** Classify a leftover `pmk:`-shaped comment body into a corruption item. */
function classifyResidue(inner: string, index: number, corruption: CorruptionItem[]): void {
  // Normalize: inner is like "pmk:s k7m2q9ax", "/pmk:s mn4p6q2r",
  // "pmk:b f3w8r1zn", "pmk:r d6t4y6km o", "pmk:x q4w7e2rt",
  // "pmk:review v0", "pmk:reviewv1".

  // Malformed review header (§5.1): begins with pmk:review but is not the exact
  // valid open delimiter (which is already filtered out above).
  if (/^pmk:review/.test(inner)) {
    corruption.push({
      rule: RULE.MALFORMED_REVIEW_HEADER,
      detail: `malformed or unrecognized review header: <!-- ${inner} -->`,
      index,
    });
    return;
  }

  // Anchor/entry-shaped: optional leading `/`, then `pmk:<kind> <id>[ side]`.
  const m = /^(\/?)pmk:([a-z])\s+(\S+)(?:\s+(\S+))?\s*$/.exec(inner);
  if (m !== null) {
    const kind = m[2] as string;
    const rawId = m[3] as string;
    if (kind !== "s" && kind !== "b" && kind !== "r" && kind !== "c") {
      corruption.push({
        rule: RULE.UNKNOWN_KIND,
        detail: `unknown marker kind '${kind}' in <!-- ${inner} -->`,
        index,
      });
      return;
    }
    const idRule = idCorruptionRule(rawId);
    if (idRule !== null) {
      corruption.push({
        rule: idRule,
        detail: `invalid id '${rawId}' in <!-- ${inner} -->`,
        index,
      });
      return;
    }
  }

  // Anything else with the reserved prefix is mangled residue (§9).
  corruption.push({
    rule: RULE.RESIDUE,
    detail: `unparseable pmk: residue: <!-- ${inner} -->`,
    index,
  });
}
