/**
 * Re-hydrate mermaid's inline styles under a nonce-locked CSP (ADR 0005).
 *
 * Mermaid lays out and *measures* diagrams using d3, whose `.style()` calls
 * `element.style.setProperty()` — the CSSOM, which `style-src 'nonce-…'` does
 * NOT police (script-driven style changes are trusted). So during
 * `mermaid.render()` every inline style applies and the geometry it computes
 * (node sizes, foreignObject dimensions, the diagram's natural width) is
 * correct. Mermaid then serialises the SVG to a string; the CSSOM styles
 * reflect back into `style="…"` attributes. When we assign that string via
 * `innerHTML`, the browser RE-PARSES those attributes from HTML — and now the
 * nonce CSP blocks them (a nonce can never authorise an inline `style=`
 * attribute; only `'unsafe-inline'` can). The geometry is intact but the
 * styling is gone, which is why diagrams upscale and labels misalign.
 *
 * The fix: re-apply mermaid's intended inline styles via the CSSOM after
 * insertion. We do NOT relax the CSP. To keep the posture tight we re-apply
 * only an allowlist of layout/paint properties, and we reject any value that
 * references an external `url()` (CSS exfiltration vector) while keeping
 * same-document `url(#fragment)` references mermaid needs for gradients and
 * markers. CSP still blocks the resource loads regardless; this is
 * defense-in-depth on top of mermaid's `securityLevel: 'strict'` sanitization.
 */

/**
 * CSS properties Penmark re-applies from mermaid's (sanitized) inline styles.
 * Layout, box model, typography, and SVG/paint properties only — deliberately
 * excludes positioning (`position`, `top`/`left`, `z-index`), `pointer-events`,
 * and resource-only properties (`background-image`, `mask`, `clip-path`,
 * `filter`) that have no layout role but widen the attack surface.
 */
export const SAFE_STYLE_PROPS: ReadonlySet<string> = new Set([
  // Box / layout
  "display",
  "box-sizing",
  "width",
  "min-width",
  "max-width",
  "height",
  "min-height",
  "max-height",
  "overflow",
  "overflow-x",
  "overflow-y",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  // Text flow
  "text-align",
  "vertical-align",
  "white-space",
  "line-height",
  "overflow-wrap",
  "word-break",
  "word-wrap",
  "text-overflow",
  // SVG text positioning — mermaid centers SVG <text> labels (e.g. sequence
  // actors) with `text-anchor: middle` set via d3 .style(); without these the
  // text falls back to start/baseline and renders off-centre.
  "text-anchor",
  "dominant-baseline",
  "alignment-baseline",
  // Typography
  "color",
  "font",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "font-variant",
  "letter-spacing",
  "text-decoration",
  // Paint (SVG)
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-dasharray",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-opacity",
  "opacity",
  // Background (color only in practice; url() guarded by isSafeStyleValue)
  "background",
  "background-color",
  // Borders
  "border",
  "border-width",
  "border-style",
  "border-color",
  "border-radius",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-left-radius",
  "border-bottom-right-radius",
  // Visual transform (mermaid mostly uses the transform attribute, not style)
  "transform",
  "transform-origin",
]);

/**
 * Reject style values that reference an external resource via `url()`. Only
 * same-document fragment references (`url(#id)`) are allowed — mermaid uses
 * those for gradient and arrowhead-marker fills.
 */
export function isSafeStyleValue(value: string): boolean {
  // Inspect every `url(...)` occurrence; the target (after optional whitespace
  // and an optional quote) must start with `#` to be a same-document reference.
  const urlRef = /url\(\s*['"]?\s*([^'")]*)/gi;
  let match: RegExpExecArray | null;
  while ((match = urlRef.exec(value)) !== null) {
    if (!(match[1] ?? "").startsWith("#")) return false;
  }
  return true;
}

/**
 * Re-apply one element's allowlisted inline styles via the CSSOM.
 * The blocked `style=` attribute string survives in the DOM (readable via
 * getAttribute) even though the browser refused to apply it; we parse it with
 * the browser's own CSS parser (a detached element) and re-apply the safe
 * subset.
 */
export function rehydrateElementStyles(el: Element): void {
  const raw = el.getAttribute("style");
  if (!raw) return;

  const parsed = el.ownerDocument.createElement("span").style;
  parsed.cssText = raw;

  const target = (el as HTMLElement | SVGElement).style;
  target.cssText = "";
  for (let i = 0; i < parsed.length; i++) {
    const prop = parsed.item(i);
    if (!SAFE_STYLE_PROPS.has(prop)) continue;
    const value = parsed.getPropertyValue(prop);
    if (!isSafeStyleValue(value)) continue;
    target.setProperty(prop, value, parsed.getPropertyPriority(prop));
  }
}

/**
 * Re-hydrate allowlisted inline styles for a rendered mermaid `<svg>` and every
 * descendant carrying a (CSP-blocked) `style=` attribute. Scoped strictly to
 * the SVG subtree so no other preview content is affected.
 */
export function rehydrateMermaidInlineStyles(svg: SVGElement | null): void {
  if (!svg) return;
  rehydrateElementStyles(svg);
  for (const el of svg.querySelectorAll("[style]")) {
    rehydrateElementStyles(el);
  }
}

/**
 * True when an SVG fill color is light (relative luminance > 0.5) — i.e. a
 * background authored for a light canvas.
 */
export function isLightFill(fill: string): boolean {
  const m = fill.match(/[\d.]+/g);
  if (!m || m.length < 3) return false;
  const lin = (v: number): number => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const [r = 0, g = 0, b = 0] = m.map(Number);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) > 0.5;
}

/**
 * Background elements an author hard-coded with a light fill (assuming a light
 * canvas): sequence-diagram highlight bands (`rect rgb(...)`) and subgraph
 * cluster fills. Selecting the cluster's *direct* rect/polygon/path child avoids
 * dimming the semantic node shapes nested inside it.
 */
const MERMAID_STRUCTURAL_BG_SELECTOR =
  "rect.rect, .cluster > rect, .cluster > polygon, .cluster > path";

/**
 * Adapt author-hardcoded LIGHT structural backgrounds for the dark preview
 * theme. Mermaid's dark theme renders label text light, but author light bands /
 * cluster fills stay light, so the text washes out. We keep the authored hue but
 * drop its opacity so the band reads as a subtle dark-tinted region and its
 * light text becomes legible. Semantic node colors (`.node` shapes) are left
 * untouched — only structural backgrounds with a genuinely light fill are
 * softened. No-op in light mode (ADR 0005: reader picks the theme, not the
 * diagram author).
 */
export function adaptMermaidDarkBackgrounds(svg: SVGElement | null, dark: boolean): void {
  if (!svg || !dark) return;
  for (const el of svg.querySelectorAll<SVGElement>(MERMAID_STRUCTURAL_BG_SELECTOR)) {
    if (isLightFill(getComputedStyle(el).fill)) {
      el.style.setProperty("fill-opacity", "0.18");
    }
  }
}
