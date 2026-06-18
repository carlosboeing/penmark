# Usage

Penmark renders any markdown file in a clean, GitHub-style preview and lets you leave review comments anchored to the exact passage, then hand them back to a coding agent as a prompt.

## Open the preview

With a markdown file focused, run **Penmark: Open Preview to the Side**. It is available from:

- the editor title bar (preview icon),
- the editor context menu,
- the Command Palette (`Penmark: Open Preview to the Side`).

A preview panel opens beside the editor.

## Reading

- **GitHub-flavored markdown** — tables, task lists, footnotes, strikethrough, autolinks, and GitHub-compatible heading anchors.
- **Preview settings panel** — use **Preview settings** in the top bar to adjust theme, typography preset, text size, content width, comment-highlight intensity, and line height without leaving the preview. The panel writes the same `penmark.*` settings documented in [configuration.md](configuration.md).
- **Themes** — light, dark, or auto (follows the IDE), set from the settings panel or by `penmark.theme`. See [configuration.md](configuration.md).
- **Syntax highlighting** — code blocks are highlighted (highlight.js, loaded only when a language-tagged block exists), with a one-click **Copy** button.
- **Mermaid diagrams and images** — Mermaid diagrams render lazily; click a diagram or preview image to open a lightbox with zoom controls. Toggle Mermaid rendering with `penmark.mermaid.enabled`.
- **Scroll sync** — the editor and preview scroll together in both directions; toggle with `penmark.scrollSync`.

## Reviewing

The review workflow is Penmark's differentiator: comment on rendered prose the way you would in Google Docs.

1. **Select to comment** — drag-select a phrase in the preview. The selection snaps to a contiguous range with a live highlight preview, and an add-comment box appears. Type your comment and confirm (Enter to submit, Esc to cancel).
2. **Highlight + gutter dot** — the commented span gets a theme-aware highlight (intensity via `penmark.comments.highlightIntensity`) and a gutter dot.
3. **Resolve** — click a highlight or gutter dot to open a popover (distinct colors for human vs agent authors) with the comment body and a **Resolve** action. Resolving deletes the comment; git history is the audit trail.
4. **Drawer** — open the comments drawer to see every comment with jump-to. Comments orphaned by edits move to a **needs-attention** bucket with re-anchor and delete actions, and an amber attention chip appears in the top bar.
5. **Export** — run **Penmark: Export Review as Prompt** to copy the open comments (or write them to a file) as a structured, agent-ready prompt.

## How comments are stored

Comments live **inside the same `.md` file**: invisible HTML-comment anchors (`pmk:` markers) in the text, plus one hidden review block at the end of the document. The file stays clean markdown that GitHub and other tools render without noise, and the comments survive Prettier, markdownlint, and 3-way git merges. Adding and resolving a comment are single, undoable edits.

The format is specified in [`spec/penmark-format.md`](../spec/penmark-format.md), and the contract for agents acting on a reviewed document is [`AGENTS-GUIDE.md`](../AGENTS-GUIDE.md).

## Commands

| Command | ID | Description |
| --- | --- | --- |
| Penmark: Open Preview to the Side | `penmark.openPreview` | Open the rendered preview beside the editor. |
| Penmark: Export Review as Prompt | `penmark.exportReview` | Export the open comments as an agent-ready prompt. |
