# penmark-comments

Reviews a local Markdown file when you ask for a review. After reviewing, it asks once whether the findings should also be written into the file as Penmark comments or stay in chat. The `penmark` command writes them. The skill does not hand-write comment markers.

A new passage gets a highlight. A passage that already has a comment gets a reply on that comment, not a second highlight. The document's wording stays as it was written. The skill never commits unless you ask separately.

## When it applies

The skill activates for an explicit request to review, audit, critique, or comment on a writable local `.md` file. It does not apply to summaries, explanations, extraction tasks, pasted text without a writable target, or non-Markdown artifacts. Pull-request reviews and general code reviews do not activate this skill, even when their diff contains Markdown.

These requests write comments without asking, because they say so:

- `Review design.md and add Penmark comments.`

These return findings in chat without asking, because they refuse the comments themselves:

- `Review design.md, but don't add any comments.`
- `Critique notes.md and return findings in chat only.`

These reach the consent gate, because they refuse changes to the work rather than to the review:

- `Audit proposal.md read-only.`
- `Review design.md, but do not modify files.`

Answering "Yes, and stop asking" saves `{ "mode": "write" }` to `~/.config/penmark-comments/config.json`. A `penmark-comments: write` line in `CLAUDE.md` or `AGENTS.md` takes precedence over that file.

When a request uses several files, comments belong only in the primary reviewed document.

## Install

Copy this directory into the harness skill directory. Copy the directory, not `SKILL.md` alone.

The command is not part of this directory. Use `penmark` when it is on `PATH`. Otherwise, in a Penmark checkout, run `npm run build` and then `node dist-cli/cli.js`. An install from a git URL is not verified. Do not use one.

## See also

- [AGENTS-GUIDE.md](../../AGENTS-GUIDE.md) — rules for editing a file that already has comments
- [Skill instructions](SKILL.md)
