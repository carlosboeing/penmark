# Penmark

[![CI](https://github.com/carlosboeing/penmark/actions/workflows/ci.yml/badge.svg)](https://github.com/carlosboeing/penmark/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/carlosboeing/penmark?sort=semver)](https://github.com/carlosboeing/penmark/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![VS Code engine](https://img.shields.io/badge/VS%20Code-%5E1.105.0-1f6feb.svg)](https://code.visualstudio.com/)

**A GitHub-style markdown preview with inline review comments** for VS Code, Cursor, and Antigravity. Read AI-authored design docs, plans, and research in a clean preview, comment on the exact passage the way you would in Google Docs, and hand the review back to a coding agent as a prompt.

<!-- DEMO GIF: record the select-to-comment -> resolve -> export-as-prompt flow, save it to docs/assets/penmark-demo.gif, and uncomment the line below.
![Penmark: select rendered prose, add a comment, resolve it, and export the review as an agent prompt](docs/assets/penmark-demo.gif)
-->
> **Demo:** a short screen capture of the select-to-comment -> resolve -> export-as-prompt flow goes here. Penmark is a visual tool; a GIF conveys it faster than prose. (Asset pending; see the comment in the source for where it drops in.)

## Why Penmark

The agentic SDLC produces a lot of markdown: an agent writes a design doc, a plan, or a research note, and a human has to review it in the IDE. A plain preview lets you read it; Penmark lets you **review** it. Select a sentence in the rendered output, leave a comment anchored to that exact span, then commit the document - the comments travel **inside the same `.md` file** as invisible HTML-comment anchors plus one trailing review block, so the file stays clean markdown that GitHub and every other tool render without noise. When you are done, export the open comments as a structured prompt and let an agent address them. Resolving a comment deletes it; git history is the audit trail.

It is built to stay out of your way: a slim bundle, lazy activation, incremental rendering (no full re-renders), and a strict nonce CSP.

## Features

**Reading**

- GitHub-flavored markdown rendering (tables, task lists, footnotes, strikethrough, autolinks, GitHub-compatible heading anchors).
- Light / dark / auto themes, independent of the IDE theme.
- Syntax highlighting (highlight.js, lazy-loaded) and one-click code-block copy.
- Mermaid diagrams, lazy-rendered, with a pan/zoom lightbox.
- Bidirectional scroll sync between the editor and the preview.

**Reviewing**

- Select rendered prose and add a comment anchored to the source span, with a live highlight preview.
- Commented spans get a theme-aware highlight (subtle / medium / strong) and a gutter dot; click to open a resolve popover (distinct colors for human vs agent authors).
- A comments drawer lists every comment with jump-to, plus a needs-attention bucket for comments orphaned by edits, with re-anchor and delete actions.
- Add and resolve are single, undoable edits; comments are stored in the document per the public format spec, so they survive Prettier, markdownlint, and 3-way git merges.
- Export the review as an agent-ready prompt (to clipboard or a file) for handoff to a coding agent.

**Exporting**

- Export the rendered document as a **self-contained HTML file** — typography preset, highlighted code, rendered Mermaid SVGs, and images all inlined, zero JavaScript, always light for sharing.
- Export as **PDF** via a Chromium-based browser already on your machine (nothing bundled), with real page numbers, page size and margin options, and page-break handling.
- An export dialog in the preview topbar: frontmatter card, generated table of contents, width, and PDF page options.

## Install

Penmark is local-first: it is distributed as a VSIX you sideload, not published to a marketplace.

1. Download the latest `penmark-markdown-review-<version>.vsix` from the [Releases page](https://github.com/carlosboeing/penmark/releases).
2. Install it:
   - **VS Code:** `code --install-extension penmark-markdown-review-<version>.vsix` (or Extensions view -> `...` menu -> **Install from VSIX**).
   - **Cursor:** `cursor --install-extension penmark-markdown-review-<version>.vsix` (or the same Extensions-view menu).
   - **Antigravity:** Extensions view -> **Install from VSIX**.
3. Reload the window if prompted.

Requires an IDE on the `^1.105.0` engine floor (VS Code 1.105+, Cursor 1.105+, Antigravity 1.107+).

## Usage

1. Open any markdown file.
2. Run **Penmark: Open Preview to the Side** (editor title bar, context menu, or command palette).
3. Select text in the preview to add a comment; click a highlight or gutter dot to resolve one; open the drawer to see them all.
4. Run **Penmark: Export Review as Prompt** to hand the open comments to an agent.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `penmark.theme` | `auto` | Preview theme: `light`, `dark`, or follow the IDE. |
| `penmark.scrollSync` | `true` | Sync preview scroll with the editor cursor. |
| `penmark.mermaid.enabled` | `true` | Render Mermaid diagrams. |
| `penmark.contentWidth` | `full` | How wide the content column may grow (`comfortable` / `wide` / `full`). |
| `penmark.comments.highlightIntensity` | `medium` | Tint strength for commented spans (`subtle` / `medium` / `strong`). |

## Architecture

A custom WebviewPanel preview (ADR 0001) renders markdown parsed host-side by markdown-it with per-block source offsets (ADR 0005), shipped to the webview over a versioned message protocol and applied incrementally with morphdom; the host stays slim and lazily loads the markdown-it render stack, highlight.js, and mermaid only when needed (activation under 50 ms, core VSIX under 1 MiB). Sanitization is DOMPurify in the webview behind a nonce CSP. Comments are stored single-file - invisible `pmk:` HTML-comment anchors in the text plus a hidden review block at the end of the same document (ADR 0002), using span-wrapping marker pairs with a degradation ladder plus block/range anchors (ADR 0006); resolving a comment deletes it, with git history as the audit trail. The marker grammar is frozen in [`spec/penmark-format.md`](spec/penmark-format.md) and CI proves it survives Prettier/markdownlint. A platform-agnostic core (`src/core`, zero `vscode` imports) keeps a future self-hosted web app able to reuse the same engine and format.

Decisions of record live in [`docs/adrs/`](docs/adrs/).

## Documentation

Full guides live in [`docs/`](docs/): [Installation](docs/installation.md), [Usage](docs/usage.md), [Configuration](docs/configuration.md), [Troubleshooting](docs/troubleshooting.md), and [Architecture](docs/architecture.md).

## Project status

**v0.5.0 Review MVP shipped** (2026-06-14) - inline review comments on rendered markdown, the product's differentiator, on top of the v0.1 reading experience.

- What's in flight and queued: [`docs/ROADMAP.md`](docs/ROADMAP.md)
- What shipped, when: [`docs/CHANGELOG.md`](docs/CHANGELOG.md)

## Contributing

Contributions are welcome - see [`CONTRIBUTING.md`](CONTRIBUTING.md) for dev setup, the test layers, the compatibility floor, and the PR flow. By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Security

Found a vulnerability? Please report it privately - see [`SECURITY.md`](SECURITY.md). Do not open a public issue for security reports.

## License

[MIT](LICENSE) (c) 2026 Carlos Boeing.
