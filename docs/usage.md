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
- **Preview settings panel** — use **Preview settings** in the top bar to adjust theme, typography preset, text size, content width, code wrapping, and comment-highlight intensity without leaving the preview; an **Open all Penmark settings** link at the bottom reaches less-common options like font family and line height. The panel writes the same `penmark.*` settings documented in [configuration.md](configuration.md).
- **Themes** — light, dark, or auto (follows the IDE), set from the settings panel or by `penmark.theme`. See [configuration.md](configuration.md).
- **Syntax highlighting** — code blocks are highlighted (highlight.js, loaded only when a language-tagged block exists), with a one-click **Copy** button. Toggle live wrapping of long code lines with `penmark.codeBlockWrap`.
- **Native Find** — `Ctrl/Cmd+F` opens the IDE's built-in Find widget scoped to the preview when it has focus.
- **Reading metadata** — a compact word-count and reading-time line sits beside the document title.
- **Mermaid diagrams and images** — Mermaid diagrams render lazily; click a diagram or preview image to open a lightbox with zoom controls. Toggle Mermaid rendering with `penmark.mermaid.enabled`.
- **Scroll sync** — the editor and preview scroll together in both directions; toggle with `penmark.scrollSync`.
- **Responsive panels** — Settings and Comments share one persistent preview surface: at 1050px or wider the Comments panel reserves space beside the document (Settings always overlays); narrower than that both overlay; below 700px the open panel takes near the full width. Only one panel is open at a time, and closing one returns focus to the button that opened it. If your OS is set to reduce motion, Penmark's own panel and highlight transitions skip animation.

## Reviewing

The review workflow is Penmark's differentiator: comment on rendered prose the way you would in Google Docs.

1. **Select to comment** — drag-select a phrase in the preview. The selection snaps to a contiguous range with a live highlight preview, and an add-comment box appears. Type your comment and confirm (Enter to submit, Esc to cancel).
2. **Highlight + gutter dot** — the commented span gets a theme-aware highlight (intensity via `penmark.comments.highlightIntensity`) and a gutter dot.
3. **Resolve** — click a highlight or gutter dot to open a popover (distinct colors for human vs agent authors) with the comment body and a **Resolve** action. Resolving deletes the comment; git history is the audit trail.
4. **Drawer** — open the comments drawer to see every comment with jump-to. Comments orphaned by edits move to a **needs-attention** bucket with re-anchor and delete actions, and an amber attention chip appears in the top bar.
5. **Export** — run **Penmark: Export Review as Prompt** to copy the open comments (or write them to a file) as a structured, agent-ready prompt.

## Exporting

Penmark exports the rendered document — not the raw markdown — so what you share looks exactly like the preview. Click **Export** in the preview topbar (or run the export commands from the editor menus / Command Palette) to open the export dialog, pick your options, and confirm. Exports are always light-themed — shared documents read on white regardless of your IDE theme.

- **Export as HTML** writes a single self-contained `.html` file: the preview stylesheets and your typography preset are inlined; local images are embedded as `data:` URIs; Mermaid diagrams are included as fully rendered SVG. The file contains no JavaScript and opens identically in any browser.
- **Export as PDF** prints that same document with a Chromium-based browser already on your machine (Chrome, Edge, Chromium, or Brave — auto-detected, or set `penmark.export.chromiumPath`). Code blocks, tables, and diagrams are kept whole across page breaks. If no browser is found, Penmark offers the HTML export instead — open it in any browser and print to PDF from there.

The dialog options (defaults configurable, see [configuration](configuration.md)):

| Option | What it does |
| --- | --- |
| Frontmatter card | Include the document-metadata card (off by default — the export is the clean document). |
| Table of contents | Prepend a generated, linked TOC built from h1–h3 headings. |
| Width | Content column width: comfortable (~860px), wide (~1200px), or full. |
| Page size (PDF) | A4 or Letter. |
| Margins (PDF) | Narrow / normal / wide (12 / 18 / 25 mm). |
| Header and page numbers (PDF) | Running header with the document title, footer with "page / total". |

Exports capture the preview, so the preview opens if it is not already open. Review comments are **not** included — the export is the clean document; use **Export Review as Prompt** for the comments.

## How comments are stored

Comments live **inside the same `.md` file**: invisible HTML-comment anchors (`pmk:` markers) in the text, plus one hidden review block at the end of the document. The file stays clean markdown that GitHub and other tools render without noise, and the comments survive Prettier, markdownlint, and 3-way git merges. Adding and resolving a comment are single, undoable edits.

The format is specified in [`spec/penmark-format.md`](../spec/penmark-format.md), and the contract for agents acting on a reviewed document is [`AGENTS-GUIDE.md`](../AGENTS-GUIDE.md).

## Commands

| Command | ID | Description |
| --- | --- | --- |
| Penmark: Open Preview to the Side | `penmark.openPreview` | Open the rendered preview beside the editor. |
| Penmark: Export Review as Prompt | `penmark.exportReview` | Export the open comments as an agent-ready prompt. |
| Penmark: Export as HTML | `penmark.exportHtml` | Open the export dialog for a self-contained HTML file. |
| Penmark: Export as PDF | `penmark.exportPdf` | Open the export dialog for a PDF printed via a local Chromium-based browser. |
