# Penmark — project instructions for AI agents

Operator-facing brief for AI coding assistants working on this repo; `README.md` is visitor-facing. `AGENTS.md` symlinks to this file for assistants that expect that filename.

## What this project is

**Penmark** — a markdown preview extension for VS Code, Cursor and Antigravity whose differentiator is **inline review comments** — Google-Docs-style commenting on rendered markdown, designed for the agentic-SDLC workflow where AI produces design docs/plans/research as .md files and a human reviews them in the IDE. Name decided 2026-06-11 (ADR 0004). Key decisions live in `docs/adrs/0001`–`0006` (architecture, single-file comment storage with resolve\=delete, name, renderer, span-anchor wrapping pairs — 0006 supersedes 0003).

## Project Map

- **Tracker**: GitHub Issues (this repo)
- **Board**: none
- **Roadmap**: docs/ROADMAP.md
- **Changelog**: docs/CHANGELOG.md
- **Architecture**: docs/architecture.md (current state); README.md `## Architecture` is the short version
- **Working memory**: `.workbench/` — a **separate private repository** (`carlosboeing/penmark-workbench`), nested here as an independent clone and gitignored above. It holds the private build-process lifecycle: brainstorms, design specs, plans, reviews.
  - **Never cross-commit.** Plain `git …` targets **whichever repository the shell is currently inside** — this public one at the root, the private one from anywhere under `.workbench/`. From the root, `git -C .workbench …` names the private one explicitly. Nothing in git's output says which repo it resolved, so when you are not certain where the shell is, name the target with `-C`.
  - **`scripts/githooks/pre-commit` enforces the boundary** — it refuses a commit that stages the workbench as a gitlink, or that adds workbench vocabulary to a public file. Enable it once per clone, because git will not: `git config core.hooksPath scripts/githooks`. Override a false positive with `git commit --no-verify`.
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

Conventional Commits: `<type>(<scope>): <description>`, imperative, subject ≤72 chars, body explains _why_. Reference ADRs in the body when relevant. Never reference a private design or plan document in any public artifact -- see the section below.

## What a public artifact may say

Commit messages, pull request and issue titles and bodies, review comments and release notes are public and permanent. A reader arrives with the repository and nothing else.

**Never name a private or local source in one.** Not `.workbench`, not `penmark-workbench`, not the bare phrase "the workbench", not "the maintainer's private design docs" or any equivalent pointer, not a path to a document held there, not `/Users/...`, not a client name or an internal cost figure.

The damage is a citation the reader cannot follow. "See the design doc" says something exists and withholds it, which is worse than saying nothing. **Restate the fact instead:** put the reasoning in the body in its own words, or in an ADR under `docs/adrs/` that the artifact then links.

**No hook catches this.** `scripts/githooks/pre-commit` reads the staged diff, so it never sees a message or a body, and `gh pr create --body` reaches the GitHub API without touching git.

A pull request body follows `.github/PULL_REQUEST_TEMPLATE.md`, which `gh pr create --body` bypasses. An issue title is one clause under 60 characters naming the change or the symptom. A body reading "implements the design" has said nothing -- say what the design was.

## Working principles for agent sessions

- **Branch and workspace isolation.** Verify the active branch and workspace state at the start of a session. Brainstorm, design and plan work happens in the main checkout — no branch, no worktree. At implementation, branch off `origin/main` and ask whether to use a worktree before the first branch command. More than one entry in `git worktree list` means another session is live, so a worktree is required rather than offered. Worktrees go at `.worktrees/<harness>/<branch>`, branch slashes preserved. `.workbench/` is a separate repository with its own worktrees; check it with `git -C .workbench worktree list`.
- **Working Memory Location override:** Any generic agent skills (like `brainstorming` or `writing-plans`) that instruct you to save specs or plans under `docs/` MUST be overridden. Locate the directory designated for private working memory (declared in the Project Map above, or found as a local directory such as `.workbench/` or `.working-memory/`), inspect its internal `README.md` or configuration for its folder layout conventions, and save all SDLC brainstorms, specs, and plans there. Never write SDLC brainstorms, specs, or plans to the public `docs/` directory.
- **Design gate:** no extension implementation until the maintainer has approved a design (the v1 design is approved and shipped; design docs are kept in the maintainer's private working-memory repo).
- **Performance is a requirement, not a nice-to-have:** slim bundle (esbuild), lazy activation, no full re-renders. Treat `shd101wyy.markdown-preview-enhanced` as the cautionary tale.
- **Stay inside the compatibility floor** (`^1.105.0`, stable APIs only).
- **Offer the local install — every time work becomes testable.** Penmark is sideloaded, not installed from a marketplace, so nothing the maintainer runs changes until a VSIX is packaged and installed into each IDE. Doing that by hand, across three IDEs, is the annoying part. So whenever a change is ready to try in a real IDE — a bug fixed, a feature finished, a branch about to be reviewed — **ask whether to run `npm run install:local`**, which packages and installs into every IDE found on the machine (VS Code, VS Code Insiders, Cursor, Windsurf, Antigravity) and reads the version back to confirm. **Always ask — never install silently.** The point of asking is not politeness: the maintainer has to KNOW the extension changed underneath them, or they will test a build believing it is a different one and draw the wrong conclusion from what they see. A sideload that nobody announced is worse than no sideload. So ask first, and after a successful install state plainly which version is now installed in which IDEs, and that each IDE window needs reloading — the extension host does not pick up the swap on its own. Do not wait to be reminded, and do not hand over a copy-paste command instead of offering to run it.
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
