---
type: adr
status: approved
scope: [rendering]
date: 2026-06-11
---

# 0005 — markdown-it render pipeline, parsed host-side

## Context

The renderer must match the visual quality of VS Code's built-in preview, stay slim, emit per-block source positions (required for click-to-comment and scroll sync), and run identically in the extension host today and a web app later.

## Decision

1. **markdown-it** with a curated GFM plugin set (tables, strikethrough, task lists, autolinks, footnotes, heading anchors) — the same engine as VS Code's built-in preview, synchronous, small, huge ecosystem.
2. A custom markdown-it rule/post-pass stamps **`data-pmk-offset` source positions on every block element** — the foundation for selection→anchor mapping and scroll sync. This is a Phase 1 acceptance criterion (retrofitting it later forces a renderer rework).
3. Syntax highlighting via **highlight.js** (lazy-loaded common-language subset). Shiki rejected for bundle weight.
4. Rendered HTML is **sanitized with DOMPurify** before reaching the webview; the webview runs under a nonce-locked CSP with no remote assets (markdown-preview-enhanced's CVE-2025-65716 is the cautionary tale; AI-generated markdown is untrusted input).
5. Parsing runs in the extension host (not duplicated in the webview); `worker_threads` offload is a future consideration for very large docs, not v1.

## Options considered

- unified/remark/rehype (markdown-review's pipeline): richer AST, heavier dependency graph, double-parse trap observed in the audit; rejected for the slimness goal.
- MDXEditor/Lexical (markdown-docs): WYSIWYG-editor stack, structurally heavy; wrong surface for a preview-first product.

## Consequences

Visual parity with the built-in preview comes nearly free (same engine + GitHub-style CSS). The plugin set is the curated extension point for future syntax (math, containers) — additions must pass the bundle-budget gate (ADR-less; budgets live in the design doc).

## Amendment — 2026-06-13 (v0.1.1): mermaid inline-style rehydration under the nonce CSP

**Context.** Mermaid lays out and measures diagrams with d3, whose `.style()` uses the CSSOM (`element.style.setProperty`) — which `style-src 'nonce-…'` does **not** police (script-driven style changes are trusted). So mermaid computes correct geometry during `render()`, then serialises those styles back into `style="…"` attributes. When the returned SVG is inserted via `innerHTML`, the browser **re-parses** those attributes from HTML and the nonce CSP blocks them. Symptoms: diagrams upscaled (blocked svg `max-width` → `width:100%` stretches to the panel), HTML labels mis-laid (blocked `display:table-cell`/centering), and author `style`/`classDef` colours dropped. VS Code's built-in preview and the reference extensions avoid this only by allowing `'unsafe-inline'` for styles — the posture point 4 rejects (MPE CVE-2025-65716).

**Decision.** Keep `style-src 'nonce-…'` (no `'unsafe-inline'`). After insertion, re-apply mermaid's intended inline styles via the CSSOM (script-driven, not policed by `style-src`), **scoped strictly to the rendered mermaid `<svg>` subtree**, through a **property allowlist** (layout / box-model / typography / SVG paint) that **rejects any value referencing an external `url()`** while keeping same-document `url(#id)` references mermaid needs for gradients and arrowhead markers. Mermaid's `<style>` element still gets the shell nonce injected so its theme/`classDef` CSS applies. A small document-level rule pins mermaid's default label font and zeroes `<p>` margins so mermaid's **off-screen measurement pass** — where its `<style>` is blocked by the same CSP — measures text at the same size it later displays (otherwise labels are sized ~32px too tall and sit above centre).

**Security.** Strictly tighter than `'unsafe-inline'`: inline styles are re-enabled only inside the mermaid SVG, only for mermaid's own `securityLevel:'strict'`-sanitized output, only for allowlisted properties, and never for external-resource `url()`. CSP still blocks any resource loads those styles could reference (`img-src` / `font-src` / `default-src 'none'`). Residual risk: an author directive whose value passes both mermaid's sanitizer and our allowlist could apply a benign-but-unexpected style; the allowlist and resource-load guards bound the impact. Implementation: [`src/webview/mermaid/styleRehydration.ts`](../../src/webview/mermaid/styleRehydration.ts).
