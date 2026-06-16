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
 * sufficient and avoids parsing HTML on the host.
 */

import type { ReconcileResult } from "./reconcile.js";
import type { CommentState } from "./types.js";

const ID = "[a-z2-7]{8}";
const SPAN_PAIR = new RegExp(`<!--pmk:s (${ID})-->([\\s\\S]*?)<!--/pmk:s \\1-->`, "g");
const RANGE_PAIR = new RegExp(`<!--pmk:r (${ID}) o-->([\\s\\S]*?)<!--pmk:r \\1 c-->`, "g");
const BLOCK_MARKER = new RegExp(`<!--pmk:b (${ID})-->(\\s*)<([a-zA-Z][a-zA-Z0-9-]*)`, "g");
/** Any remaining pmk anchor comment (lone opener/closer, unmatched marker). */
const ANY_PMK_MARKER = new RegExp(`<!--/?pmk:[sbr] ${ID}(?: [oc])?-->`, "g");

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
      return `<mark class="pmk-hl" data-pmk-id="${id}" data-pmk-state="${state}">${inner}</mark>`;
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
