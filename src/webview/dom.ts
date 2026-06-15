/**
 * Incremental DOM rendering for the Penmark webview (D5 — morphdom).
 *
 * D6: sanitize() runs here, before any DOM insertion.
 * ADR 0001: no vscode imports.
 */

import morphdom from "morphdom";
import { initSanitizer, sanitize } from "../core/render/sanitize.js";

let _sanitizerReady = false;

/**
 * Ensure the sanitizer is bound to the webview's native window.
 * Called once at module init time in production; tests call initSanitizer()
 * directly via the setup file before importing dom.ts.
 */
function ensureSanitizer(): void {
  if (_sanitizerReady) return;
  if (typeof window !== "undefined") {
    initSanitizer(window as unknown as Parameters<typeof initSanitizer>[0]);
    _sanitizerReady = true;
  }
}

ensureSanitizer();

/**
 * Render sanitized HTML into `root` using morphdom so unchanged top-level
 * blocks preserve DOM node identity (D5).
 *
 * The html is sanitized via DOMPurify before being applied (D6). morphdom
 * diffs the new tree against the existing DOM — unchanged nodes are kept in
 * place rather than replaced, so scroll position and node references survive
 * incremental re-renders.
 *
 * @param root  The container element to render into.
 * @param html  Raw (unsanitized) HTML from the render protocol message.
 */
export function renderInto(root: HTMLElement, html: string): void {
  ensureSanitizer();

  const safe = sanitize(html);

  // Build a scratch element to wrap the sanitized fragment so morphdom can
  // diff the full subtree of `root` against it.
  const next = document.createElement(root.tagName);
  // DOMPurify has already sanitized `safe`; this assignment is intentional
  // and safe — `safe` is the output of sanitize(), not raw untrusted input.
  next.innerHTML = safe;

  morphdom(root, next, {
    // Keep the root element itself — only morph its children.
    childrenOnly: true,
    onBeforeElUpdated(fromEl, toEl) {
      // Preserve an already-rendered mermaid diagram when its source is
      // unchanged (T9). The host re-emits an empty .pmk-mermaid container on
      // every render; without this, an unrelated edit elsewhere would wipe the
      // rendered svg and force a flickering re-render. Source-keyed: a real
      // diagram edit changes data-pmk-source, so morphdom updates it as normal.
      if (
        fromEl.classList?.contains("pmk-mermaid") &&
        toEl.classList?.contains("pmk-mermaid") &&
        fromEl.getAttribute("data-pmk-source") === toEl.getAttribute("data-pmk-source")
      ) {
        return false;
      }
      return true;
    },
  });
}
