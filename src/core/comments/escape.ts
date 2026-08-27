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
 *
 * This module is imported by the parser and the serializer, so it lands in the
 * eager extension entry. It must stay dependency-free: importing markdown-it's
 * `utils.mjs` for the two helpers below pulled in `entities` and `mdurl`, which
 * took `dist/extension.js` from 53 KB to 136 KB against a sub-50 ms activation
 * budget. `escape.markdownItParity.test.ts` pins the copy to the original.
 */

const HYPHEN_PAIR = "--";
const ENCODED_HYPHEN_PAIR = "&#45;&#45;";

/**
 * A decimal character reference, capped at seven digits to match markdown-it's
 * `DIGITAL_RE` (`lib/rules_inline/entity.mjs`). An unbounded `\d+` would decode
 * a zero-padded `&#00000045;` that the preview leaves literal, so the drawer and
 * the preview would disagree about the same passage.
 */
const DECIMAL_CHARACTER_REFERENCE = /&#(\d{1,7});/g;

/** The `&` reference. Decoding it is how a display pass can build a new reference. */
const AMPERSAND = 38;

/**
 * Whether a code point may be rendered, mirroring markdown-it's
 * `isValidEntityCode` (`lib/common/utils.mjs`). Rejects surrogates, the
 * noncharacters, NUL and the C0/C1 controls, and anything above the Unicode
 * ceiling. A rejected reference is left as written rather than rendered: a lone
 * surrogate becomes U+FFFD the moment anything writes it as UTF-8, and a NUL in
 * a markdown file makes git treat that file as binary.
 */
function isRenderableCodePoint(c: number): boolean {
  if (c >= 0xd800 && c <= 0xdfff) return false; // surrogate halves
  if (c >= 0xfdd0 && c <= 0xfdef) return false; // noncharacters
  if ((c & 0xffff) === 0xffff || (c & 0xffff) === 0xfffe) return false;
  if (c >= 0x00 && c <= 0x08) return false; // C0 controls
  if (c === 0x0b) return false;
  if (c >= 0x0e && c <= 0x1f) return false;
  if (c >= 0x7f && c <= 0x9f) return false; // DEL and C1 controls
  if (c > 0x10ffff) return false;
  return true;
}

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
 * otherwise reach the drawer as visible source text. This pass renders them.
 *
 * Apply it at a presentation boundary only — never before `reconcile`, which
 * matches an entry's quote against raw document bytes, and never before
 * `encodeEntryText`, which cannot restore a reference it did not write.
 *
 * `&#38;` is the one reference left alone. Rendering it would put a fresh `&`
 * next to whatever follows, so `&#38;#45;&#38;#45;` would become the literal
 * storage sentinel `&#45;&#45;`; saving that from the edit box would then read
 * back as `--`, rewriting text the user never typed.
 */
export function decodeDisplayText(s: string): string {
  return s.replace(DECIMAL_CHARACTER_REFERENCE, (reference, decimal: string) => {
    const codePoint = Number(decimal);
    if (codePoint === AMPERSAND || !isRenderableCodePoint(codePoint)) return reference;
    return String.fromCodePoint(codePoint);
  });
}
