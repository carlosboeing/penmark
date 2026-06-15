# Architecture

Penmark is a single VS Code extension with a platform-agnostic core, built for a slim bundle, lazy activation, and incremental rendering. This page describes the shipped architecture; for the settings surface see [configuration.md](configuration.md), and for the decisions of record see the [ADRs](adrs/).

## Overview

A custom WebviewPanel preview ([ADR 0001](adrs/0001-custom-webview-panel-architecture.md)) renders markdown parsed host-side by markdown-it with per-block source offsets ([ADR 0005](adrs/0005-markdown-it-render-pipeline.md)), shipped to the webview over a versioned message protocol and applied incrementally with morphdom. The host stays slim and lazily loads the markdown-it render stack, highlight.js, and mermaid only when needed (activation under 50 ms, core VSIX under 1 MiB). Sanitization is DOMPurify in the webview, behind a strict nonce CSP.

Comments are stored single-file — invisible `pmk:` HTML-comment anchors in the text plus a hidden review block at the end of the same document ([ADR 0002](adrs/0002-single-file-comment-storage.md)), using span-wrapping marker pairs with a degradation ladder plus block/range anchors ([ADR 0006](adrs/0006-span-anchor-wrapping-with-degradation-ladder.md), superseding [ADR 0003](adrs/0003-anchor-model-and-encoding.md)). Resolving a comment deletes it; git history is the audit trail. The marker grammar is frozen in [`spec/penmark-format.md`](../spec/penmark-format.md), and CI proves it survives Prettier and markdownlint.

## Concept

The reviewing UI, in light and dark:

![Penmark concept, light theme](assets/penmark-concept-light.png)

![Penmark concept, dark theme](assets/penmark-concept-dark.png)

## Layout

A single package with a lint-enforced boundary ([ADR 0001](adrs/0001-custom-webview-panel-architecture.md)): `src/core` has zero `vscode` imports, so a future self-hosted web app could reuse the same engine and format.

```
src/
  core/        zero vscode imports (enforced by ESLint + Node-only tests)
    render/    markdown-it pipeline, source-offset stamping, sanitize
    comments/  format parser/serializer, anchor placement, reconcile, IDs
    protocol/  versioned message types shared with the webview
  vscode/      activation, commands, preview panel manager, WorkspaceEdit ops, settings, watchers
  webview/     separate esbuild entry: highlights, comment box, drawer, mermaid loader, lightbox, theme
```

## Data flow

1. `penmark.openPreview` renders the active markdown file in a singleton panel per editor column.
2. Host: parse (markdown-it), stamp a source offset on each block, extract anchors and entries, sanitize (DOMPurify), then post a `render` message to the webview.
3. Document changes (debounced ~300 ms) re-render incrementally in the webview (morphdom, not a wholesale `innerHTML` replace; diagrams re-render only if their source changed).
4. Selecting text in the preview maps the selection to source offsets via the offset attributes, snapping to a safe range; the host computes anchor placement (an AST-safety check) and applies a `WorkspaceEdit`.
5. Comment highlights render as a tint plus a gutter dot; the drawer lists all comments and the needs-attention bucket, with jump-to.
6. Scroll sync runs over the same offset map, both directions, gated by `penmark.scrollSync`.

## Webview lifecycle and security

A single reusable panel, with no `retainContextWhenHidden` — state is restored via `getState`/`setState`. The CSP is `default-src 'none'`; script and style by nonce only; images from workspace roots and `data:` only. `localResourceRoots` is limited to the extension bundle and the workspace folder. No network access, no telemetry, all assets bundled (no CDN).

## Mermaid

Mermaid is lazily imported only when a `mermaid` fence exists, rendered with `securityLevel: strict` and an `IntersectionObserver` for many-diagram documents; a failed diagram shows its source and error without breaking the page. Because mermaid emits styling that a strict nonce CSP would block, Penmark re-applies mermaid's intended inline styles via the CSSOM, scoped to the SVG, through a property allowlist (see the [ADR 0005](adrs/0005-markdown-it-render-pipeline.md) amendment).

## Performance budgets

- Core VSIX under 1 MiB (the mermaid chunk is excluded and lazy).
- Activation under 50 ms (`onCommand`/`onWebviewPanel` only — no `onLanguage`, no `workspaceContains`).
- First render under 300 ms for a 1k-line document; re-render preserves scroll position with no diagram flicker.
- A 10k-line document with 200 comments stays interactive.

These are enforced in CI by a bundle-size gate and a performance test layer.

## Error handling

- A corrupted or unparseable review block still renders the preview; an attention chip and the drawer surface "needs attention" with a raw view, and Penmark never auto-rewrites without user action.
- All comment mutations go through `WorkspaceEdit`, so undo always works and there are no direct file writes while the document is open in an editor.
- Reconcile is idempotent and read-only by default, because single-file storage means external edits are normal.
- Mermaid and highlight failures degrade per element, logged to an output channel (no console spam, no toasts unless actionable).

## Decisions of record

| ADR | Decision |
| --- | --- |
| [0001](adrs/0001-custom-webview-panel-architecture.md) | Custom WebviewPanel preview and the core boundary |
| [0002](adrs/0002-single-file-comment-storage.md) | Single-file comment storage, resolve = delete |
| [0003](adrs/0003-anchor-model-and-encoding.md) | Anchor model and encoding (superseded by 0006) |
| [0004](adrs/0004-name-penmark-and-dual-publishing.md) | Name "Penmark"; distribution and publishing |
| [0005](adrs/0005-markdown-it-render-pipeline.md) | markdown-it render pipeline and source offsets |
| [0006](adrs/0006-span-anchor-wrapping-with-degradation-ladder.md) | Span-anchor wrapping pairs and the degradation ladder |
