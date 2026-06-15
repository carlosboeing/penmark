/**
 * CSP nonce helpers for mermaid SVG output (ADR 0005).
 *
 * Mermaid embeds per-diagram styling in `<style>` elements inside the generated
 * SVG. Under a strict `style-src 'nonce-…'` policy those tags are blocked unless
 * they carry the same nonce as the webview shell. Stadium/rounded nodes often
 * survive without the stylesheet (inline fills); rects and subgraph clusters do
 * not — they fall back to SVG-default black fills with illegible text.
 *
 * Mermaid's inline `style=` attributes (svg max-width, foreignObject label
 * layout, author colors) are blocked by the same CSP; styleRehydration.ts
 * re-applies the allowlisted subset via the CSSOM after insertion. Here we also
 * set foreignObject `overflow` as an SVG attribute (immune to style-src).
 */

/** Read the shell script's CSP nonce (set on the bundle `<script nonce>` tag). */
export function getScriptNonce(): string {
  const script = (document.querySelector('script[src*="main"]') ??
    document.querySelector('script[type="module"]') ??
    document.querySelector("script[nonce]")) as HTMLElement | null;
  // The `nonce` IDL property — not getAttribute, which browsers blank out once
  // the document is parsed (nonce hiding).
  return script?.nonce ?? "";
}

/**
 * Add `nonce` to every `<style>` tag in a mermaid SVG string so the browser
 * applies mermaid's embedded stylesheet under a nonce-locked CSP.
 */
export function injectNonceIntoSvgStyles(svg: string, nonce: string): string {
  if (nonce === "") return svg;
  // Replace existing nonce if mermaid ever emits one; otherwise inject before
  // the first attribute or the closing `>`.
  return svg.replace(/<style\b([^>]*)>/gi, (_match, attrs: string) => {
    const withoutNonce = attrs.replace(/\s*nonce="[^"]*"/gi, "");
    return `<style nonce="${nonce}"${withoutNonce}>`;
  });
}

/**
 * Prepare mermaid SVG HTML for insertion under a nonce-locked CSP.
 * Combines style-tag nonce injection with foreignObject overflow patching.
 */
export function prepareMermaidSvgForCsp(svg: string, nonce: string): string {
  let out = injectNonceIntoSvgStyles(svg, nonce);
  // Mermaid 11.15+ emits `.label foreignobject` CSS that fails under XML-style
  // matching; the SVG `overflow` attribute works regardless (issue #7759).
  out = out.replace(/<foreignObject\b(?![^>]*\soverflow=)/gi, '<foreignObject overflow="visible"');
  return out;
}
