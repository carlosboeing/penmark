/**
 * Export capture (R17, ADR 0007): serialize the live preview DOM for the
 * standalone HTML/PDF export.
 *
 * The preview DOM is the only place where all render stages exist together —
 * DOMPurify-sanitized markup (D6), highlight.js output, and mermaid SVGs with
 * their CSP-rehydrated inline styles — so the export snapshots it instead of
 * re-rendering host-side. Before serializing, every mermaid diagram is
 * force-rendered (the lazy IntersectionObserver path only renders what has
 * scrolled into view), then a CLONE is cleaned of preview-only chrome so the
 * live preview is never mutated.
 *
 * ADR 0001: no vscode imports.
 */

import { ensureMermaidAll, hasMermaid } from "./mermaidLoader.js";

/** What the capture hands the host for document assembly. */
export interface CaptureResult {
  /** Cleaned innerHTML of #penmark-root. */
  html: string;
  /** Outer HTML of the frontmatter card (forced open), when present. */
  frontmatterHtml?: string;
  /** Inline style of #penmark-root (typography CSS custom properties). */
  rootStyle: string;
}

/** Preview-only chrome removed from the export outright. */
const STRIP_SELECTOR = ".pmk-copy-btn, .pmk-mermaid-expand, .pmk-gutter-dot";

/**
 * Comment-highlight wrappers unwrapped (children kept): the export is the
 * document, not the review (design non-goal), so span marks and range wrappers
 * dissolve back into plain content.
 */
const UNWRAP_SELECTOR = "mark.pmk-hl, div.pmk-hl-range";

/**
 * Machine-generated attributes with no meaning outside the live preview:
 * source offsets (scroll sync), comment-highlight markers, and the mermaid
 * source/render bookkeeping (the rendered SVG replaces the source).
 */
const STRIP_ATTRS = [
  "data-pmk-offset",
  "data-pmk-coff",
  "data-pmk-soff",
  "data-pmk-line",
  "data-pmk-id",
  "data-pmk-state",
  "data-pmk-block",
  "data-pmk-source",
  "data-pmk-rendered-source",
] as const;

/** Replace `el` with its children, preserving order. */
function unwrap(el: Element): void {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) {
    parent.insertBefore(el.firstChild, el);
  }
  el.remove();
}

/**
 * Clean a DETACHED clone of the preview root in place: strip chrome, unwrap
 * comment highlights, drop machine attributes. Exported for unit tests.
 */
export function cleanExportDom(clone: Element): void {
  for (const el of clone.querySelectorAll(STRIP_SELECTOR)) {
    el.remove();
  }
  for (const el of clone.querySelectorAll(UNWRAP_SELECTOR)) {
    unwrap(el);
  }
  for (const attr of STRIP_ATTRS) {
    for (const el of clone.querySelectorAll(`[${attr}]`)) {
      el.removeAttribute(attr);
    }
  }
  // Block-anchored elements gain a helper class from the highlight installer.
  for (const el of clone.querySelectorAll(".pmk-anchor")) {
    el.classList.remove("pmk-anchor");
    if (el.getAttribute("class") === "") {
      el.removeAttribute("class");
    }
  }
}

/**
 * Serialize the preview for export: force-render all diagrams, then clean a
 * clone of `root`. Never mutates the live preview content (mermaid rendering
 * aside, which only completes what the preview would render anyway).
 *
 * @param root       The live #penmark-root element.
 * @param theme      Resolved preview theme (diagram theme must match).
 * @param ensureAll  Injectable mermaid render-all (test seam); defaults to the
 *                   real lazy-chunk loader.
 */
export async function captureExport(
  root: HTMLElement,
  theme: "light" | "dark",
  ensureAll: typeof ensureMermaidAll = ensureMermaidAll,
): Promise<CaptureResult> {
  if (hasMermaid(root)) {
    await ensureAll(root, theme);
  }

  const clone = root.cloneNode(true) as HTMLElement;
  cleanExportDom(clone);

  // The frontmatter card lives OUTSIDE #penmark-root (inserted before it by
  // frontmatterCard.ts). Include it, forced open — a collapsed <details>
  // prints as just its summary line, hiding the metadata on paper.
  let frontmatterHtml: string | undefined;
  const card = root.ownerDocument.getElementById("pmk-frontmatter-card");
  if (card) {
    const cardClone = card.cloneNode(true) as HTMLElement;
    cardClone.setAttribute("open", "");
    frontmatterHtml = cardClone.outerHTML;
  }

  return {
    html: clone.innerHTML,
    frontmatterHtml,
    rootStyle: root.getAttribute("style") ?? "",
  };
}
