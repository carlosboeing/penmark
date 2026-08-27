/**
 * Entry-text escaping (Penmark format spec §6).
 *
 * The HTML-comment terminator is `-->`, and `--` may not legally appear inside
 * an HTML comment. So every occurrence of the two-character sequence `--` inside
 * an entry's quote or body is written as `&#45;&#45;` (two decimal character
 * references for the hyphen) and decoded back on read. The escape applies to
 * entry text only — never to the markers, which contain no `--` of their own.
 *
 * Round-trip: `decodeEntryText(encodeEntryText(s)) === s` for any string that
 * does not already contain the literal sentinel `&#45;&#45;` (spec §6). This
 * guarantees no bare `--`, and therefore no premature `-->`, survives in output.
 *
 * `decodeDisplayText` is a separate, one-way pass applied at the presentation
 * seam only. It is NOT part of the codec: keeping it out of the parser is what
 * lets the round-trip property above stay true, and what keeps `entry.quote`
 * byte-faithful to the document for §8.2 quote recovery.
 */

import { isValidEntityCode, fromCodePoint } from "markdown-it/lib/common/utils.mjs";

const HYPHEN_PAIR = "--";
const ENCODED_HYPHEN_PAIR = "&#45;&#45;";
const DECIMAL_CHARACTER_REFERENCE = /&#(\d+);/g;

/** Encode entry text: every `--` becomes `&#45;&#45;` (spec §6). */
export function encodeEntryText(s: string): string {
  return s.replaceAll(HYPHEN_PAIR, ENCODED_HYPHEN_PAIR);
}

/** Decode entry text: every `&#45;&#45;` becomes `--` (spec §6). */
export function decodeEntryText(s: string): string {
  return s.replaceAll(ENCODED_HYPHEN_PAIR, HYPHEN_PAIR);
}

/**
 * Render entry text for a human reader.
 *
 * Agent tools that write review entries by hand often encode punctuation as
 * decimal character references (`Layer&#45;1` for `Layer-1`), which would
 * otherwise reach the drawer and popover as visible source text. This pass
 * decodes every reference the preview renderer would decode, using
 * markdown-it's own validity rule so the two agree: surrogates, NUL, C0/C1
 * controls and noncharacters stay literal rather than becoming ill-formed text.
 *
 * Apply this at a presentation boundary only — never before `reconcile`, which
 * matches `entry.quote` against raw document bytes, and never before
 * `encodeEntryText`, which cannot restore a reference it did not write.
 */
export function decodeDisplayText(s: string): string {
  return s.replace(DECIMAL_CHARACTER_REFERENCE, (reference, decimal: string) => {
    const codePoint = Number(decimal);
    return isValidEntityCode(codePoint) ? fromCodePoint(codePoint) : reference;
  });
}
