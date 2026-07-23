# Changelog

What shipped in this project, when. Most recent first. Each entry references the docs that drove the change.

## 2026-07-23 (feat/adaptive-review-ui)

### Adaptive review surface — responsive panels, native Find, live code wrapping, reading metadata

Settings and Comments become one adaptive, persistent-root surface instead of two independent overlays:

- **Responsive panels** — Settings and Comments share the incremental preview root (no re-render on open/close). At 1050px or wider the Comments panel reserves 342px of layout space beside the document (Settings always overlays); below 1050px both panels overlay; below 700px the open panel takes `calc(100vw - 24px)`. Only one panel is open at a time.
- **Surface lifecycle coordinator** — a small stack in `keyboard.ts` (`registerPenmarkSurface`/`closeTopmostPenmarkSurface`) ensures `Esc` always closes only the topmost Penmark-owned surface and restores focus to its opener, even after the topbar is rebuilt. Native VS Code dialogs and Find keep their own authoritative cancellation.
- **Narrowed settings panel** — the in-preview panel keeps the six settings most relevant while reading (theme, preset, text size, content width, code wrapping, comment-highlight intensity); an **Open all Penmark settings** link opens the full Settings UI (`vscode://settings/penmark`, ignoring any webview-supplied URI data) for line height and other options.
- **Live code wrapping** — `penmark.codeBlockWrap` (default on) toggles wrapping of long fenced-code lines from the settings panel or full settings.
- **Native Find** — `enableFindWidget: true` on both preview entry paths; `Ctrl/Cmd+F` opens the IDE's Find widget scoped to the preview.
- **Reading metadata** — a compact word-count/reading-time line beside the document title.
- **Reduced motion** — `prefers-reduced-motion: reduce` zeroes Penmark-owned panel/control/highlight transition durations and switches comment-jump scrolling from smooth to instant; native Find and dialog motion are unaffected.
- **Tests** — unit coverage for the settings/protocol narrowing, panel geometry, and motion-preference gating; three representative Playwright visual-regression states (wide settings, mid-width comments under reduced motion, narrow comments) replacing an exhaustive state matrix; two Mermaid goldens re-recorded for the approved responsive-width change.

## 2026-07-07 (in flight — feat/export-html-pdf)

### Export to HTML and PDF

Two new commands export the rendered document with preview-exact fidelity ([ADR 0007](adrs/0007-export-via-preview-capture.md)):

- **Export dialog** — the preview topbar gains an **Export** button (the editor/palette commands route to the same dialog): format, frontmatter card (off by default), generated linked table of contents (h1–h3), content width, PDF page size, margin presets (12/18/25 mm), and a header/page-numbers toggle. Defaults configurable via `penmark.export.*` settings.
- **Penmark: Export as HTML** (`penmark.exportHtml`) — a single self-contained, JavaScript-free `.html` file: preview stylesheets and typography variables inlined, syntax-highlighted code, mermaid diagrams as fully rendered SVG (below-the-fold diagrams force-rendered at capture), local images embedded as `data:` URIs, plus a defense-in-depth CSP. Review-comment highlights and preview chrome are stripped — the export is the clean document. Exports are **always light-themed**; a dark preview's diagrams are re-rendered light for the snapshot and restored after.
- **Penmark: Export as PDF** (`penmark.exportPdf`) — prints the same document via a system-installed Chromium-based browser (Chrome/Edge/Chromium/Brave auto-discovery, `penmark.export.chromiumPath` override; nothing is bundled), driven over the DevTools pipe for a real title header and "page / total" footer, exact margins, and exact color reproduction; page-break rules keep code blocks, tables, rows, images, and diagrams whole. Falls back to plain `--print-to-pdf` on CDP failure and to the HTML export when no browser is found.
- **Mechanism** — the export captures the preview webview's sanitized DOM (new `exportCapture`/`exportCaptured`/`exportRequest`/`exportShowOptions` protocol messages) rather than re-rendering host-side, so the output equals the preview by construction; a new `renderMermaidAll` bypasses the lazy IntersectionObserver during capture.
- **Tests** — unit suites for the document builder, capture cleaning (incl. TOC generation and light-theme restore), the export dialog, image inlining, and both PDF printers (CDP framing + CLI); Playwright preview-vs-export fidelity comparisons (computed styles, geometry, and mermaid SVG identical), dark-preview→light-export with restore, dialog round-trips, and real print smokes through both production paths; extension-host journey tests (defaults + options); and a manual cross-IDE checklist ([guides/export-smoke-checklist.md](guides/export-smoke-checklist.md)).
- **Hardening** — canceling a palette/menu-triggered export dialog suppresses same-request retry reopens, and HTML destination write failures now surface through the same Penmark error/log path as PDF export failures.
- **CI coverage reporting** — PR coverage now renders as a compact Markdown table, is also written to the GitHub job summary, and updates the existing coverage bot comment by marker instead of editing the bot's last comment blindly.

## 2026-06-18 (Codex UI/UX polish — merged as PR #12)

### Codex UI/UX polish — preview settings and premium review chrome

Independent UI/UX pass for comparison against the parallel `feat/v1-polish` work:

- **Preview settings panel** — top-bar panel for theme, typography preset, text size, content width, comment-highlight intensity, and line height, backed by a narrow validated `updateSetting` webview protocol.
- **Review UI polish** — emoji-free comment controls, drawer status chips, refined attention states, and focused visual-regression coverage for the settings panel, comments, and lightboxes.
- **Metadata and lightbox polish** — frontmatter status/tag chips and image-lightbox Zoom out, Zoom in, Fit, and Close controls matching the Mermaid lightbox vocabulary.
- **Semantic UI tokens** — Penmark-owned chrome now uses HSL-based `--pmk-ui-*` tokens while markdown content stays on the GitHub-compatible reading palette.
- **Undo-safe comment edits** — comment add/resolve/edit now use the visible source editor's edit stack with explicit undo stops and no forced save, keeping review mutations as normal editor changes.
- **Verification coverage** — added unit and Playwright coverage for settings persistence, webview interactions, HSL semantic tokens, frontmatter, comments, settings, and image lightbox states.

## 2026-06-17 (in flight — feat/v1-polish)

### v1.0 Polish — typography, lightbox, checkboxes, frontmatter, keyboard, reconcile, selection

Phase 3 polish features per the v1 design §6 and §11:

- **Typography settings** — `penmark.preset`, `textSize`, `fontFamily`, `headingFontFamily`, `lineHeight`; CSS custom properties on the preview root; live `setTypography` config updates.
- **Image lightbox** — click any preview image for a full-screen zoomable modal (wheel zoom).
- **Interactive task checkboxes** — toggle `- [ ]` / `- [x]` in source from the rendered preview (`toggleTaskCheckbox` via `WorkspaceEdit`).
- **Frontmatter metadata card** — collapsible header card for common YAML keys above the preview content.
- **Keyboard navigation** — `d` drawer toggle, `j`/`k` drawer items, `n`/`p` comment highlights, `?` shortcut help.
- **Two-block reconcile (§8.5)** — entries from non-EOF `pmk:review` blocks surface in needs-attention; merge golden promoted from `it.fails`.
- **Exact selection mapping** — per-text-node `data-pmk-soff` stamps for precise source offsets on marked-up prose.

## 2026-06-16

### Table cell inline comments, right-sided drawer layout, and jump-to-comment scroll fixes

Span comments (open/close tags) are now supported on individual words or text selections inside table cells, falling back to block comments only if the selection spans cell delimiters (`|`) or row boundaries (`\n`).

- **Table cell coordinate mapping alignment** — Added custom table layout parsing inside `cleanMarkdown` to strip table syntax (`|` delimiters, separator rows, spaces, newlines) and track character indices precisely, ensuring the host aligns cell-specific selections to the correct source location rather than jumping to a matching quote in a different cell.
- **Right-sided drawer placement and layout shrinking** — Moved the Comments drawer to the right side (`right: 0`, `border-left`, `transform: translateX(100%)`) and added a responsive CSS transition on wider screens (`min-width: 600px`) that pushes (`padding-right: 320px`) and shrinks the preview document to prevent the drawer from overlaying and hiding highlighted comments.
- **Jump to comment action** — Renamed "Jump to source" to "Jump to comment". Clicking the action now scrolls the webview preview directly to the highlighted comment span (`scrollIntoView` centered smoothly) instead of shifting focus and jumping the active VS Code editor selection.
- **Unit and browser tests updated** — Verifies table cell span comments, boundary/row crossing block fallbacks, cell coordinate mapping alignment, and the "Jump to comment" preview scrolling behavior.

## 2026-06-15

### Documentation split by audience

`docs/` is now curated user/contributor documentation. The AI-assisted build process (brainstorms, discovery, phased plans, cross-model reviews, notes, and the anchor torture-test spike) moved to a private companion repo so it stays version-controlled but off the public repo.

- **New user docs** — [installation](installation.md), [usage](usage.md), [configuration](configuration.md), [troubleshooting](troubleshooting.md), and [architecture](architecture.md) (distilled from the README and the v1 design), plus a [docs index](README.md).
- **Stayed public** — ADRs, ROADMAP, this changelog, the format spec ([`spec/penmark-format.md`](../spec/penmark-format.md)), the agent guide ([`AGENTS-GUIDE.md`](../AGENTS-GUIDE.md)), the release-smoke checklists, and the concept mockups (now under `assets/`).
- Cross-references in this changelog, the roadmap, the format spec, and `CLAUDE.md` were de-linked so the public docs stand alone — none point into the now-private content.

## 2026-06-14 (later)

### Open-sourced: repository made public

The GitHub repository is now public ([ADR 0004 amendment](adrs/0004-name-penmark-and-dual-publishing.md)) — a source-visibility change only; distribution stays local-first and marketplace publishing remains deferred. Public repos get unlimited free Actions minutes, which unblocks CI/Release (they were failing under the private-repo spending limit, not on code). Hardened for public life in the same pass:

- **Security gates** — secret scanning + push protection, Dependabot alerts + security updates + weekly version updates ([`.github/dependabot.yml`](../.github/dependabot.yml)), CodeQL default setup (JS/TS), and GitHub private vulnerability reporting (policy in [`SECURITY.md`](../SECURITY.md)).
- **Community health** — [`CODE_OF_CONDUCT.md`](../CODE_OF_CONDUCT.md) (Contributor Covenant 2.1), an expanded [`CONTRIBUTING.md`](../CONTRIBUTING.md), bug/feature issue forms, a PR template, and `CODEOWNERS`; Discussions enabled.
- **Branch protection** on `main` — require a PR plus the core CI status checks (lint/typecheck/unit, browser goldens, package + size gate, Linux extension tests), up-to-date branches, linear history, no force-push or deletion.
- **README** rewritten to open-source standard — badges, value prop, install/sideload, a demo-GIF slot, and links to ROADMAP/CHANGELOG/CONTRIBUTING/SECURITY/LICENSE.
- Documented (not fixed) that external fork PRs run with a read-only token, so the CI coverage-comment step is skipped for them.
- Pre-flight gitleaks scan over full history: clean.

## v0.5.0 — 2026-06-14

### Review MVP shipped (inline comments, local-first VSIX)

The full v0.5 Review MVP from the v0.5 plan (design §3–§9), built autonomously as per-task PRs R1–R17 merging on local-green (CI billing-blocked, plan D16). Penmark now supports Google-Docs-style **inline review comments** on rendered markdown — the product's differentiator — stored in the document itself as invisible HTML-comment anchors plus a single trailing `pmk:review` block, per the frozen public format spec ([`spec/penmark-format.md`](../spec/penmark-format.md)) and the agent contract ([`AGENTS-GUIDE.md`](../AGENTS-GUIDE.md)). Core VSIX 581 KiB (mermaid excluded), under the 1 MiB budget.

- **Comment format core** (`src/core/comments`, TDD'd fresh from the spec — the P0.1 spike is reference-only) — parser with corruption classification (§9), serializer + edit builder with the writer invariants (§7), anchor placement with AST-safety snapping (span/block/range, §4.1), and the reconcile degradation ladder (§8: `intact` → `degraded-recovered` via advisory quote → `content-removed` for empty pairs → `orphan`). ≥95% coverage on `src/core/comments`.
- **Select-to-comment in the preview** — drag-select rendered prose, snap to a contiguous source range with a live highlight preview, and add a comment from an inline box. Selection endpoints map to source offsets over the per-block offset map.
- **Comment highlights, gutter dots, and a resolve popover** — commented spans get a subtle theme-aware highlight (intensity setting `penmark.comments.highlightIntensity`: subtle/medium/strong) and a gutter dot; clicking opens a popover (blue for human, purple for agent authors) with the comment body and a **Resolve** action. Matches the approved v1 concept mockup in both light and dark.
- **Comments drawer with a needs-attention bucket** — a slide-in drawer lists all comments with jump-to, plus a dedicated **needs-attention** section for orphaned / content-removed / degraded comments surfaced by reconcile, with re-anchor and delete affordances. An amber **attention chip** in the top bar appears when reconcile flags any comment.
- **Add / resolve as a single `WorkspaceEdit`** (one undo step, §7.1) with author identity (human vs agent provenance), mutations serialized to avoid interleaving. Reconcile runs on open/change; corruption is logged, never silently swallowed (design §9).
- **Export review as an agent-ready prompt** — copy the open review (or write it to a file) as a structured prompt for handoff to a coding agent (design §4.3).
- **Blocking acceptance gate (release-gating, design §11)** — a golden suite over the §8 degradation/desync states plus real `git merge-file` concurrent-branch merge scenarios, proving the single-file append-only format survives 3-way merges (both lossless resolutions covered). Wired into `test:unit`.

### Known limitation

- **Two-review-block merge resolution (§8.5, tracked):** if a 3-way merge is resolved by keeping *both* `pmk:review` blocks (rather than unioning them), reconcile surfaces the non-EOF block's entries only via the corruption flag, not yet in the needs-attention list. No data is lost (entries remain verbatim in the file) and the corruption is flagged (§9). The common union resolution is fully lossless. Fix is a post-v0.5 follow-up touching the parser + reconcile. See [ROADMAP](ROADMAP.md) open questions.

## v0.1.1 — 2026-06-13

### Fixed

- **Mermaid diagrams under nonce CSP** — mermaid computes correct geometry but emits its styling as `<style>` tags and inline `style=` attributes inside the SVG; under `style-src 'nonce-…'` the browser blocks both on `innerHTML` re-parse, so diagrams rendered as black-filled boxes (blocked `<style>` fills), were uniformly upscaled (blocked svg `max-width` let `width:100%` stretch to the panel), showed top-aligned/overflowing labels and overlapping subgraph titles (blocked label layout), rendered off-centre SVG text labels such as sequence-diagram participant names (mermaid sets their `text-anchor: middle` via an inline style), and ignored author `style`/`classDef` colours (blocked inline fills). The webview now injects the shell nonce into every mermaid `<style>` and **re-applies mermaid's intended inline styles via the CSSOM** — which the nonce CSP does not police — scoped to the SVG subtree, through a property allowlist that rejects external `url()` values. This restores mermaid's native layout (matching GitHub / VS Code's built-in preview) and author colours while keeping the strict nonce CSP intact (no `'unsafe-inline'`). The allowlist also covers SVG `text-anchor`, so mermaid's centered SVG-text labels (e.g. sequence-diagram participant names) survive instead of falling back to left/`start` alignment. A document-level rule pins mermaid's label font — for both HTML `foreignObject` labels and SVG `text` — and zeroes label `<p>` margins so mermaid's off-screen measurement pass (where its `<style>` is blocked by the same CSP) measures text at the size it later displays; otherwise labels are mis-sized: subgraph titles wrap and overlap their nodes, and a long terminal sequence-diagram participant label overflows its box and is clipped. See [ADR 0005 amendment](adrs/0005-markdown-it-render-pipeline.md) and [`src/webview/mermaid/styleRehydration.ts`](../src/webview/mermaid/styleRehydration.ts). The Playwright harness applies a production-equivalent CSP so this class of bug is caught in CI.

### Improved

- **Dark-mode contrast & polish** — body and headings use pure white (`--pmk-color-fg: #fff`) in dark for maximum contrast (h6 stays muted per GitHub convention); blockquote text is lightened (`--pmk-color-blockquote-fg: #e0e0e0`). Inline code renders as a crisp chip with an explicit `--pmk-color-code-fg` (white in dark) plus a subtle border (`--pmk-color-code-border`); blockquotes/notes get a callout tint (`--pmk-color-blockquote-bg`) with rounded corner and accent border. For mermaid in **dark** mode: *all* label/caption text (node, edge, actor, message, cluster, note) is forced to white for contrast — author-specified colours still win (re-hydrated inline styles outrank the rule), and mermaid's dark theme renders note/cluster/band backgrounds dark so white text stays legible. And because the reader picks the preview theme — not the diagram author — author-hardcoded *light* structural backgrounds (subgraph cluster fills, sequence-diagram `rect` highlight bands) are softened (lowered fill-opacity, hue retained) so their text becomes legible; semantic node colours (`style N fill:#…`) and arrows/edges are left untouched. Light mode is unchanged. The **Expand lightbox** gets the same treatment as the inline diagram (its clone is re-adapted and the dialog carries an `id` so the white-text rules win over mermaid's id-scoped `<style>`), so the modal matches the doc. See [`media/penmark.css`](../media/penmark.css) and `adaptMermaidDarkBackgrounds` in [`src/webview/mermaid/styleRehydration.ts`](../src/webview/mermaid/styleRehydration.ts).

## v0.1.0 — 2026-06-13

### Reading MVP shipped (local-first VSIX)

The full v0.1 Reading MVP from the Phase 0 + v0.1 plan (design §5–§9). Distributed local-first: the GitHub Release VSIX is sideloaded into VS Code / Cursor / Antigravity (ADR 0004 amendment). Comment authoring is v0.5 — this release is preview-only.

- **Custom webview preview** (`penmark.openPreview`) — nonce CSP, single panel per column, no `retainContextWhenHidden`; debounced incremental re-render via morphdom (no full re-renders). Lazy activation (`onCommand`/`onWebviewPanel` only).
- **GFM rendering** host-side via markdown-it (tables, task lists, footnotes, strikethrough, autolinks, GitHub-compatible heading anchors) with per-block `data-pmk-offset` source positions (ADR 0005); relative images rewritten to webview URIs.
- **GitHub light/dark/auto themes** independent of the IDE theme (`light`/`dark` override; `auto` follows the IDE and re-renders live). Tokenized CSS from `github-markdown-css`. Top-bar with doc name + theme switcher; `penmark.theme`/`scrollSync`/`mermaid.enabled` settings.
- **Syntax highlighting** — lazy-loaded highlight.js common subset (loaded only when a language-tagged fence exists).
- **Code-block copy buttons** with host clipboard round-trip and a transient "Copied" state.
- **Mermaid diagrams** — lazy chunk, `IntersectionObserver` rendering, `securityLevel: strict`, per-diagram failure containment, theme-following, pan/zoom lightbox; SVG node identity preserved across unrelated edits.
- **Bidirectional scroll sync** (editor↔preview) over the offset map with two-sided echo suppression; gated by `penmark.scrollSync`.
- **Security**: DOMPurify sanitization (webview-side, D6) + nonce CSP; XSS corpus + formatter-conformance gates in CI.
- **Quality gates (CI)**: 4-layer test harness (unit/jsdom/Playwright-in-container/extension matrix `{1.105.0,stable}×{ubuntu,macos,windows}`); ≥85% core / ≥80% webview coverage; **< 1 MiB core VSIX** (mermaid excluded); formatter golden matrix proving `pmk:` anchors survive Prettier/markdownlint; **design-§8 performance budgets** (activation < 50 ms, first render < 300 ms, 10k-line doc interactive).

## 2026-06-13

### Phase 0 under way: anchor grammar validated (GO); repo scaffolded

- **P0.1 anchor torture-test spike** executed and merged: ADR 0006 grammar survived Prettier ×2 + markdownlint `--fix` (75/75 anchors intact) and 16 real headless agent sessions (**0.0% orphan rate** on typical edits; controls behaved as designed). Verdict **GO** with two spec amendments for P0.6 (explicit base32 ID alphabet; empty span-pair "content removed" semantics). Report kept in the project's working notes; the torture-test corpus graduated into the conformance corpus at [`spec/conformance/`](../spec/conformance/).
- **P0.2 repo scaffold** merged — first extension code: TypeScript strict, esbuild dual entry (host cjs + webview esm), ESLint flat config enforcing the ADR 0001 core boundary (violation-proven), Prettier, `.vscodeignore`, CONTRIBUTING stub with the reference-repo licensing note; `vsce package` produces a 6 KB VSIX. All deps exact-pinned.

## 2026-06-12

### Phase 0 + v0.1 implementation plan approved

- The Phase 0 + v0.1 implementation plan approved by Carlos: Phase 0 foundation (anchor torture-test spike gating the spec freeze-draft, scaffold, 4-layer harness with coverage gates, CI with VSIX size budget) + v0.1 Reading MVP through a local release.
- Distribution ruled **local-first**: VSIX sideload into VS Code/Cursor/Antigravity; registry registration and marketplace publishing parked in a deferred publish track ([ADR 0004 amendment](adrs/0004-name-penmark-and-dual-publishing.md)); going public is an open decision.
- Plan-level decisions settled: markdown-it plugin set pinned exact, version/tag scheme with GitHub-Release VSIX artifacts, `data-pmk-offset` line-range semantics, morphdom for incremental DOM updates, measured DOMPurify placement with pre-approved webview fallback.

### v1 design review complete; design approved

- Three review rounds on the v1 design: round 1 — 11 inline comments addressed; round 2 — span anchors reworked to wrapping marker pairs with degradation ladder, quote demoted to advisory snapshot ([ADR 0006](adrs/0006-span-anchor-wrapping-with-degradation-ladder.md) supersedes 0003); round 3 — review-block entries switched to markdown-style chat shape (format-options brainstorm).
- Carlos approved the design: the v1 design is `status: approved`. Decisions of record: ADRs 0001–0006.
- Next: Phase 0 + v0.1 implementation plan.

## 2026-06-11 (later)

### Decisions closed; v1 design drafted; project named Penmark

- Multi-model review cycle complete (five independent AI models).
- Carlos's rulings recorded: single-file comment storage with resolve=delete; human-readable `&#45;&#45;` escaping; point/block/range anchor model (no span-wrapping); robustness-first sequencing; name **Penmark** (Crit rejected on brand-safety).
- Decisions captured as [ADRs 0001–0005](adrs/); availability verified (MS Marketplace + Open VSX clear); repo renamed `carlosboeing/markdown-preview` → `carlosboeing/penmark`.
- v1 design drafted for review — architecture, comment format spec v1 draft (`pmk:` grammar + agent contract), theming/settings, 4-layer test strategy, performance budgets, phase mapping.
- Brainstorms superseded into the design: naming + product-vision docs flipped to `status: superseded`.

## 2026-06-11

### Discovery phase complete; repo bootstrapped

- Repo scaffolded with a standard CLAUDE.md, README.md, MIT LICENSE, and docs/ lifecycle structure.
- Requirements brain dump preserved verbatim in the project's working notes.
- Audited the three reference repos (markdown-review, markdown-docs, vscode-markdown-pdf) with AI assistance — including the measured diagnosis of markdown-docs's 16 MB unminified webview bundle.
- Landscape + technical research (competitors, Cursor/Antigravity compatibility floor `^1.105.0`, architecture options, anchoring/storage models, testing strategy).
- Multi-AI discovery deep probe — 1 of 6 agents completed (provider routing issues documented); synthesis + raw artifacts kept in the project's working notes.
- Product vision + feature brainstorm with key design decisions D1–D5.
- Extension naming shortlist.
