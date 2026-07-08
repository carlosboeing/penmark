---
type: adr
status: approved
scope: [export, rendering]
date: 2026-07-07
---

# 0007 — Export to HTML/PDF via preview-DOM capture; PDF via system Chromium

## Context

Penmark gains **Export as HTML** and **Export as PDF** (maintainer directive 2026-07-06 — revisiting the roadmap's earlier "declined: PDF export" stance for the markdown-native case). The requirement is fidelity: the exported document must look identical to the preview — typography presets, theme tokens, spacing, syntax highlighting, and rendered Mermaid diagrams — and be a high-quality, self-contained artifact.

Three preview stages exist only in a browser context, so a host-side re-render cannot reproduce the preview:

1. **Sanitization** runs in the webview (DOMPurify, D6) — host-side DOMPurify+jsdom/linkedom busted the 250 KB size gate (ADR 0005).
2. **Mermaid SVG** is produced by `mermaid.render()` in the webview.
3. **Mermaid styling** exists as rehydrated inline `style=` attributes only in the live webview DOM (ADR 0005 amendment).

## Decision

1. **Export captures the preview webview's DOM.** The host posts `exportCapture`; the webview force-renders every Mermaid diagram (bypassing the lazy IntersectionObserver), clones the root, strips preview-only chrome (copy/expand buttons, gutter dots), dissolves review-comment highlight markup (the export is the document, not the review), drops machine `data-pmk-*` attributes, and posts the serialized snapshot back. The export equals the preview *by construction*.
2. **The standalone document is assembled host-side** from the snapshot: the shipped stylesheets (`theme-light`/`theme-dark`/`penmark.css` plus a small `export.css` with print rules) are inlined, the resolved theme and typography variables are pinned, local images are re-encoded as `data:` URIs, and a defense-in-depth CSP meta blocks scripts. The output contains **zero JavaScript**.
3. **PDF is printed by a system-installed Chromium-based browser** (`--headless --print-to-pdf --no-pdf-header-footer`), auto-discovered (Chrome, Edge, Chromium, Brave) or set via `penmark.export.chromiumPath`. Page geometry comes from an `@page` rule (`penmark.export.pdfPageSize`); print CSS enforces page-break discipline and exact color reproduction. When no browser is found the command degrades to offering the HTML export — PDF is additive, never a hard dependency.

## Options considered

- **Host-side re-render for export** — cannot sanitize (no window) or render Mermaid; would duplicate the pipeline and still diverge from the preview. Rejected.
- **Bundling a print engine (puppeteer/playwright-core + Chromium)** — hundreds of MB against a 1 MiB core budget; the markdown-pdf extension's weight is the cautionary tale. Rejected.
- **CDN-loaded mermaid in the exported HTML** — breaks offline viewing and the no-remote-assets posture; pre-rendered SVG is both more faithful and inert. Rejected.
- **A JS PDF generator (pdfkit et al.)** — reimplements HTML/CSS/SVG layout badly; fidelity is the whole requirement. Rejected.

## Consequences

- Export requires a preview panel (reused when open, opened otherwise) — honest WYSIWYG semantics and zero duplicated rendering code.
- Exported HTML is a single self-contained file: portable, safe to open anywhere (sanitized content + CSP, no scripts), and prints from any browser with the same `@page` setup the PDF command uses.
- PDF quality is Chromium print quality, deterministic because the input has no scripts.
- New protocol messages (`exportCapture`/`exportCaptured`) ride the existing versioned channel; capture requests retry until the webview has rendered, so the handshake has no new race surface.

## Amendment — 2026-07-07: options dialog, always-light exports, CDP printing

Maintainer feedback after first manual testing reshaped three decisions:

1. **Exports are always light.** A theme option was considered and cut — shared documents read on white regardless of the author's IDE theme. Only the light token stylesheet is inlined; the capture force-renders mermaid diagrams under the light theme even from a dark preview (SVGs are theme-baked) and restores the preview's theme afterwards.
2. **An export options dialog in the preview** (topbar **Export** button; the editor/palette commands open the same dialog via `exportShowOptions`). Options: frontmatter card (excluded by default), a generated linked table of contents (h1–h3, built from the cleaned capture DOM), content width, PDF page size, margin presets, and a header/footer toggle. Confirmation posts `exportRequest`; per-invocation options ride the protocol, `penmark.export.*` settings hold the durable defaults.
3. **PDF prints over the DevTools protocol pipe** (`--remote-debugging-pipe`, fds 3/4, NUL-delimited JSON — no network port, no websocket, no dependencies) because header/footer with page numbers is impossible via CLI flags: Chromium's default page chrome prints the temp-file URL, which fails the quality bar. `Page.printToPDF` provides the title header, "page / total" footer, exact margins, and `printBackground`. The flag-based CLI printer remains the fallback (without page chrome) so a quirky browser build degrades instead of blocking, and the exported HTML keeps an `@page` rule so manual browser printing approximates the PDF command (the CDP temp file omits it — print margins must not compound).

Two print-robustness findings from CI hardening (both shipped): the exported print stylesheet pins **concrete, embeddable monospace fonts** for code (`ui-monospace` resolves through fontconfig to a TTC collection font on some Linux setups — CJK-configured desktops, the Playwright CI image — which Chromium's print compositor cannot embed, failing the whole print), and both printers pass **`--disable-dev-shm-usage`** (containers and low-memory hosts mount a tiny /dev/shm, starving the renderer on multi-page prints — the same default Playwright's launcher uses).
