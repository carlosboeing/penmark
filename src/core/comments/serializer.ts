/**
 * Serializer + edit builder for the Penmark comment format (spec §5, §7).
 *
 * Turns model mutations (add a comment, resolve/delete a comment, refresh an
 * advisory quote) into a minimal set of {@link TextEdit}s — offset splices the
 * host applies as a single `WorkspaceEdit` (one undo step, §7.1). It is pure:
 * source string + {@link ParsedDoc} in, edits out; it never touches `vscode`.
 *
 * Writer invariants enforced here (spec §7):
 *   §7.1 Atomic mutation  — add inserts anchor + entry as one edit set; resolve
 *                           removes both as one edit set.
 *   §7.2 Block lifecycle  — the review block is created on the first comment and
 *                           removed entirely when the last comment is removed; it
 *                           is always the last meaningful content in the file.
 *   §7.3 Pair integrity   — span/range pairs are written and removed as a pair.
 *   §7.5 Escaping         — quote and body are encoded via escape.ts (§6), so no
 *                           bare `--` or premature `-->` ever lands in an entry.
 *   §7.6 Append-only       — a new entry is appended at the end of the block;
 *                           existing entries are never reordered or rewritten
 *                           except by {@link buildQuoteRefreshEdit} (tooling).
 *
 * IDs and placement decisions are made upstream (R1 `freshId`, R4 `planAnchor`);
 * this module assumes a valid placement and a valid, collision-free id.
 */

import { encodeEntryText } from "./escape.js";
import type { AnchorPlacement } from "./placement.js";
import type { ParsedAnchor, ParsedDoc, ParsedEntry, Provenance } from "./types.js";

/** A single offset splice into the document text: replace `[start, end)` with `newText`. */
export interface TextEdit {
  start: number;
  end: number;
  newText: string;
}

/** A new comment to serialize (the writer-side input; quote/body are raw). */
export interface NewComment {
  placement: AnchorPlacement;
  author: string;
  provenance: Provenance;
  /** §5.2.1 timestamp shape: `YYYY-MM-DD HH:MM[:SS] ±HH:MM`. */
  timestamp: string;
  /** Advisory quote, raw (un-encoded); the serializer encodes it (§6). */
  quote: string;
  /** Body prose, raw (un-encoded); the serializer encodes it (§6). */
  body: string;
  /** A valid §3 id, collision-free within the document (from `freshId`). */
  id: string;
}

const REVIEW_OPEN = "<!-- pmk:review v1 -->";
const REVIEW_CLOSE = "<!-- /pmk:review -->";

/**
 * Render the body of an entry (everything between `<!--pmk:c ` and `-->`),
 * encoding the quote and body per §6. The returned text starts with the id line
 * and ends with a trailing newline before the comment's `-->` terminator.
 */
function renderEntry(
  c: Pick<NewComment, "id" | "author" | "provenance" | "timestamp" | "quote" | "body">,
): string {
  const quoteLines = renderQuoteLines(c.quote);
  const body = encodeEntryText(c.body);
  return (
    `<!--pmk:c ${c.id}\n` +
    `${c.author} (${c.provenance}) · ${c.timestamp}\n` +
    `${quoteLines}` +
    `\n` +
    `${body}\n` +
    `-->`
  );
}

/**
 * Render the advisory quote as zero or more `> ` lines, each terminated by a
 * newline (§5.2.2). An empty quote yields no lines (an entry MAY have no quote).
 * The quote is encoded per §6.
 */
function renderQuoteLines(quote: string): string {
  if (quote === "") return "";
  return encodeEntryText(quote)
    .split("\n")
    .map((line) => `> ${line}\n`)
    .join("");
}

/** The anchor marker insertion edits for a placement (span pair / block / range pair). */
function anchorEdits(placement: AnchorPlacement, id: string): TextEdit[] {
  switch (placement.kind) {
    case "span": {
      const { start, end } = placement.range;
      // Two zero-width insertions: opener at start, closer at end. Because both
      // are insertions (start === end), the host applies them independently;
      // applyEdits sorts right-to-left so the opener does not shift the closer.
      return [
        { start, end: start, newText: `<!--pmk:s ${id}-->` },
        { start: end, end, newText: `<!--/pmk:s ${id}-->` },
      ];
    }
    case "block": {
      // A `pmk:b` marker on its own line immediately preceding the block (§4.2).
      const at = placement.blockLineStart;
      return [{ start: at, end: at, newText: `<!--pmk:b ${id}-->\n` }];
    }
    case "range": {
      // Opener on its own line before the first block, closer on its own line
      // after the last block (§4.3).
      const open = placement.firstBlockLineStart;
      const close = placement.lastBlockEnd;
      return [
        { start: open, end: open, newText: `<!--pmk:r ${id} o-->\n` },
        { start: close, end: close, newText: `<!--pmk:r ${id} c-->\n` },
      ];
    }
  }
}

/**
 * Build the edits to add a comment: the body anchor insertion(s) plus the entry
 * insertion in the review block — creating the block at EOF on the first comment
 * (§7.2), or appending the entry inside the existing block otherwise (§7.6).
 */
export function buildAddCommentEdits(text: string, doc: ParsedDoc, c: NewComment): TextEdit[] {
  const edits = anchorEdits(c.placement, c.id);
  const entry = renderEntry(c);

  if (doc.review === null) {
    // No review block yet: create it at EOF (§5.1, §7.2). Ensure the document
    // ends with a newline so the block starts on its own line.
    const eofInsert = text.length === 0 || text.endsWith("\n") ? "" : "\n";
    const block = `${eofInsert}${REVIEW_OPEN}\n${entry}\n${REVIEW_CLOSE}\n`;
    edits.push({ start: text.length, end: text.length, newText: block });
  } else {
    // Append the new entry just before the closing delimiter (append-only).
    const insertAt = closeDelimiterStart(text, doc.review.start, doc.review.end);
    edits.push({ start: insertAt, end: insertAt, newText: `${entry}\n` });
  }

  return edits;
}

/**
 * Offset of the closing `<!-- /pmk:review -->` delimiter within the review block
 * region `[start, end)`. The parser guarantees a closed authoritative block ends
 * exactly at the close delimiter (plus trailing whitespace), so we search back
 * from `end`.
 */
function closeDelimiterStart(text: string, start: number, end: number): number {
  const region = text.slice(start, end);
  const idx = region.lastIndexOf(REVIEW_CLOSE);
  return idx === -1 ? end : start + idx;
}

/**
 * Build the edits to resolve (= delete, ADR 0002) the comment with `id`: strip
 * its anchor marker(s) from the body AND remove its entry from the review block.
 * Removing the last entry removes the whole review block (delimiters included).
 * Returns `[]` when no anchor and no entry exist for `id` (nothing to do).
 */
export function buildResolveCommentEdits(text: string, doc: ParsedDoc, id: string): TextEdit[] {
  const edits: TextEdit[] = [];

  const anchor = doc.anchors.get(id);
  if (anchor !== undefined) {
    edits.push(...anchorRemovalEdits(text, anchor));
  }

  const entry = doc.entries.find((e) => e.id === id);
  if (entry !== undefined) {
    edits.push(entryRemovalEdit(text, doc, entry));
  }

  return edits;
}

/**
 * Removal edits for an anchor. For a span/range pair this removes opener AND
 * closer; for a block marker it removes the marker line (including its trailing
 * newline, which the marker text owns — `pmk:b`/`pmk:r o`/... are written with a
 * following `\n`). Span markers are inline and own no newline.
 */
function anchorRemovalEdits(text: string, anchor: ParsedAnchor): TextEdit[] {
  const edits: TextEdit[] = [];
  if (anchor.kind === "span") {
    edits.push({ start: anchor.openerStart, end: anchor.openerEnd, newText: "" });
    if (anchor.closerStart !== undefined && anchor.closerEnd !== undefined) {
      edits.push({ start: anchor.closerStart, end: anchor.closerEnd, newText: "" });
    }
    return edits;
  }
  // Block and range markers each sit on their own line; remove the marker plus
  // the trailing newline they were written with so no blank line is left behind.
  edits.push({ start: anchor.openerStart, end: lineEndAfter(text, anchor.openerEnd), newText: "" });
  if (anchor.closerStart !== undefined && anchor.closerEnd !== undefined) {
    edits.push({
      start: anchor.closerStart,
      end: lineEndAfter(text, anchor.closerEnd),
      newText: "",
    });
  }
  return edits;
}

/** Offset just past the newline following `pos`, or `pos` if none (clamped to EOF). */
function lineEndAfter(text: string, pos: number): number {
  return pos < text.length && text.charAt(pos) === "\n" ? pos + 1 : pos;
}

/**
 * Removal edit for an entry. If it is the only entry in the block, remove the
 * whole block (delimiters and any leading/trailing newline introduced when the
 * block was created); otherwise remove just the entry and its trailing newline.
 */
function entryRemovalEdit(text: string, doc: ParsedDoc, entry: ParsedEntry): TextEdit {
  if (doc.entries.length === 1 && doc.review !== null) {
    // Last comment → remove the entire review block (§7.2). Also strip a single
    // leading newline before the block so the body is not left with a trailing
    // blank line the block creation introduced.
    let start = doc.review.start;
    if (start > 0 && text.charAt(start - 1) === "\n") start -= 1;
    return { start, end: doc.review.end, newText: "" };
  }
  // Mid-list / multi-entry: remove the entry plus its trailing newline.
  return { start: entry.rawStart, end: lineEndAfter(text, entry.rawEnd), newText: "" };
}

/**
 * Tooling-only (§7.6): refresh the advisory quote of the entry with `id`,
 * replacing its `> ` quote lines (or inserting them when the entry had none).
 * Returns `null` when no entry has that id. The new quote is encoded per §6.
 */
export function buildQuoteRefreshEdit(
  text: string,
  doc: ParsedDoc,
  id: string,
  newQuote: string,
): TextEdit | null {
  const entry = doc.entries.find((e) => e.id === id);
  if (entry === undefined) return null;

  // The quote occupies the lines after the meta line (line 2) up to the blank
  // line that separates it from the body. Recompute those line boundaries from
  // the raw entry text so the splice replaces exactly the quote region.
  const region = quoteRegion(text, entry);
  return { start: region.start, end: region.end, newText: renderQuoteLines(newQuote) };
}

/**
 * The char range covering an entry's quote lines (the lines beginning `> `),
 * positioned so that replacing it with the output of {@link renderQuoteLines}
 * keeps the surrounding meta line and blank-separator intact. The range starts
 * at the line after the meta line and ends just before the blank separator line.
 */
function quoteRegion(text: string, entry: ParsedEntry): { start: number; end: number } {
  // entry.rawStart points at `<!--pmk:c `; the inner text begins after it.
  const innerStart = entry.rawStart + "<!--pmk:c ".length;
  const inner = text.slice(innerStart, entry.rawEnd - "-->".length);
  // Line 1 = id line, line 2 = meta line. The quote starts at line 3.
  const firstNl = inner.indexOf("\n");
  const secondNl = inner.indexOf("\n", firstNl + 1);
  // Offset (into `text`) where the quote region begins (start of line 3).
  const quoteStart = innerStart + secondNl + 1;
  // Walk forward over `> ` lines (encoded form: the parser's quote lines start
  // with "> "; we treat any leading "> " line as part of the quote).
  let cursor = quoteStart;
  while (cursor < entry.rawEnd) {
    const lineEnd = nextLineEnd(text, cursor, entry.rawEnd);
    const line = text.slice(cursor, lineEnd);
    if (!line.startsWith("> ")) break;
    cursor = lineEnd + 1; // skip the newline
  }
  return { start: quoteStart, end: cursor };
}

/** Offset of the next `\n` at or after `from`, clamped to `limit`. */
function nextLineEnd(text: string, from: number, limit: number): number {
  let i = from;
  while (i < limit && text.charAt(i) !== "\n") i++;
  return i;
}
