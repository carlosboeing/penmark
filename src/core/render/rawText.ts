import type MarkdownIt from "markdown-it";
import type StateInline from "markdown-it/lib/rules_inline/state_inline.mjs";

/**
 * Raw-text elements on the inline path (#51).
 *
 * markdown-it has no HTML parser and no notion of RCDATA: written as
 * `<textarea>` an element opens an HTML block and passes through untouched,
 * but written as `<textarea/>` (or mid-paragraph) it takes the inline path,
 * so inline rules keep running over what a browser considers the element's
 * raw text. The renderer's own per-text-node `data-pmk-soff` spans then land
 * inside the element's value and show up as literal source text.
 *
 * This rule runs before `html_inline`: when it sees an open tag for a
 * raw-text element it consumes the element whole — open tag through its
 * matching end tag — into a single `html_inline` token, so the inner text
 * never becomes text tokens. In an HTML start tag the `/` is ignored, so a
 * self-closing `<textarea/>` opens raw text exactly as `<textarea>` does and
 * is consumed the same way. Only `svg` and `math` honour XML self-closing;
 * they are not raw-text elements and are left alone.
 */

/** Elements whose content is raw text: the first matching end tag closes them. */
const RAW_TEXT_TAGS: ReadonlySet<string> = new Set([
  "script",
  "style",
  "textarea",
  "title",
  "xmp",
  "noembed",
  "noframes",
  "iframe",
]);

const isTagNameChar = (ch: string): boolean =>
  (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || (ch >= "0" && ch <= "9") || ch === "-";

/** True for the characters that may legally end an end-tag name. */
const isEndTagBoundary = (ch: string): boolean =>
  ch === "" || ch === ">" || ch === "/" || ch === "\n" || ch === "\r" || ch === " " || ch === "\t";

/**
 * Offset just past the `>` closing the tag that opens at `at` (which points
 * at `<`), honouring quoted attribute values, or -1 when the tag never
 * closes within `posMax`.
 */
function endOfOpenTag(src: string, at: number, posMax: number): number {
  let i = at + 1;
  let quote = "";
  while (i < posMax) {
    const ch = src.charAt(i);
    if (quote !== "") {
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ">") {
      return i + 1;
    }
    i++;
  }
  return -1;
}

/**
 * Offset just past the end tag closing raw-text element `name` (lowercase),
 * searched from `from`; the end tag is the first `</name` at a tag-name
 * boundary. Returns `posMax` when the element is never closed — the rest of
 * the block is raw text, matching what a browser shows for truncated markup.
 */
function endOfRawText(src: string, name: string, from: number, posMax: number): number {
  const needle = `</${name}`;
  const lower = src.toLowerCase();
  let i = from;
  for (;;) {
    const at = lower.indexOf(needle, i);
    if (at === -1 || at >= posMax) return posMax;
    if (isEndTagBoundary(src.charAt(at + needle.length))) {
      const gt = src.indexOf(">", at + needle.length);
      return gt === -1 || gt >= posMax ? posMax : gt + 1;
    }
    i = at + needle.length;
  }
}

function rawTextRule(state: StateInline, silent: boolean): boolean {
  const src = state.src;
  const posMax = state.posMax;
  let pos = state.pos;

  if (src.charCodeAt(pos) !== 0x3c /* < */) return false;
  pos++;
  if (src.charAt(pos) === "/") return false; // an end tag: not ours to open

  let name = "";
  while (pos < posMax && isTagNameChar(src.charAt(pos))) {
    name += src.charAt(pos);
    pos++;
  }
  if (name === "" || !RAW_TEXT_TAGS.has(name.toLowerCase())) return false;
  // `<textarea-x>` is a custom element, not a textarea.
  const after = src.charAt(pos);
  if (after !== "" && pos < posMax && !/[\s/>]/.test(after)) return false;

  const tagEnd = endOfOpenTag(src, state.pos, posMax);
  if (tagEnd === -1) return false;

  const end = endOfRawText(src, name.toLowerCase(), tagEnd, posMax);
  if (!silent) {
    const token = state.push("html_inline", "", 0);
    token.content = src.slice(state.pos, end);
  }
  state.pos = end;
  return true;
}

/** Consume inline raw-text elements whole so no spans land inside their values. */
export function registerRawText(md: MarkdownIt): void {
  md.inline.ruler.before("html_inline", "pmk-raw-text", rawTextRule);
}
