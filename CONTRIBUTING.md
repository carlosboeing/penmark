# Contributing to Penmark

Penmark is a local-first markdown preview extension with inline review comments,
for VS Code, Cursor, and Antigravity. Contributions are welcome. This guide
covers setup, the constraints that keep the extension fast and portable, and the
pull-request flow.

For project context and decisions, see [`README.md`](README.md),
[`docs/ROADMAP.md`](docs/ROADMAP.md), and the decision records in
[`docs/adrs/`](docs/adrs/). `CLAUDE.md` is the operator-facing brief for AI agent
sessions.

## Dev setup

Requires Node 24 (pinned in `.nvmrc`).

```bash
nvm use            # node 24
npm ci             # install exact-pinned dependencies
npm run build      # dual esbuild: dist/extension.js (host) + dist/webview/
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
```

Run the extension from VS Code with the **Run Extension** launch config (F5),
which opens an Extension Development Host. Open a markdown file and run
**Penmark: Open Preview to the Side**.

## Tests

Penmark has a four-layer test harness; run the layer matching what you changed,
or the full suite before opening a PR.

```bash
npm run test:unit     # vitest + coverage (core + webview logic, jsdom)
npm run test:browser  # Playwright visual goldens (render/theme/comments)
npm run test:ext      # @vscode/test-electron (activation + host integration)
npm test              # build + all of the above
```

Coverage gates are enforced in CI (>= 95% on `src/core/comments`, >= 85% core /
>= 80% webview overall). Visual goldens are pixel-compared against the pinned
Playwright container image; regenerate intentionally with `UPDATE_GOLDENS=1`.

## Constraints that matter

- **Compatibility floor.** Target `engines.vscode ^1.105.0` and **stable APIs
  only** - no proposed APIs. This is the shared base across VS Code, Cursor
  (1.105), and Antigravity (1.107).
- **Performance is a requirement.** Slim esbuild bundle, lazy activation
  (`onCommand` / `onWebviewPanel` only), no full re-renders (morphdom does
  incremental DOM updates). The core VSIX stays under 1 MiB (mermaid excluded);
  a CI size gate enforces it.
- **Architecture boundaries** (ADR 0001):
  - `src/core/` is platform-agnostic: zero `vscode` imports, enforced by ESLint
    (`no-restricted-imports`) and Node-only tests, so a future web app can reuse
    the engine.
  - `src/webview/` talks to the host exclusively via the versioned message
    protocol - also no `vscode` imports.
- **Decisions of record** live in [`docs/adrs/`](docs/adrs/); don't re-litigate
  them in PRs. Propose a new ADR if you want to change one.

## Licensing note

**No code is ported from reference repositories.** The discovery phase audited
several markdown extensions (markdown-review, markdown-docs, vscode-markdown-pdf)
for architecture lessons; their code must not be copied or adapted into this
codebase. Lessons yes, lines no.

## Pull-request flow

1. Branch from `main`.
2. Make a focused change; keep unrelated refactors out.
3. Use [Conventional Commits](https://www.conventionalcommits.org/):
   `type(scope): description`, imperative mood, subject <= 72 chars; the body
   explains *why*. Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`,
   `chore`, `perf`, `ci`.
4. If the change affects user-facing behavior, update `docs/ROADMAP.md`,
   `docs/CHANGELOG.md`, and any relevant ADR in the **same commit set**.
5. Open a PR using the template. CI must be green before merge: lint, typecheck,
   unit tests, browser goldens, the package + size gate, and the Linux extension
   tests are required checks; the full OS x VS Code-version matrix also runs.
6. External fork PRs run with a read-only token, so the coverage-comment step is
   skipped for them - this is expected and does not indicate a failure.
