/**
 * Host-side highlight injection (D12, design §5.2). Pure, `vscode`-free.
 *
 * markdown-it runs with `html: true`, so the inline `<!--pmk:s ID-->` /
 * `<!--pmk:b ID-->` / `<!--pmk:r ID o|c-->` anchor comments flow through into
 * the rendered HTML verbatim, at the exact extent. {@link injectHighlights}
 * rewrites those markers into highlight elements, keyed by the {@link
 * ReconcileResult} so only LIVE comments are highlighted:
 *
 *   - intact span pair          → `<mark class="pmk-hl" data-pmk-id data-pmk-state>…</mark>`
 *   - intact block marker       → the next block element gains `data-pmk-id`,
 *                                 `data-pmk-state`, `data-pmk-block`
 *   - intact range pair         → the wrapped block run is enclosed in a
 *                                 `<div class="pmk-hl-range" …>`
 *
 * Everything else is STRIPPED (markers removed, document text kept): content-
 * removed (empty extent, §8.3), orphan, and any id unknown to the reconcile
 * result. A degraded-recovered span has its closer destroyed in production, so
 * its lone opener never forms a pair and is stripped too — such comments surface
 * only in the drawer (D12); body-highlighting a quote-recovered extent is out of
 * v0.5 scope (D12 reserves quote-matching for the §8.2 fallback path).
 *
 * This runs AFTER markdown-it and BEFORE DOMPurify. DOMPurify keeps `<mark>` /
 * `<div>` and the `data-pmk-*` attributes (see sanitize.ts) and strips any
 * leftover HTML comments — so even unconverted markers never reach the DOM.
 *
 * It is a string transform, not a DOM parse: the markers are exact,
 * fixed-length, machine-generated tokens, so id-keyed regex replacement is
 * sufficient and avoids parsing HTML on the host. The one place that must look
 * at surrounding markup is the span splitter below, which scans for element
 * boundaries; it reads tags, comments and raw-text elements precisely enough not
 * to corrupt them, but it still builds no DOM.
 */

import type { ReconcileResult } from "./reconcile.js";
import type { CommentState } from "./types.js";

const ID = "[a-z2-7]{8}";
const SPAN_PAIR = new RegExp(`<!--pmk:s (${ID})-->([\\s\\S]*?)<!--/pmk:s \\1-->`, "g");
const RANGE_PAIR = new RegExp(`<!--pmk:r (${ID}) o-->([\\s\\S]*?)<!--pmk:r \\1 c-->`, "g");
const BLOCK_MARKER = new RegExp(`<!--pmk:b (${ID})-->(\\s*)<([a-zA-Z][a-zA-Z0-9-]*)`, "g");
/** Any remaining pmk anchor comment (lone opener/closer, unmatched marker). */
const ANY_PMK_MARKER = new RegExp(`<!--/?pmk:[sbr] ${ID}(?: [oc])?-->`, "g");

/**
 * Elements that sit inside a line of text. A `<mark>` may contain these whole,
 * so a highlight is not chopped up at every `<em>` or `<a>`.
 *
 * The classification is deliberately an INLINE allowlist rather than a list of
 * block tags. A block list has to be exhaustive to be safe — miss `dialog`,
 * `menu`, `search` or any custom element and the splitter emits a `<mark>` that
 * opens inside the container and closes outside it, which the browser repairs by
 * relocating the container's children. Anything not listed here is treated as a
 * boundary instead: being wrong about an element costs one extra highlight
 * fragment, never invalid markup.
 */
const INLINE_TAGS: ReadonlySet<string> = new Set([
  "a",
  "abbr",
  "acronym",
  "b",
  "bdi",
  "bdo",
  "big",
  "br",
  "cite",
  "code",
  "data",
  "del",
  "dfn",
  "em",
  "font",
  "i",
  "img",
  "ins",
  "kbd",
  "mark",
  "nobr",
  "picture",
  "q",
  "rp",
  "rt",
  "rtc",
  "ruby",
  "s",
  "samp",
  "small",
  "source",
  "span",
  "strike",
  "strong",
  "sub",
  "sup",
  "time",
  "track",
  "tt",
  "u",
  "var",
  "wbr",
]);

/** Elements with no end tag — they never open a nesting level. */
const VOID_TAGS: ReadonlySet<string> = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

/**
 * Elements whose contents must never be scanned for tag boundaries. Inside
 * `<textarea>` or `<title>` a `<div>` is text, not markup, so splitting there
 * would rewrite the element's own value; inside `<svg>` or `<math>` the child
 * names are a foreign vocabulary that this HTML classification does not describe.
 * Both are consumed whole and ride inside the current run.
 */
const OPAQUE_TAGS: ReadonlySet<string> = new Set([
  "script",
  "style",
  "textarea",
  "title",
  "xmp",
  "noembed",
  "noframes",
  "iframe",
  "svg",
  "math",
  "template",
]);

/**
 * Opaque elements holding raw text: per the HTML parser the FIRST matching end
 * tag closes them, so nesting is not counted (a `"<script>"` inside a JS string
 * would otherwise be read as a nested element).
 */
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

/**
 * Foreign-content roots. These are the ONLY elements where XML self-closing
 * syntax means anything: in an HTML start tag the `/` is ignored, so
 * `<textarea/>` opens RCDATA exactly as `<textarea>` does, and treating it as
 * empty would resume scanning inside the element's own text.
 */
const SELF_CLOSABLE_TAGS: ReadonlySet<string> = new Set(["svg", "math"]);

/** Start of an HTML tag: `<name` or `</name`. Sticky — the caller sets lastIndex. */
const TAG_NAME = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)/y;

interface Tag {
  name: string;
  /** True for an end tag (`</name>`). */
  closing: boolean;
  /** True for an XML-style self-closing tag (`<name/>`). */
  selfClosing: boolean;
  /** Offset just past the tag's closing `>`. */
  end: number;
}

/**
 * Read the tag starting at `at`, or null if that is not a tag. The scan honours
 * quoted attribute values, so a `>` inside `data-x=">"` does not end the tag —
 * splitting there would splice a `<mark>` into the attribute and destroy the
 * element. Raw HTML reaches here because markdown-it runs with `html: true`.
 */
function readTag(html: string, at: number): Tag | null {
  TAG_NAME.lastIndex = at;
  const m = TAG_NAME.exec(html);
  if (m === null) return null;
  let i = TAG_NAME.lastIndex;
  let quote = "";
  let prev = "";
  while (i < html.length) {
    const ch = html.charAt(i);
    i++;
    if (quote !== "") {
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ">") {
      break;
    }
    if (quote === "") prev = ch;
  }
  return { name: m[2]!.toLowerCase(), closing: m[1] === "/", selfClosing: prev === "/", end: i };
}

/**
 * Offset just past the end tag matching the opaque element `tag`, or the end of
 * `html` when it is never closed (truncated markup).
 */
function endOfOpaque(html: string, tag: Tag): number {
  if (tag.selfClosing && SELF_CLOSABLE_TAGS.has(tag.name)) return tag.end;
  if (RAW_TEXT_TAGS.has(tag.name)) return endOfRawText(html, tag);

  // Foreign subtrees and <template> nest, so count depth. Comments and CDATA
  // sections are skipped whole: a `<!-- </svg> -->` inside the subtree is text,
  // and letting it close the element resumes scanning inside a live subtree.
  let depth = 1;
  let i = tag.end;
  while (i < html.length && depth > 0) {
    const lt = html.indexOf("<", i);
    if (lt === -1) return html.length;
    const skipped = skipNonTag(html, lt);
    if (skipped !== null) {
      i = skipped;
      continue;
    }
    const inner = readTag(html, lt);
    if (inner === null) {
      i = lt + 1;
      continue;
    }
    if (inner.name === tag.name && !inner.selfClosing) depth += inner.closing ? -1 : 1;
    i = inner.end;
  }
  return i;
}

/**
 * Offset just past a comment or CDATA section starting at `at`, or null when
 * `at` is neither. CDATA is legal inside the foreign subtrees this scanner
 * consumes, and both may contain text that looks like an end tag.
 */
function skipNonTag(html: string, at: number): number | null {
  if (html.startsWith("<!--", at)) {
    const close = html.indexOf("-->", at + 4);
    return close === -1 ? html.length : close + 3;
  }
  if (html.startsWith("<![CDATA[", at)) {
    const close = html.indexOf("]]>", at + 9);
    return close === -1 ? html.length : close + 3;
  }
  return null;
}

/**
 * Offset just past the end tag closing raw-text element `tag`. The end tag is
 * the first `</name` followed by whitespace, `/` or `>`; anything else is text,
 * so `</scriptish>` does not close a `<script>`. Scanned rather than matched
 * with a constructed pattern so no regex is ever built from a tag name.
 */
function endOfRawText(html: string, tag: Tag): number {
  const needle = `</${tag.name}`;
  const haystack = html.toLowerCase();
  let i = tag.end;
  for (;;) {
    const at = haystack.indexOf(needle, i);
    if (at === -1) return html.length;
    const next = html.charAt(at + needle.length);
    if (next === ">" || next === "/" || next === "" || /\s/.test(next)) {
      const gt = html.indexOf(">", at);
      return gt === -1 ? html.length : gt + 1;
    }
    i = at + needle.length;
  }
}

/**
 * Wrap every inline run of `inner` in its own `<mark …>`, leaving boundary tags
 * and inter-block whitespace outside. An extent that stays within one block
 * yields a single `<mark>`, byte-identical to the un-split form.
 *
 * The invariant is that no emitted `<mark>` may straddle an element boundary:
 * within a mark, everything opened is closed. A boundary tag met at the top
 * level therefore ends the current run. Inside an inline element the run keeps
 * going and its nesting depth is tracked, so even a block tag written inside an
 * `<a>` stays balanced within the mark rather than crossing out of it.
 *
 * This is a scan rather than a regex split because HTML comments, quoted
 * attribute values and raw-text elements all contain text that looks like
 * markup. It reads tags precisely enough not to corrupt them, but builds no DOM.
 */
function markInlineRuns(inner: string, open: string): string {
  let out = "";
  let run = "";
  // Whether the run holds anything a highlight would paint. Tracked while
  // scanning rather than re-derived from `run`, so comment text never has to be
  // stripped back out of a string.
  let painted = false;
  // Open inline elements the run is currently inside.
  let inlineDepth = 0;
  const flush = (): void => {
    out += painted ? `${open}${run}</mark>` : run;
    run = "";
    painted = false;
  };

  let i = 0;
  while (i < inner.length) {
    if (inner.startsWith("<!--", i)) {
      const close = inner.indexOf("-->", i + 4);
      const end = close === -1 ? inner.length : close + 3;
      run += inner.slice(i, end); // a comment paints nothing
      i = end;
      continue;
    }
    if (inner.charAt(i) === "<") {
      const tag = readTag(inner, i);
      if (tag !== null) {
        if (!tag.closing && tag.name === "plaintext") {
          // <plaintext> has no end tag: every byte after it is text, `</plaintext>`
          // included. Nothing further can be highlighted, so close the run and
          // emit the remainder untouched rather than splice marks into that text.
          flush();
          out += inner.slice(i);
          return out;
        }
        if (!tag.closing && OPAQUE_TAGS.has(tag.name)) {
          const end = endOfOpaque(inner, tag);
          run += inner.slice(i, end);
          painted = true;
          i = end;
          continue;
        }
        if (!INLINE_TAGS.has(tag.name) && inlineDepth === 0) {
          flush();
          out += inner.slice(i, tag.end);
        } else {
          run += inner.slice(i, tag.end);
          painted = true;
          if (INLINE_TAGS.has(tag.name) && !VOID_TAGS.has(tag.name) && !tag.selfClosing) {
            inlineDepth = tag.closing ? Math.max(0, inlineDepth - 1) : inlineDepth + 1;
          }
        }
        i = tag.end;
        continue;
      }
    }
    const ch = inner.charAt(i);
    run += ch;
    if (ch.trim() !== "") painted = true;
    i++;
  }
  flush();
  return out;
}

/** Span states that produce a body highlight (a delimited, non-empty extent). */
const HIGHLIGHT_SPAN_STATES: ReadonlySet<CommentState> = new Set<CommentState>([
  "intact",
  "degraded-recovered",
]);

/**
 * Rewrite live anchor markers in `html` into highlight elements, per `recon`.
 * Orphan / content-removed / unknown ids leave no highlight (markers stripped,
 * document text preserved). Non-pmk HTML is never touched.
 */
export function injectHighlights(html: string, recon: ReconcileResult): string {
  const stateById = new Map<string, CommentState>();
  for (const c of recon.comments) stateById.set(c.entry.id, c.state);

  let out = html;

  // Span pairs: highlight the live ones, strip-but-keep-content otherwise.
  out = out.replace(SPAN_PAIR, (_match, id: string, inner: string) => {
    const state = stateById.get(id);
    if (state !== undefined && HIGHLIGHT_SPAN_STATES.has(state)) {
      return markInlineRuns(
        inner,
        `<mark class="pmk-hl" data-pmk-id="${id}" data-pmk-state="${state}">`,
      );
    }
    return inner; // content-removed / orphan / unknown → drop the markers only
  });

  // Range pairs: wrap the block run of a live (intact) range in a div.
  out = out.replace(RANGE_PAIR, (_match, id: string, inner: string) => {
    const state = stateById.get(id);
    if (state === "intact") {
      return `<div class="pmk-hl-range" data-pmk-id="${id}" data-pmk-state="${state}">${inner}</div>`;
    }
    return inner;
  });

  // Block markers: tag the immediately following element of a live (intact)
  // block; otherwise just drop the marker (keep the element and any whitespace).
  out = out.replace(BLOCK_MARKER, (_match, id: string, gap: string, tag: string) => {
    const state = stateById.get(id);
    if (state === "intact") {
      return `${gap}<${tag} data-pmk-id="${id}" data-pmk-state="${state}" data-pmk-block=""`;
    }
    return `${gap}<${tag}`;
  });

  // Strip any leftover pmk markers (lone openers/closers, half-pairs). DOMPurify
  // would also remove these as comments, but stripping here keeps the host output
  // clean and asserts there is no residual highlight syntax.
  out = out.replace(ANY_PMK_MARKER, "");

  return out;
}
