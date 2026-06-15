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

/** Encode entry text: every `--` becomes `&#45;&#45;` (spec §6). */
export function encodeEntryText(s: string): string {
  return s.replaceAll(HYPHEN_PAIR, ENCODED_HYPHEN_PAIR);
}

/** Decode entry text: every `&#45;&#45;` becomes `--` (spec §6). */
export function decodeEntryText(s: string): string {
  return s.replaceAll(ENCODED_HYPHEN_PAIR, HYPHEN_PAIR);
}
