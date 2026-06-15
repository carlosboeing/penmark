---
type: adr
status: approved
scope: [architecture]
date: 2026-06-11
---

# 0001 — Custom WebviewPanel for the preview; platform-agnostic core

## Context

The core feature — interactive inline commenting on rendered markdown — requires bidirectional messaging between the preview UI and the extension host. VS Code's built-in markdown preview accepts contributed scripts (`markdown.previewScripts`) but deliberately denies them `acquireVsCodeApi()` ([vscode#122961](https://github.com/microsoft/vscode/issues/122961)), so contributed scripts cannot talk back to the extension. A `CustomTextEditor` takeover of .md files is the audited failure mode of markdown-docs (default-priority hijack × `retainContextWhenHidden` × 16 MB per tab). A future self-hosted web app must reuse the same render + comment engine.

## Decision

1. v1 ships a **custom `WebviewPanel`** preview ("open preview to the side"), one reusable panel, no `retainContextWhenHidden` (state via `getState`/`setState`).
2. Markdown is **parsed in the extension host**; the webview receives rendered HTML + comment data over a **versioned message protocol**. Webview JS is limited to overlay/drawer/diagram/theme/zoom concerns.
3. The render pipeline and comment engine live in **`src/core` with zero `vscode` imports**, enforced by an ESLint `no-restricted-imports` boundary and by running core tests in plain Node. Single package — no monorepo until the web app is a real second consumer.
4. `CustomTextEditor` (edit mode) is deferred to v2 and, if built, registers with `priority: "option"`, never `"default"`.

## Options considered

- Extend built-in preview (markdown-it plugin + previewScripts): rejected — platform-incapable of interactive UI (no host channel).
- `CustomTextEditor` as the v1 surface: rejected — editor-takeover trust risk, document-sync complexity, and the measured markdown-docs failure mode.
- Monorepo packages from day one: rejected — `vsce` packaging friction and ceremony with exactly one consumer; the protected asset is the lint-enforced boundary, extractable later in an afternoon.

## Consequences

We own scroll-sync, link handling, asset resolution, CSP, and persistence — well-trodden problems. Reviewer consensus (multiple independent AI models) was unanimous on this architecture. The webview message protocol is itself versioned, since fork (Cursor/Antigravity) compatibility bugs tend to live at that boundary.
