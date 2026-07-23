---
type: adr
status: approved
scope: [preview, search, compatibility]
date: 2026-07-24
---

# 0008 — In-preview Find fallback for editor forks

## Context

Penmark enables the native webview Find widget on both preview entry paths. It works in stock VS Code, but Cursor opens a widget that does not search the webview and Antigravity does not open the widget. The host consumes `Cmd/Ctrl+F` in those forks before the webview can handle it.

## Decision

Penmark keeps native Find enabled and adds a webview-native fallback: a **Search** control in the preview top bar and the bindable `penmark.find` command. The command sends the versioned `openFind` protocol message to the active preview.

The fallback walks text nodes under the preview root and adds transient `<mark>` decorations. It provides live match count, case sensitivity, previous/next navigation, and `Escape` focus restoration through the existing surface coordinator. It never changes the document selection or persisted Markdown, and it does not wrap across comment-anchor boundaries. Decorations are cleared before an incremental render and reapplied afterward when the search surface remains open.

Search work is bounded at 500 matches, 10,000 text nodes, or 1,000,000 text characters. A capped result is shown as `N+` and logged rather than silently appearing complete.

## Consequences

- The top-bar control and command are the reliable search path in VS Code, Cursor, and Antigravity.
- In stock VS Code, native `Cmd/Ctrl+F` remains available alongside Penmark Search; the duplication is intentional.
- Regex, replace, cross-file search, and reclaiming `Cmd/Ctrl+F` in editor forks remain out of scope.
