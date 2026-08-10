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
 * at surrounding markup is the span splitter below, which scans for block-tag
 * boundaries; it reads tags and comments precisely enough not to corrupt them,
 * but it still builds no DOM.
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
 * Block-level tag names a `<mark>` must never straddle. A bullet list is ONE
 * block, so selecting a few of its items yields a span, not a range — one `<mark>`
 * wrapped around `</li><li>` is invalid nesting. `<mark>` is not in HTML's list
 * of formatting elements, so the parser does NOT reconstruct it across the
 * boundary: it closes the mark at `</li>` and drops the stray closer, leaving
 * every item after the first unhighlighted. Splitting the extent into one
 * `<mark>` per inline run keeps the markup valid and the whole extent visible.
 */
const BLOCK_TAGS: ReadonlySet<string> = new Set([
  "p",
  "div",
  "li",
  "ul",
  "ol",
  "dl",
  "dt",
  "dd",
  "blockquote",
  "pre",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "td",
  "th",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "section",
  "article",
  "aside",
  "header",
  "footer",
  "figure",
  "figcaption",
  "details",
  "summary",
  "main",
  "nav",
  "form",
  "fieldset",
]);

/** Start of an HTML tag: `<name` or `</name`. Sticky — the caller sets lastIndex. */
const TAG_NAME = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)/y;

interface Tag {
  name: string;
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
  }
  return { name: m[2]!.toLowerCase(), end: i };
}

/** True iff `run` holds something a highlight would actually paint. */
function hasVisibleContent(run: string): boolean {
  return run.replace(/<!--[\s\S]*?-->/g, "").trim() !== "";
}

/**
 * Wrap every inline run of `inner` in its own `<mark …>`, leaving block tags and
 * inter-block whitespace outside. An extent that stays within one block yields a
 * single `<mark>`, byte-identical to the un-split form.
 *
 * This is a scan rather than a regex split because both HTML comments and quoted
 * attribute values can contain text that looks like a block tag. A comment's
 * contents are carried along whole, so `<!-- note <div> inside -->` never splits
 * a run and never has a `</mark>` spliced into it.
 */
function markInlineRuns(inner: string, open: string): string {
  let out = "";
  let run = "";
  const flush = (): void => {
    out += hasVisibleContent(run) ? `${open}${run}</mark>` : run;
    run = "";
  };

  let i = 0;
  while (i < inner.length) {
    if (inner.startsWith("<!--", i)) {
      const close = inner.indexOf("-->", i + 4);
      const end = close === -1 ? inner.length : close + 3;
      run += inner.slice(i, end);
      i = end;
      continue;
    }
    if (inner.charAt(i) === "<") {
      const tag = readTag(inner, i);
      if (tag !== null) {
        if (BLOCK_TAGS.has(tag.name)) {
          flush();
          out += inner.slice(i, tag.end);
        } else {
          run += inner.slice(i, tag.end);
        }
        i = tag.end;
        continue;
      }
    }
    run += inner.charAt(i);
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
