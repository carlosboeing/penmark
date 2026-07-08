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
 * Exports are ALWAYS light-themed: diagrams are force-rendered under the
 * light theme for the snapshot even when the preview is dark, then restored
 * to the preview theme afterwards (a brief flip in a dark preview is the
 * honest cost of a theme-baked SVG format).
 *
 * ADR 0001: no vscode imports.
 */

import { ensureMermaid, ensureMermaidAll, hasMermaid } from "./mermaidLoader.js";

/** Capture-relevant subset of the export options (chosen in the dialog). */
export interface CaptureOptions {
  includeFrontmatter: boolean;
  includeToc: boolean;
}

/** What the capture hands the host for document assembly. */
export interface CaptureResult {
  /** Cleaned innerHTML of #penmark-root. */
  html: string;
  /** Outer HTML of the frontmatter card (forced open), when requested and present. */
  frontmatterHtml?: string;
  /** Generated table of contents (h1–h3), when requested and headings exist. */
  tocHtml?: string;
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

/** Heading levels included in the generated table of contents. */
const TOC_SELECTOR = "h1[id], h2[id], h3[id]";

/**
 * Build a nested table of contents from the CLEANED clone's h1–h3 headings
 * (ids come from markdown-it-anchor, so anchors match GitHub slugs). Returns
 * undefined when the document has no eligible headings. Exported for tests.
 */
export function buildTocHtml(clone: Element): string | undefined {
  const headings = [...clone.querySelectorAll<HTMLHeadingElement>(TOC_SELECTOR)];
  if (headings.length === 0) return undefined;

  const doc = clone.ownerDocument;
  const nav = doc.createElement("nav");
  nav.className = "pmk-toc";
  nav.setAttribute("aria-label", "Table of contents");
  const title = doc.createElement("p");
  title.className = "pmk-toc-title";
  title.textContent = "Contents";
  nav.appendChild(title);

  const rootList = doc.createElement("ol");
  nav.appendChild(rootList);
  // Stack of open lists, indexed by depth relative to the shallowest level.
  const listStack: HTMLOListElement[] = [rootList];
  let lastItem: HTMLLIElement | null = null;
  const minLevel = Math.min(...headings.map((h) => Number(h.tagName[1])));

  for (const heading of headings) {
    const depth = Number(heading.tagName[1]) - minLevel;
    while (listStack.length - 1 > depth) {
      listStack.pop();
    }
    while (listStack.length - 1 < depth) {
      // A deeper heading opens a nested list under the previous item (or the
      // current list itself when the document skips levels at the start).
      const nested = doc.createElement("ol");
      (lastItem ?? listStack[listStack.length - 1]!).appendChild(nested);
      listStack.push(nested);
    }
    const item = doc.createElement("li");
    const link = doc.createElement("a");
    link.href = `#${heading.id}`;
    link.textContent = heading.textContent ?? "";
    item.appendChild(link);
    listStack[listStack.length - 1]!.appendChild(item);
    lastItem = item;
  }

  return nav.outerHTML;
}

/**
 * Serialize the preview for export: force-render all diagrams on the LIGHT
 * theme, clean a clone of `root`, generate the optional frontmatter/TOC
 * blocks, then restore the preview's diagrams to `previewTheme`. Never
 * mutates the live preview content otherwise.
 *
 * @param root          The live #penmark-root element.
 * @param previewTheme  The preview's resolved theme, restored after capture.
 * @param options       Capture options from the export dialog.
 * @param ensureAll     Injectable mermaid render-all (test seam).
 * @param ensureLazy    Injectable lazy renderer used for the restore (test seam).
 */
export async function captureExport(
  root: HTMLElement,
  previewTheme: "light" | "dark",
  options: CaptureOptions,
  ensureAll: typeof ensureMermaidAll = ensureMermaidAll,
  ensureLazy: typeof ensureMermaid = ensureMermaid,
): Promise<CaptureResult> {
  const hasDiagrams = hasMermaid(root);
  if (hasDiagrams) {
    await ensureAll(root, "light");
  }

  const clone = root.cloneNode(true) as HTMLElement;
  cleanExportDom(clone);

  // Restore the preview's own diagram theme lazily (observer path — only
  // visible diagrams re-render now). No-op when the preview is light.
  if (hasDiagrams && previewTheme !== "light") {
    void ensureLazy(root, previewTheme);
  }

  // The frontmatter card lives OUTSIDE #penmark-root (inserted before it by
  // frontmatterCard.ts). Included only on request (excluded by default),
  // forced open — a collapsed <details> prints as just its summary line.
  let frontmatterHtml: string | undefined;
  if (options.includeFrontmatter) {
    const card = root.ownerDocument.getElementById("pmk-frontmatter-card");
    if (card) {
      const cardClone = card.cloneNode(true) as HTMLElement;
      cardClone.setAttribute("open", "");
      frontmatterHtml = cardClone.outerHTML;
    }
  }

  return {
    html: clone.innerHTML,
    frontmatterHtml,
    tocHtml: options.includeToc ? buildTocHtml(clone) : undefined,
    rootStyle: root.getAttribute("style") ?? "",
  };
}
