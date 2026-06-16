/**
 * Wire the host-injected highlight elements to their gutter dots and the
 * click-to-open comment popover (R11, design §5.2 + mockup
 * docs/assets/penmark-v1-concept.html).
 *
 * The host (injectHighlights, src/core/comments/highlight.ts) rewrites live
 * anchor markers into:
 *   - span pairs   → `<mark class="pmk-hl" data-pmk-id data-pmk-state>…</mark>`
 *   - block anchor → the block element gains `data-pmk-id data-pmk-state data-pmk-block`
 *   - range anchor → `<div class="pmk-hl-range" data-pmk-id data-pmk-state>…</div>`
 * This module adds the visible affordances (one gutter dot per commented block,
 * a click handler that opens the popover) — the host injects no listeners.
 *
 * Like copyButtons (and per the handover gotcha), morphdom reconciles the DOM to
 * the host HTML on every render and strips these post-render additions, so this
 * is re-installed after each renderInto and is idempotent (it skips elements it
 * has already wired and blocks that already carry a dot).
 *
 * ADR 0001: no vscode imports — host communication via postMessage only.
 */

import type { WireComment, WebviewToHost } from "../../core/protocol/messages.js";
import { openCommentPopover, getActiveCommentId } from "./popover.js";

type PostMessage = (msg: WebviewToHost) => void;

/** Block-family tags that cannot hold a leading inline `<span>` child cleanly. */
const SPAN_HOSTILE_HOSTS: ReadonlySet<string> = new Set([
  "TABLE",
  "THEAD",
  "TBODY",
  "TFOOT",
  "TR",
  "UL",
  "OL",
  "DL",
]);

const _delegatedRoots = new WeakSet<HTMLElement>();
const _commentsByRoot = new WeakMap<HTMLElement, WireComment[]>();

/**
 * Install gutter dots + click-to-open-popover on every live highlight in `root`,
 * keyed by `comments`. Highlights whose id is unknown to `comments` are left
 * alone (defensive — the host should not emit those). Safe to call after every
 * render (idempotent).
 */
export function installHighlights(
  root: HTMLElement,
  comments: WireComment[],
  postMessage: PostMessage,
): void {
  _commentsByRoot.set(root, comments);

  const byId = new Map<string, WireComment>();
  for (const c of comments) byId.set(c.id, c);

  const activeId = getActiveCommentId();

  for (const el of root.querySelectorAll<HTMLElement>("[data-pmk-id]")) {
    const id = el.getAttribute("data-pmk-id");
    if (!id) continue;
    const comment = byId.get(id);
    if (!comment) continue;

    addGutterDot(blockHostOf(el, root));

    if (activeId === id) {
      el.classList.add("pmk-hl-active");
    } else {
      el.classList.remove("pmk-hl-active");
    }
  }

  if (!_delegatedRoots.has(root)) {
    _delegatedRoots.add(root);
    root.addEventListener("click", (e) => {
      // Let clicks on a link inside the highlight follow the link.
      if ((e.target as HTMLElement).closest("a")) return;

      const highlightEl = (e.target as HTMLElement).closest<HTMLElement>("[data-pmk-id]");
      if (!highlightEl || !root.contains(highlightEl)) return;

      const id = highlightEl.getAttribute("data-pmk-id");
      if (!id) return;

      const currentComments = _commentsByRoot.get(root) ?? [];
      const comment = currentComments.find((c) => c.id === id);
      if (!comment) return;

      openCommentPopover(highlightEl, comment, postMessage);
    });
  }
}

/**
 * The top-level block that hosts the gutter dot for `el`: the highest ancestor
 * (or `el` itself) that is a direct child of `root`. Comment anchors live within
 * a single top-level block, so this aligns the dot with `data-pmk-offset`.
 */
function blockHostOf(el: HTMLElement, root: HTMLElement): HTMLElement {
  let host = el;
  while (host.parentElement && host.parentElement !== root && root.contains(host.parentElement)) {
    host = host.parentElement;
  }
  return host;
}

/** Add a single gutter dot to `host` (idempotent — one per block). */
function addGutterDot(host: HTMLElement): void {
  // Already dotted? (child for normal blocks, preceding sibling for tables.)
  if (host.querySelector(":scope > .pmk-gutter-dot")) return;
  const prev = host.previousElementSibling;
  if (prev && prev.classList.contains("pmk-gutter-dot")) return;

  const dot = document.createElement("span");
  dot.className = "pmk-gutter-dot";
  dot.setAttribute("aria-hidden", "true");

  host.classList.add("pmk-anchor");
  if (SPAN_HOSTILE_HOSTS.has(host.tagName)) {
    // A <span> child would be reparented out of a table/list — place it before.
    host.parentElement?.insertBefore(dot, host);
  } else {
    host.insertBefore(dot, host.firstChild);
  }
}

/** Scroll the preview to a comment highlight by id. */
export function scrollToCommentId(id: string): void {
  const root = document.getElementById("penmark-root");
  if (!root) return;
  const el = root.querySelector<HTMLElement>(`[data-pmk-id="${id}"]`);
  if (!el) return;
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  el.classList.add("pmk-hl-active");
}
