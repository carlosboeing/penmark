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
 */

const HYPHEN_PAIR = "--";
const ENCODED_HYPHEN_PAIR = "&#45;&#45;";
const DECIMAL_CHARACTER_REFERENCE = /&#(\d+);/g;

/** Encode entry text: every `--` becomes `&#45;&#45;` (spec §6). */
export function encodeEntryText(s: string): string {
  return s.replaceAll(HYPHEN_PAIR, ENCODED_HYPHEN_PAIR);
}

/**
 * Decode entry text for display and editing.
 *
 * The paired-hyphen sentinel is a pair of decimal character references, so
 * decoding every valid decimal reference also accepts punctuation emitted by
 * agent tools (for example, `&#45;` for a single hyphen). Invalid references
 * stay literal rather than being silently changed.
 */
export function decodeEntryText(s: string): string {
  return s.replace(DECIMAL_CHARACTER_REFERENCE, (reference, decimal: string) => {
    const codePoint = Number(decimal);
    return Number.isSafeInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
      ? String.fromCodePoint(codePoint)
      : reference;
  });
}
