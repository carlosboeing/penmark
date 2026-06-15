# Release smoke checklist — Penmark v0.5.0 (Review MVP)

The v0.5 manual cross-IDE gate, run against the **sideloaded VSIX** (local-first, ADR 0004 amendment). This is the layer-4 / real-IDE verification that plan D16 deferred: automated CI already covers unit/jsdom/Playwright goldens + the `src/core/comments` logic, and the blocking merge/orphan golden suite (R16) proves the format survives 3-way merges — but **no headless harness exercises the real add→resolve→drawer→export journey inside a live IDE**, and the layer-4 extension test is broken on the macOS dev host (tsx/esbuild drift). This checklist closes that gap.

Run it once per IDE after the release. The v0.1 **reading** path (rendering, themes, mermaid, copy, scroll sync) is covered by [release-smoke-checklist.md](release-smoke-checklist.md) — run that too if not already signed off; this checklist focuses on **commenting**.

## 0. Get the VSIX

Download `penmark-markdown-review-0.5.0.vsix` from the [GitHub Release](https://github.com/carlosboeing/penmark/releases/tag/v0.5.0) (attached to the `v0.5.0` tag).

## 1. Install (per IDE)

Each IDE is a VS Code fork with its own CLI binary. Use the UI path if the CLI is not on `PATH`. **Uninstall any earlier Penmark build first**, then reload the window.

| IDE | CLI install | UI install |
|---|---|---|
| VS Code | `code --install-extension penmark-markdown-review-0.5.0.vsix` | Extensions view → `...` menu → **Install from VSIX…** |
| Cursor | `cursor --install-extension penmark-markdown-review-0.5.0.vsix` | Extensions view → `...` → **Install from VSIX…** |
| Antigravity | `antigravity --install-extension penmark-markdown-review-0.5.0.vsix` | Extensions view → `...` → **Install from VSIX…** |

Compatibility floor is `engines.vscode ^1.105.0` (Cursor 1.105 base, Antigravity 1.107).

## 2. Test document

Open a markdown file with enough prose to comment on. Paste this into a scratch `.md` (a real design/plan doc works just as well):

````markdown
# Review smoke test

The authentication service validates the token verification path on every request.
It must sustain fifty thousand requests per second at peak load without degrading.

## Design notes

The high-level design favors a single-file store. The low-level details are deferred
to a follow-up. A reviewer should be able to comment on any phrase here, resolve it,
and hand the open comments to an agent as a prompt.

- first point
- second point
````

Run **Penmark: Open Preview** with this doc focused.

## 3. Checks (repeat for VS Code, Cursor, Antigravity)

### Add flow

- [ ] **Select-to-comment** — drag-select a phrase in the **preview** (e.g. "token verification path"); the selection snaps to a contiguous range with a visible highlight preview and an add-comment affordance appears.
- [ ] **Add box** — invoking it opens an inline comment box; typing a comment and confirming adds it. The box is keyboard-usable (type, **Enter**/button to submit, **Esc** to cancel).
- [ ] **Anchor written to source** — switch to the editor: the commented phrase is now wrapped in `<!--pmk:s …-->…<!--/pmk:s …-->` and a `<!-- pmk:review v1 -->` block sits at the **end of the file** with the entry (`author (human) · timestamp`, a `> ` quote line, and the body). This is one undo step (**Ctrl/Cmd-Z** removes the whole comment).
- [ ] **Highlight + gutter dot** — back in the preview the commented span shows a subtle highlight and a gutter dot. Try `penmark.comments.highlightIntensity` = subtle / medium / strong (reopen the preview) — the highlight strength changes.

### Popover + resolve

- [ ] **Popover** — clicking the highlighted span opens a popover with the comment body and author avatar (blue = human). It closes on **Esc** and on outside-click.
- [ ] **Resolve** — the popover's **Resolve** action removes the highlight, the marker pair, and the entry together in one edit; if it was the last comment the whole `pmk:review` block is gone. One undo restores it.

### Drawer + attention

- [ ] **Drawer** — the comments drawer opens (top-bar affordance), lists every open comment, and **jump-to** scrolls the preview to the anchored span.
- [ ] **Needs-attention + orphan** — in the editor, delete the commented sentence's text but leave the marker pair (an empty `<!--pmk:s …--><!--/pmk:s …-->`), or destroy the closing marker. On re-render the comment appears in the drawer's **needs-attention** bucket and the amber **attention chip** shows in the top bar. Re-anchor and delete affordances work.
- [ ] **No silent loss** — a comment whose target text is gone is never dropped silently; it always surfaces in needs-attention with its advisory quote.

### Export

- [ ] **Export review as prompt** — the export command copies (or writes to a file) the open review as a structured agent-ready prompt containing each comment's quote and body. Paste it somewhere to confirm it is coherent.

### Hygiene

- [ ] **Live re-render** — editing source unrelated to a comment keeps the highlight attached and the drawer correct after the debounce (morphdom does not strip the comment UI).
- [ ] **Themes** — repeat a popover-open + drawer-open in both light and dark (`penmark.theme`); highlight, popover, drawer, and chip are legible with adequate contrast in both.
- [ ] **Clean console** — open the webview devtools (**Developer: Open Webview Developer Tools**); no errors or CSP violations on add, resolve, drawer open, orphan, or export.

## 4. Sign-off

| IDE | Version | Date | Result | Notes |
|---|---|---|---|---|
| VS Code | | | pass / fail | |
| Cursor | | | pass / fail | |
| Antigravity | | | pass / fail | |

A failure in any row blocks sign-off for that IDE — file an issue with the IDE/version, the step, and any console output, then re-run after the fix.

## Known limitation (not a smoke failure)

If you hand-resolve a 3-way merge by keeping **two** `pmk:review` blocks, the non-EOF block's comments surface only via the corruption flag, not yet in needs-attention (§8.5, tracked post-v0.5). No data is lost. Resolving such a conflict by unioning into one block is fully lossless. Do not file this as a smoke failure.
