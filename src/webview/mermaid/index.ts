/**
 * Mermaid diagram rendering for the Penmark webview (T9).
 *
 * Diagrams render lazily on two axes:
 *   - The whole module (mermaid + svg-pan-zoom, multiple MB) is a separate
 *     esbuild chunk imported by main.ts only when a .pmk-mermaid container
 *     exists (see src/webview/mermaid.ts + main.ts).
 *   - Within the page, each container renders only when scrolled into view, via
 *     IntersectionObserver — so a 50-diagram doc does not block on first paint.
 *
 * Design §5.4:
 *   - securityLevel: "strict"
 *   - theme follows the PREVIEW theme (light/dark), re-rendered on setTheme
 *   - per-diagram failure containment: a bad diagram shows its source + error
 *     and never breaks the page or sibling diagrams
 *
 * ADR 0001: no vscode imports.
 */

import mermaid from "mermaid";
import { openLightbox } from "./lightbox.js";
import { getScriptNonce, prepareMermaidSvgForCsp } from "./nonceStyles.js";
import { adaptMermaidDarkBackgrounds, rehydrateMermaidInlineStyles } from "./styleRehydration.js";

/** Marks a container's currently-rendered source, so unchanged ones are skipped. */
const RENDERED_SOURCE_ATTR = "data-pmk-rendered-source";

let _idSeq = 0;
let _currentTheme: "light" | "dark" = "light";
let _observer: IntersectionObserver | null = null;

/** Configure mermaid for the given preview theme. Idempotent. */
function initMermaid(theme: "light" | "dark"): void {
  _currentTheme = theme;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: theme === "dark" ? "dark" : "default",
  });
}

/**
 * Render a single container's diagram. Failure is contained: the container is
 * filled with the source in a <pre> plus the error message, and the caller
 * continues to the next diagram.
 */
async function renderContainer(el: HTMLElement): Promise<void> {
  const source = el.dataset.pmkSource ?? "";
  if (source.trim() === "") return;

  // Skip if already rendered with this exact source AND theme (re-render on
  // theme change clears the marker first — see renderMermaid).
  if (el.getAttribute(RENDERED_SOURCE_ATTR) === source) return;

  const id = `pmk-mermaid-svg-${_idSeq++}`;
  try {
    const { svg } = await mermaid.render(id, source);
    // svg is mermaid output produced under securityLevel:"strict" — mermaid
    // sanitizes it internally. This is the documented render() consumption
    // pattern; the source itself is never interpreted as HTML.
    //
    // Two CSP-blocked surfaces are restored after insertion (ADR 0005):
    //   1. Mermaid's embedded <style> tags carry no nonce, so rect/cluster
    //      fills fall back to SVG-default black — injectNonce fixes that.
    //   2. Mermaid lays out via inline style= attributes (svg max-width, label
    //      table-cell/centering, author colors). Those survive in the DOM but
    //      are not applied under style-src 'nonce-…'; rehydrate re-applies the
    //      allowlisted subset via the CSSOM, restoring mermaid's native layout.
    el.innerHTML = prepareMermaidSvgForCsp(svg, getScriptNonce());
    const svgEl = el.querySelector("svg");
    rehydrateMermaidInlineStyles(svgEl);
    // In dark mode, soften author-hardcoded light structural backgrounds
    // (subgraph fills, sequence highlight bands) so their light text stays
    // legible; semantic node colors are preserved (ADR 0005).
    adaptMermaidDarkBackgrounds(svgEl, _currentTheme === "dark");
    el.setAttribute(RENDERED_SOURCE_ATTR, source);
    el.classList.remove("pmk-mermaid--error");
    addExpandButton(el);
  } catch (err) {
    renderError(el, source, err);
  }
}

/** Build the contained-failure view: source + error, no markup injection. */
function renderError(el: HTMLElement, source: string, err: unknown): void {
  el.replaceChildren();
  el.classList.add("pmk-mermaid--error");

  const note = document.createElement("div");
  note.className = "pmk-mermaid-error-note";
  note.textContent = `Mermaid diagram failed to render: ${
    err instanceof Error ? err.message : String(err)
  }`;

  const pre = document.createElement("pre");
  pre.className = "pmk-mermaid-error-source";
  const code = document.createElement("code");
  code.textContent = source;
  pre.appendChild(code);

  el.appendChild(note);
  el.appendChild(pre);
  // Mark as rendered for this source so we do not retry endlessly; a real
  // source edit changes the attribute and re-renders.
  el.setAttribute(RENDERED_SOURCE_ATTR, source);
}

/** Add an "Expand" overlay button that opens the diagram in the lightbox. */
function addExpandButton(el: HTMLElement): void {
  if (el.querySelector(".pmk-mermaid-expand")) return;
  const svg = el.querySelector("svg");
  if (!svg) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "pmk-mermaid-expand";
  btn.textContent = "Expand";
  btn.setAttribute("aria-label", "Expand diagram");
  btn.addEventListener("click", () => {
    const current = el.querySelector("svg");
    if (current) openLightbox(current, _currentTheme, btn);
  });
  el.appendChild(btn);
}

/** (Re)create the IntersectionObserver that renders containers on scroll-in. */
function ensureObserver(): IntersectionObserver {
  if (_observer) return _observer;
  _observer = new IntersectionObserver(
    (entries, observer) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const el = entry.target as HTMLElement;
          observer.unobserve(el);
          void renderContainer(el);
        }
      }
    },
    { rootMargin: "200px" },
  );
  return _observer;
}

/**
 * Render every .pmk-mermaid container under `root`, lazily on scroll-into-view.
 * Diagrams whose source is unchanged since the last render are left untouched.
 *
 * @param root  Container holding the rendered markdown.
 * @param theme Resolved preview theme ("light" | "dark").
 */
export function renderMermaid(root: HTMLElement, theme: "light" | "dark"): void {
  const themeChanged = theme !== _currentTheme;
  initMermaid(theme);

  const observer = ensureObserver();
  const containers = root.querySelectorAll<HTMLElement>(".pmk-mermaid");
  for (const el of containers) {
    if (themeChanged) {
      // Force a re-render under the new theme by clearing the rendered marker.
      el.removeAttribute(RENDERED_SOURCE_ATTR);
    }
    if (el.getAttribute(RENDERED_SOURCE_ATTR) === (el.dataset.pmkSource ?? "")) {
      // Already current — nothing to do.
      continue;
    }
    observer.observe(el);
  }
}

/**
 * Render EVERY .pmk-mermaid container under `root` immediately — no
 * IntersectionObserver — and resolve when all are done (R17, export capture).
 * A serialized export must include below-the-fold diagrams the lazy path has
 * not reached yet. Containers already rendered with the current source+theme
 * are skipped (renderContainer's marker check), so an up-to-date preview pays
 * nothing. Failures are contained per diagram (the error view is itself valid
 * export content), so this never rejects.
 */
export async function renderMermaidAll(root: HTMLElement, theme: "light" | "dark"): Promise<void> {
  const themeChanged = theme !== _currentTheme;
  initMermaid(theme);

  const containers = root.querySelectorAll<HTMLElement>(".pmk-mermaid");
  for (const el of containers) {
    if (themeChanged) {
      el.removeAttribute(RENDERED_SOURCE_ATTR);
    }
    // Stop any pending lazy render on this container — we render it now.
    _observer?.unobserve(el);
    await renderContainer(el);
  }
}
