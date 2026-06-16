/**
 * Anchor placement (spec §4 — anchor grammar). Pure, `vscode`-free.
 *
 * Given a document, a user selection (char offsets), and a {@link BlockMap}
 * derived from markdown-it's `token.map`, {@link planAnchor} decides whether the
 * comment should be a **span** (§4.1), a **block** (§4.2) or a **range** (§4.3)
 * anchor — and, for spans, SNAPS the marker boundaries so they never split an
 * inline-code span, an emphasis run, or a link's `[]()` delimiters and never
 * cross a block boundary (the "don't corrupt the document" guarantee, §4.1).
 *
 * The classifier is the writer-side counterpart to parser.ts: parser.ts reads
 * existing markers; this module decides where new markers may legally go. It is
 * the single source of truth for the span-vs-block-vs-range decision so the
 * writer (a later task) never has to re-derive it.
 */

/** A half-open char range `[start, end)` into the document text. */
export interface SourceRange {
  start: number;
  end: number;
}

/**
 * The chosen anchor placement (spec §4).
 *
 * - `span`: markers wrap the (possibly trimmed) `range` (§4.1).
 * - `block`: a block anchor goes on its own line above the block whose first
 *   line starts at `blockLineStart` (a char offset) (§4.2).
 * - `range`: a block-aligned pair wraps the contiguous run from
 *   `firstBlockLineStart` (the first block's line start) to `lastBlockEnd`
 *   (the end offset of the last block) (§4.3).
 */
export type AnchorPlacement =
  | { kind: "span"; range: SourceRange }
  | { kind: "block"; blockLineStart: number }
  | { kind: "range"; firstBlockLineStart: number; lastBlockEnd: number };

/** Block element kinds placement distinguishes (derived from markdown-it). */
export type BlockType =
  | "paragraph"
  | "table"
  | "fence"
  | "image"
  | "heading"
  | "list"
  | "blockquote"
  | "html"
  | "other";

/**
 * One block's boundaries. `line0`/`line1` are 0-indexed, end-exclusive source
 * lines (markdown-it `token.map`); `startOffset`/`endOffset` are the char
 * offsets buildBlockMap computes from them.
 */
export interface BlockSpan {
  startOffset: number;
  endOffset: number;
  line0: number;
  line1: number;
  type: BlockType;
}

/** All top-level blocks, in document order. */
export interface BlockMap {
  blocks: BlockSpan[];
}

const KNOWN_BLOCK_TYPES: ReadonlySet<string> = new Set<string>([
  "paragraph",
  "table",
  "fence",
  "image",
  "heading",
  "list",
  "blockquote",
  "html",
]);

/**
 * Block kinds whose internals are NOT safe for a span anchor — a selection
 * touching one of these always becomes a block anchor (§4.1: "Span markers MUST
 * NOT be placed inside code fences … or table internals; the enclosing block
 * gets a block anchor"). Images and raw HTML blocks have no inline text model
 * we can safely wrap either, so they get a block anchor too.
 */
const SPAN_HOSTILE_BLOCKS: ReadonlySet<BlockType> = new Set<BlockType>(["fence", "image", "html"]);

/** Map a markdown-it token type to one of our {@link BlockType}s. */
function toBlockType(raw: string): BlockType {
  return KNOWN_BLOCK_TYPES.has(raw) ? (raw as BlockType) : "other";
}

/**
 * Build a {@link BlockMap} from line-range offsets (markdown-it `token.map`).
 * Translates each `[line0, line1)` line range to char offsets: `startOffset` is
 * the first char of `line0`, `endOffset` is the first char of `line1` (i.e. one
 * past the block's last line, including its trailing newline), clamped to EOF.
 */
export function buildBlockMap(
  text: string,
  offsets: ReadonlyArray<{ line0: number; line1: number; type: string }>,
): BlockMap {
  const lineStarts = computeLineStarts(text);
  const blocks: BlockSpan[] = offsets.map((o) => ({
    startOffset: lineStartOffset(lineStarts, text, o.line0),
    endOffset: lineStartOffset(lineStarts, text, o.line1),
    line0: o.line0,
    line1: o.line1,
    type: toBlockType(o.type),
  }));
  return { blocks };
}

/** Char offset where 0-indexed `line` begins, clamped to `[0, text.length]`. */
function lineStartOffset(lineStarts: number[], text: string, line: number): number {
  if (line <= 0) return 0;
  const start = lineStarts[line];
  return start ?? text.length;
}

/** Offsets at which each line begins. `lineStarts[0]` is always 0. */
function computeLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charAt(i) === "\n") starts.push(i + 1);
  }
  return starts;
}

/**
 * Decide the anchor placement for `sel`, or reject it as uncommentable.
 *
 * Uncommentable (§4.1, §4.2): the selection lies inside YAML frontmatter, inside
 * a link-reference definition, or in no block at all (a blank gap). Otherwise the
 * snap matrix:
 *   - touches ≥2 contiguous blocks → range (§4.3);
 *   - inside a span-hostile block (fence / table / image / html) → block (§4.2);
 *   - equals or exceeds the whole enclosing block → block (§4.2);
 *   - otherwise → span, with inline-safety snapping; falls back to block when no
 *     safe inline boundary exists (§4.1).
 */
export function planAnchor(
  text: string,
  sel: SourceRange,
  map: BlockMap,
  quote?: string,
): AnchorPlacement | { uncommentable: true } {
  const start = Math.min(sel.start, sel.end);
  const end = Math.max(sel.start, sel.end);

  // Frontmatter / link-reference-definition internals are uncommentable (§4.1).
  if (inFrontmatter(text, start, end) || inLinkRefDefinition(text, start, end)) {
    return { uncommentable: true };
  }

  const touched = blocksTouchedBy(map, start, end);
  if (touched.length === 0) return { uncommentable: true };

  if (touched.length >= 2) {
    const first = touched[0]!;
    const last = touched[touched.length - 1]!;
    return { kind: "range", firstBlockLineStart: first.startOffset, lastBlockEnd: last.endOffset };
  }

  const block = touched[0]!;

  // Span-hostile block, or selection covers the whole block → block anchor.
  if (SPAN_HOSTILE_BLOCKS.has(block.type) || coversWholeBlock(text, block, start, end)) {
    return { kind: "block", blockLineStart: block.startOffset };
  }

  // Otherwise a span, snapping boundaries to inline-safe positions (§4.1).
  const snapped = snapSpan(text, block, start, end, quote);
  if (snapped === null) return { kind: "block", blockLineStart: block.startOffset };
  return { kind: "span", range: snapped };
}

/** Blocks overlapped by `[start, end)` (treating a caret as overlapping its line). */
function blocksTouchedBy(map: BlockMap, start: number, end: number): BlockSpan[] {
  return map.blocks.filter((b) => {
    if (start === end) return start >= b.startOffset && start < b.endOffset; // caret
    return start < b.endOffset && end > b.startOffset; // half-open overlap
  });
}

/**
 * True iff `[start, end)` covers the block's meaningful content. A selection
 * equal to the whole block (with or without its trailing newline / whitespace)
 * is a block-level selection (§4.3 "equal to or larger than one whole block").
 */
function coversWholeBlock(text: string, block: BlockSpan, start: number, end: number): boolean {
  // Trim trailing whitespace (the block's endOffset includes its newline).
  let contentEnd = block.endOffset;
  while (contentEnd > block.startOffset && /\s/.test(text.charAt(contentEnd - 1))) contentEnd--;
  let contentStart = block.startOffset;
  while (contentStart < contentEnd && /\s/.test(text.charAt(contentStart))) contentStart++;
  return start <= contentStart && end >= contentEnd;
}

// --- Uncommentable detectors -------------------------------------------------

/**
 * True iff `[start, end)` lies inside a leading YAML frontmatter fence — a `---`
 * line at the very top of the document closed by the next `---`/`...` line.
 * markdown-it does not emit body tokens for frontmatter, so placement detects it
 * directly from the source.
 */
function inFrontmatter(text: string, start: number, end: number): boolean {
  if (!/^---[ \t]*\r?\n/.test(text)) return false;
  // Find the closing fence line.
  const closeRe = /\r?\n(---|\.\.\.)[ \t]*(\r?\n|$)/g;
  closeRe.lastIndex = 3; // just past the opening ---
  const m = closeRe.exec(text);
  if (m === null) return false;
  const fmEnd = m.index + m[0].length; // end of the closing fence line
  return start < fmEnd && end <= fmEnd && start >= 0;
}

/**
 * True iff `[start, end)` falls on a line that is a link-reference definition:
 * `[label]: destination ["optional title"]`. markdown-it consumes these without
 * emitting a body token, so the writer must reject selections inside one.
 */
function inLinkRefDefinition(text: string, start: number, end: number): boolean {
  const lineStart = lineStartContaining(text, start);
  // The end of the line that `start` sits on, for the regex test below.
  let realEnd = lineStart;
  while (realEnd < text.length && text.charAt(realEnd) !== "\n") realEnd++;
  const line = text.slice(lineStart, realEnd);
  if (!/^[ \t]{0,3}\[[^\]]+\]:[ \t]*\S/.test(line)) return false;
  // The selection must actually fall within this definition line.
  return start >= lineStart && end <= realEnd;
}

/** Offset of the first char of the line containing `pos`. */
function lineStartContaining(text: string, pos: number): number {
  let i = Math.min(pos, text.length);
  while (i > 0 && text.charAt(i - 1) !== "\n") i--;
  return i;
}

// --- Inline-safety snapping (§4.1) -------------------------------------------

/**
 * Snap `[start, end)` to an inline-safe span within `block`, or return `null` if
 * no non-empty safe span remains (caller falls back to a block anchor).
 *
 * "Inline-safe" means neither boundary falls strictly inside an inline-code
 * span, an emphasis run, or a link's `[]()` delimiter group. We compute those
 * unsafe intervals over the block's source, then snap each boundary OUTWARD to
 * the nearest interval edge: the start moves left to the interval's start, the
 * end moves right to the interval's end. After snapping we clamp to the block's
 * content bounds and reject an empty or whitespace-only result.
 */
/**
 * Returns the length of block-level structural prefixes (headings, blockquotes, list markers)
 * at the start of `blockText`. This is used to ensure span comments never wrap these prefixes.
 */
function getBlockPrefixLength(blockText: string): number {
  let len = 0;
  while (true) {
    const remaining = blockText.slice(len);
    // 1. Blockquote prefix: e.g. "> "
    const blockquoteMatch = /^([ \t]*>[ \t]*)/.exec(remaining);
    if (blockquoteMatch) {
      len += blockquoteMatch[0].length;
      continue;
    }
    // 2. List item prefix: e.g. "- ", "1. "
    const listMatch = /^([ \t]*([-*+]|[0-9]+\.)[ \t]+)/.exec(remaining);
    if (listMatch) {
      len += listMatch[0].length;
      continue;
    }
    // 3. Heading prefix: e.g. "## "
    const headingMatch = /^(#{1,6}[ \t]+)/.exec(remaining);
    if (headingMatch) {
      len += headingMatch[0].length;
      continue;
    }
    break;
  }
  return len;
}

interface SnapInterval {
  start: number;
  end: number;
  type: "always" | "cross";
}

function cleanMarkdown(
  blockText: string,
  blockType: BlockType,
): { cleanText: string; mapping: number[] } {
  let cleanText = blockText;
  const mapping = Array.from({ length: blockText.length }, (_, i) => i);

  const removeRange = (start: number, end: number) => {
    cleanText = cleanText.slice(0, start) + cleanText.slice(end);
    mapping.splice(start, end - start);
  };

  if (blockType === "table") {
    // For tables, remove alignment/separator row, newlines, cell delimiters (|),
    // and leading/trailing padding spaces within cells so that cleanText matches
    // the concatenated text of the rendered table cells.
    const lines = blockText.split("\n");
    let currentOffset = 0;
    const rangesToRemove: Array<{ start: number; end: number }> = [];

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx]!;
      const lineStart = currentOffset;
      const lineEnd = lineStart + line.length;

      // Check for alignment separator row: e.g. |---|---|
      if (/^[ \t]*\|[ \t]*[:\- \t|]+$/.test(line)) {
        const endWithNl = lineEnd + (lineIdx < lines.length - 1 ? 1 : 0);
        rangesToRemove.push({ start: lineStart, end: endWithNl });
      } else {
        // Data or header row: remove the newline
        if (lineIdx < lines.length - 1) {
          rangesToRemove.push({ start: lineEnd, end: lineEnd + 1 });
        }

        let i = 0;
        while (i < line.length) {
          // If it's an unescaped pipe '|', remove it
          if (line.charAt(i) === "|" && (i === 0 || line.charAt(i - 1) !== "\\")) {
            rangesToRemove.push({ start: lineStart + i, end: lineStart + i + 1 });
            i++;
            continue;
          }

          const cellStart = i;
          while (
            i < line.length &&
            (line.charAt(i) !== "|" || (i > 0 && line.charAt(i - 1) === "\\"))
          ) {
            i++;
          }
          const cellEnd = i;

          const cellStr = line.slice(cellStart, cellEnd);
          const leadingSpaces = cellStr.length - cellStr.trimStart().length;
          const trailingSpaces = cellStr.length - cellStr.trimEnd().length;

          if (leadingSpaces > 0) {
            rangesToRemove.push({
              start: lineStart + cellStart,
              end: lineStart + cellStart + leadingSpaces,
            });
          }
          if (trailingSpaces > 0 && cellEnd - trailingSpaces > cellStart) {
            rangesToRemove.push({
              start: lineStart + cellEnd - trailingSpaces,
              end: lineStart + cellEnd,
            });
          }
        }
      }
      currentOffset += line.length + 1; // +1 for the \n
    }

    // Sort ranges descending to remove without shifting preceding offsets
    rangesToRemove.sort((a, b) => b.start - a.start);

    // Merge overlapping or adjacent ranges
    const mergedRanges: Array<{ start: number; end: number }> = [];
    for (const r of rangesToRemove) {
      if (mergedRanges.length === 0) {
        mergedRanges.push(r);
      } else {
        const last = mergedRanges[mergedRanges.length - 1]!;
        if (r.end >= last.start) {
          last.start = Math.min(last.start, r.start);
          last.end = Math.max(last.end, r.end);
        } else {
          mergedRanges.push(r);
        }
      }
    }

    for (const r of mergedRanges) {
      if (r.start < r.end && r.start >= 0 && r.end <= blockText.length) {
        removeRange(r.start, r.end);
      }
    }
  }

  // 1. Handle Links: [text](url)
  const linkRe = /\[([^\]]*)\]\(([^)]*)\)/g;
  const links: Array<{ start: number; textEnd: number; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(blockText)) !== null) {
    const start = m.index;
    const textLen = m[1]?.length ?? 0;
    const textEnd = start + 1 + textLen;
    const end = start + m[0].length;
    links.push({ start, textEnd, end });
  }
  for (let i = links.length - 1; i >= 0; i--) {
    const { start, textEnd, end } = links[i]!;
    removeRange(textEnd, end);
    removeRange(start, start + 1);
  }

  // 2. Handle simple formatting delimiters: **, __, ~~, *, _, `
  const delimRe = /~~|`+|\*\*|__|\*|_/g;
  while (true) {
    delimRe.lastIndex = 0;
    const match = delimRe.exec(cleanText);
    if (!match) break;
    const start = match.index;
    const len = match[0].length;
    removeRange(start, len + start);
  }

  return { cleanText, mapping };
}

function snapSpan(
  text: string,
  block: BlockSpan,
  start: number,
  end: number,
  quote?: string,
): SourceRange | null {
  const blockText = text.slice(block.startOffset, block.endOffset);
  const intervals = unsafeIntervals(blockText, block.startOffset);

  const prefixLen = getBlockPrefixLength(blockText);
  const contentText = blockText.slice(prefixLen);
  const { cleanText, mapping } = cleanMarkdown(contentText, block.type);

  let s: number;
  let e: number;

  if (quote) {
    const relStart = Math.max(0, start - (block.startOffset + prefixLen));
    const relEnd = Math.max(0, end - (block.startOffset + prefixLen));

    let alignedStart = relStart;
    let alignedEnd = relEnd;

    let bestStartInClean = -1;
    let minDiff = Infinity;
    let idx = cleanText.indexOf(quote);
    while (idx !== -1) {
      const diff = Math.abs(idx - relStart);
      if (diff < minDiff) {
        minDiff = diff;
        bestStartInClean = idx;
      }
      idx = cleanText.indexOf(quote, idx + 1);
    }
    if (bestStartInClean !== -1) {
      alignedStart = bestStartInClean;
      alignedEnd = bestStartInClean + quote.length;
    }

    const mapToSourceStart = (cleanIdx: number): number => {
      if (cleanIdx <= 0) return block.startOffset + prefixLen;
      if (cleanIdx >= cleanText.length) return block.startOffset + blockText.length;
      return block.startOffset + prefixLen + mapping[cleanIdx]!;
    };

    const mapToSourceEnd = (cleanIdx: number): number => {
      if (cleanIdx <= 0) return block.startOffset + prefixLen;
      if (cleanIdx >= cleanText.length) {
        if (cleanText.length > 0) {
          return block.startOffset + prefixLen + mapping[cleanText.length - 1]! + 1;
        }
        return block.startOffset + blockText.length;
      }
      return block.startOffset + prefixLen + mapping[cleanIdx - 1]! + 1;
    };

    s = mapToSourceStart(alignedStart);
    e = mapToSourceEnd(alignedEnd);
  } else {
    s = start;
    e = end;
  }

  // Clamp into the block. We clamp the lower boundary to start after the block-level structural prefix.
  s = Math.max(s, block.startOffset + prefixLen);
  e = Math.min(e, block.endOffset);

  // Sort intervals by length ascending (smaller/inner intervals first)
  const sortedIntervals = [...intervals].sort((a, b) => a.end - a.start - (b.end - b.start));

  // Snap boundaries using a fixed-point loop up to 10 iterations
  let changed = true;
  let iterations = 0;
  while (changed && iterations < 10) {
    changed = false;
    iterations++;
    for (const interval of sortedIntervals) {
      const { start: is, end: ie, type: kind } = interval;
      let newS = s;
      let newE = e;
      if (kind === "always") {
        if (s > is && s < ie) newS = is;
        if (e > is && e < ie) newE = ie;
      } else {
        if (s > is && s < ie && e > ie) newS = is;
        if (e > is && e < ie && s < is) newE = ie;
      }
      if (newS !== s || newE !== e) {
        s = newS;
        e = newE;
        changed = true;
      }
    }
  }

  // Trim leading/trailing whitespace so a span never wraps only blanks.
  while (s < e && /\s/.test(text.charAt(s))) s++;
  while (e > s && /\s/.test(text.charAt(e - 1))) e--;

  if (s >= e) return null;
  // A snap that swallowed the whole block content is really a block selection.
  if (coversWholeBlock(text, block, s, e)) return null;

  // For tables, prevent span comments from crossing cell delimiters (|) or row boundaries (\n)
  if (block.type === "table") {
    const selectedSourceText = text.slice(s, e);
    if (selectedSourceText.includes("|") || selectedSourceText.includes("\n")) {
      return null;
    }
  }

  return { start: s, end: e };
}

/**
 * Intervals (absolute char offsets) within which a marker boundary is unsafe:
 * inline-code spans, emphasis/strong runs, and link `[]()` groups. Offsets are
 * returned relative to the document (caller passes the block's base offset).
 *
 * We distinguish between:
 * - "always" snap intervals: inline code and link URL parts, which can never contain comments.
 * - "cross" snap intervals: strong/emphasis spans and link text, which can contain comments
 *   but must not have markers crossing their boundaries.
 */
function unsafeIntervals(blockText: string, base: number): SnapInterval[] {
  const out: SnapInterval[] = [];
  const add = (re: RegExp, type: "always" | "cross"): void => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(blockText)) !== null) {
      out.push({
        start: base + m.index,
        end: base + m.index + m[0].length,
        type,
      });
    }
  };
  add(/`+[^`]*`+/g, "always"); // inline code (one or more backticks per side)
  add(/\*\*[^*]+\*\*/g, "cross"); // strong (**)
  add(/__[^_]+__/g, "cross"); // strong (__)
  add(/(?<![*\w])\*[^*\n]+\*/g, "cross"); // emphasis (*)
  add(/(?<![_\w])_[^_\n]+_/g, "cross"); // emphasis (_)
  add(/~~[^~]+~~/g, "cross"); // strikethrough (~~)

  // Links: link text content is a cross-snap interval, while the closing bracket + URL
  // destination is an always-snap interval to avoid breaking the markdown link syntax.
  const linkRe = /\[([^\]]*)\]\(([^)]*)\)/g;
  linkRe.lastIndex = 0;
  let linkMatch: RegExpExecArray | null;
  while ((linkMatch = linkRe.exec(blockText)) !== null) {
    const fullMatchIndex = linkMatch.index;
    const linkText = linkMatch[1] ?? "";
    out.push({
      start: base + fullMatchIndex, // starts at opening [
      end: base + fullMatchIndex + 1 + linkText.length, // ends after text content (the closing ])
      type: "cross",
    });
    out.push({
      start: base + fullMatchIndex + 1 + linkText.length,
      end: base + fullMatchIndex + linkMatch[0].length,
      type: "always",
    });
  }

  return out;
}
