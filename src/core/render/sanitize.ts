/**
 * HTML sanitizer for Penmark rendered output (T3).
 *
 * D6 decision — WEBVIEW-SIDE: DOMPurify runs in the webview as the last step
 * before DOM insertion. Both host-side options were ruled out by the size gate:
 *   - DOMPurify + linkedom (host, node): 282 KB bundled — exceeds 250 KB limit
 *     (and linkedom's window lacks document.implementation, so DOMPurify.isSupported
 *     is false — it would not sanitize at all)
 *   - DOMPurify + jsdom (host, node): 3,138 KB bundled — far exceeds limit
 *   - DOMPurify alone (webview, browser): 27 KB — well within budget
 *
 * In production the webview calls sanitize() with the browser's native window
 * available. In tests (vitest node environment) jsdom provides the window.
 *
 * ADR 0001: no vscode imports in src/core. jsdom is a devDependency used only
 * in the test path; it is never bundled into the extension host or webview.
 *
 * Security note: DOMPurify defaults are used intentionally. The allow-list
 * is extended only for attributes required by the Penmark pipeline:
 *   - data-pmk-offset: source-line mapping for scroll sync (D4)
 * hljs and mermaid classes are class-attribute values — DOMPurify preserves
 * class attributes on allowed elements by default; no additional config needed.
 * HTML comments (including <!--pmk:...-->) are stripped by DOMPurify by default
 * (ALLOW_UNKNOWN_PROTOCOLS=false, keep comments=false) — this is correct; pmk
 * anchors are re-derived from the comment store, never read from the DOM.
 */

import createDOMPurify, { type WindowLike } from "dompurify";

type DOMPurifyInstance = ReturnType<typeof createDOMPurify>;

/**
 * Penmark `data-*` attributes the sanitizer force-keeps (DOMPurify strips all
 * data-* by default). Values are machine-generated, never attacker HTML:
 * data-pmk-offset (D4 scroll-sync line map), data-pmk-coff (R10 block source
 * char base for selection mapping), and the D12 highlight markers
 * data-pmk-id / data-pmk-state / data-pmk-block. data-pmk-source is handled
 * separately (it can contain `-->`, which needs the stash/restore hook below).
 */
const PMK_KEEP_ATTRS: ReadonlySet<string> = new Set([
  "data-pmk-offset",
  "data-pmk-coff",
  "data-pmk-soff",
  "data-pmk-line",
  "data-pmk-id",
  "data-pmk-state",
  "data-pmk-block",
]);

/**
 * DOMPurify profile for Penmark. `style` must be stripped explicitly — in the
 * webview's jsdom/browser binding the default profile does not always remove
 * `style=""` from markdown raw HTML, and each surviving attribute triggers a
 * CSP violation under `style-src 'nonce-…'` (no `'unsafe-inline'`).
 */
const SANITIZE_OPTS = {
  FORBID_ATTR: ["style"],
  FORBID_TAGS: ["style"],
} as const;

let _instance: DOMPurifyInstance | null = null;

/**
 * Create a DOMPurify instance bound to the given window. Exported for testing
 * (call with a jsdom window in node environments).
 */
export function createSanitizer(win: WindowLike): DOMPurifyInstance {
  const dp = createDOMPurify(win);
  // Allow the Penmark data-* attributes so they survive sanitization. All other
  // data-* attributes are stripped by default — this is intentional.
  //   - data-pmk-offset: source-line mapping for scroll sync (D4).
  //   - data-pmk-id / data-pmk-state / data-pmk-block: comment-highlight markers
  //     emitted by injectHighlights (D12). Their values are machine-generated
  //     (base32 id, a fixed state enum, empty) — never attacker-controlled HTML.
  dp.addHook("uponSanitizeAttribute", (node, data) => {
    if (PMK_KEEP_ATTRS.has(data.attrName)) {
      data.forceKeepAttr = true;
    }
  });

  // data-pmk-source carries mermaid diagram source (T9). Flowchart sources
  // routinely contain `-->`, which DOMPurify treats as a comment-close token and
  // strips the whole attribute over (forceKeepAttr cannot override this). Since
  // the value is only ever read back as a plain string via el.dataset.pmkSource
  // and handed to mermaid.render() under securityLevel:"strict" — never inserted
  // as HTML — it is safe to stash it before attribute sanitization and restore
  // it verbatim afterwards on .pmk-mermaid containers only.
  const sourceStash = new WeakMap<Node, string>();
  dp.addHook("uponSanitizeElement", (node) => {
    const el = node as Partial<Element> & Node;
    if (typeof el.getAttribute === "function" && el.classList?.contains("pmk-mermaid")) {
      const src = el.getAttribute("data-pmk-source");
      if (src !== null && src !== undefined) {
        sourceStash.set(node, src);
      }
    }
  });
  dp.addHook("afterSanitizeAttributes", (node) => {
    const src = sourceStash.get(node);
    if (src !== undefined && typeof (node as Partial<Element>).setAttribute === "function") {
      (node as Element).setAttribute("data-pmk-source", src);
    }
  });
  return dp;
}

/**
 * Lazily resolve the DOMPurify instance. In a browser (webview production
 * context) the global window is available on first call. In tests the caller
 * must call initSanitizer() before the first sanitize() call, or the node
 * global `window` must be provided by the test environment (jsdom).
 */
function getInstance(): DOMPurifyInstance {
  if (_instance) return _instance;

  // In browser: window is the native global.
  // In vitest/jsdom: global window is set by the jsdom environment.
  // In vitest/node: tests must call initSanitizer() first.
  const win = typeof window !== "undefined" ? (window as unknown as WindowLike) : undefined;

  if (!win) {
    throw new Error(
      "sanitize(): no window available. Call initSanitizer(window) before use in non-browser environments.",
    );
  }

  _instance = createSanitizer(win);
  return _instance;
}

/**
 * Initialise the sanitizer with an explicit window (required in Node/test
 * environments where window is not a global). Idempotent: subsequent calls
 * with the same window are no-ops; a different window replaces the instance.
 */
export function initSanitizer(win: WindowLike): void {
  _instance = createSanitizer(win);
}

/**
 * Sanitize rendered HTML before it reaches the webview DOM.
 *
 * Strips: script tags, event-handler attributes (on*=), javascript: URIs,
 * iframes, inline style attributes and <style> elements (CSP: style-src nonce),
 * and all HTML comments (including <!--pmk:...-->).
 * Preserves: data-pmk-offset, class (hljs/mermaid), id, href (https), src.
 */
export function sanitize(html: string): string {
  if (!html) return "";
  return getInstance().sanitize(html, SANITIZE_OPTS);
}
