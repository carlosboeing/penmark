# Penmark — project instructions for AI agents

Operator-facing brief for AI coding assistants working on this repo; `README.md` is visitor-facing. `AGENTS.md` and `GEMINI.md` symlink to this file for assistants that expect those filenames.

## What this project is

**Penmark** — a markdown preview extension for VS Code, Cursor and Antigravity whose differentiator is **inline review comments** — Google-Docs-style commenting on rendered markdown, designed for the agentic-SDLC workflow where AI produces design docs/plans/research as .md files and a human reviews them in the IDE. Name decided 2026-06-11 (ADR 0004). Key decisions live in `docs/adrs/0001`–`0006` (architecture, single-file comment storage with resolve=delete, name, renderer, span-anchor wrapping pairs — 0006 supersedes 0003).

## Project Map

- **Tracker**: GitHub Issues (this repo)
- **Board**: none
- **Roadmap**: docs/ROADMAP.md
- **Changelog**: docs/CHANGELOG.md
- **Architecture**: docs/architecture.md (current state); README.md `## Architecture` is the short version
- **Working memory**: a separate private working-memory repo (numbered-lifecycle convention) — brainstorms, discovery, plans, reviews, notes, spike
- **Other**:
  - Compatibility floor: `engines.vscode ^1.105.0` (Cursor 1.105 base; Antigravity 1.107; verified 2026-06-11). Stable APIs only — no proposed APIs.
  - Distribution: **local-first** — VSIX sideloaded into VS Code/Cursor/Antigravity. The repository is public (source-visibility only, ADR 0004 amendment); marketplace publishing stays a deferred decision (dual publishing to MS Marketplace + Open VSX per the plan's deferred publish track if it ever happens).
  - Discovery/design working memory (multi-model second-opinion reviews, research, and the requirements brain-dump) is kept in a separate private repo, not in this public repo.

## `docs/` — public documentation

```
docs/
├── README.md               — docs index
├── installation.md         — sideload the VSIX (VS Code / Cursor / Antigravity)
├── usage.md                — preview, comment, resolve, drawer, export-as-prompt
├── configuration.md        — the penmark.* settings
├── troubleshooting.md      — common install / rendering issues
├── architecture.md         — current-state architecture (distilled)
├── ROADMAP.md              — what's in flight / next / shipped
├── CHANGELOG.md            — what shipped, when
├── adrs/                   — single-decision records (NNNN-title.md)
├── assets/                 — concept mockups, demo GIF
└── guides/                 — maintainer release-smoke checklists
```

The build-process working memory (brainstorms, discovery, phased plans, cross-model reviews, scratch notes, the anchor torture-test spike) is kept in a separate private working-memory repo under the same numbered-lifecycle convention. It is not public.

## Conventions

- **Single source of truth.** ROADMAP is "what's next"; ADRs are decisions; docs/architecture.md is current state.
- **Self-describing filenames.** Lifecycle artifacts: `YYYY-MM-DD-<topic>-<suffix>.md`. ADRs: `NNNN-<short-title>.md`.
- **Always-current vs frozen-in-time.** Lifecycle docs freeze with `status:`; evergreen docs get updated in place.
- **Status flow:** `draft` → `approved` → `shipped` → optionally `superseded`.
- **Change discipline.** A shipping commit updates architecture/CHANGELOG/ROADMAP/frontmatter together.

## Commits

Conventional Commits: `<type>(<scope>): <description>`, imperative, subject ≤72 chars, body explains *why*. Reference ADRs (and, where useful, the maintainer's private design/plan docs) in the body when relevant.

## Working principles for agent sessions

- **Design gate:** no extension implementation until the maintainer has approved a design (the v1 design is approved and shipped; design docs are kept in the maintainer's private working-memory repo).
- **Performance is a requirement, not a nice-to-have:** slim bundle (esbuild), lazy activation, no full re-renders. Treat `shd101wyy.markdown-preview-enhanced` as the cautionary tale.
- **Stay inside the compatibility floor** (`^1.105.0`, stable APIs only).
- Verify before answering; no speculative features; don't suppress errors; no emojis in files.

## Where to look first

- Visitor-facing: [`README.md`](README.md)
- User docs: [`docs/`](docs/) — installation, usage, configuration, troubleshooting, architecture
- What's next: [`docs/ROADMAP.md`](docs/ROADMAP.md)
- What shipped: [`docs/CHANGELOG.md`](docs/CHANGELOG.md)
- Decisions: [`docs/adrs/`](docs/adrs/)

## Project notes

- Extension and product names must pass a brand-safety test: comfortable to say aloud in meetings without embarrassment; reject homophones or awkward connotations (e.g. "Crit" was rejected).
- To watch browser tests run locally, use headed Playwright mode (`--headed`, `--debug`, or `--ui`); `--slow-mo` is not a valid Playwright Test CLI flag — use `launchOptions.slowMo` in `playwright.config.ts` or `--debug` for step-through.
- Dev dependencies are exact-pinned with `npm i -E`; deliberate version bumps update both `package.json` and `package-lock.json`.
