---
name: penmark-comments
description: Use when the user asks to review, audit, critique, or comment on a writable local Markdown file, including read-only, no-write, or chat-only reviews, or explicitly asks for Penmark inline comments. Do not use for pull-request reviews, or for broad change reviews whose diff contains non-Markdown files.
---

# Penmark Comments

## Core contract

Activate this skill for every explicit review, audit, critique, or comment request targeting a writable local Markdown file. A no-write instruction never suppresses activation.

Review the document first, then decide where the findings go. Adding comments changes the file, so that decision belongs to the user unless they have already made it. Summaries, explanations, and extraction tasks do not activate this skill unless the user explicitly requests Penmark.

## Scope

Resolve what is being reviewed before anything else, in this order:

1. **A named pull request or GitHub review** — never activate, whatever the changed files are. The deliverable is a review on the PR, not comments in local files.
2. **A document the user identified** — by filename ("review `design.md`") or by reference ("review my design", "review the plan", "review the design doc", "audit the spec"). Activate when the resolved target is Markdown, **regardless of what else is uncommitted**.

   When the reference names no file, resolve it before reviewing: check pending changes and recently modified working-memory documents for a matching design, plan, brainstorm, or review. Exactly one plausible candidate — use it and say which one you picked. Two or more — ask which before reviewing. None — say so instead of guessing. This disambiguation question is separate from the consent gate below, and only fires when the reference is genuinely ambiguous.

3. **Broad scope you must discover yourself** — "review my changes", "review the uncommitted work", "review the pending changes". Inspect the changed set. Activate only when every changed file is Markdown. One non-Markdown source file makes it a code review, which this skill leaves alone.

Content decides only in case 3, where the user did not say what to review. Never let discovered scope override a document the user identified — unrelated uncommitted code has no bearing on a review they asked for by name or by reference.

## Workflow

1. Read the entire target and any source or comparison documents. Form the findings. Write nothing yet.
2. Resolve the output surface using the first rule that matches:
   1. The request explicitly asks for inline or Penmark comments — use the file.
   2. The request explicitly refuses them — use chat. Only these count: "don't add comments", "no inline comments", "don't comment on the doc", "no penmark", "don't use penmark-comments", "findings in chat only", "chat-only".
   3. A `penmark-comments: <mode>` line in `CLAUDE.md` or `AGENTS.md` — obey it.
   4. A `mode` value in the config file — obey it.
   5. Otherwise — print the full findings, then run the gate below and obey the answer.
3. Chat surface: print the full findings and leave every file unchanged. Stop.
4. File surface: run the writer steps, then print the summary.

Anything absent from the 2.2 list is ambiguous and reaches the gate. "read-only", "don't modify `<file>`", "leave it unchanged", "don't edit anything", "no changes", and "don't implement" all gate — they refuse changes to the work, not to the review.

## Configuration

Precedence: instruction-file line, then config file, then ask.

- Instruction-file line in `CLAUDE.md` or `AGENTS.md`: `penmark-comments: write`. Also accepts `chat` and `ask`.
- Config file at `$XDG_CONFIG_HOME/penmark-comments/config.json`, defaulting to `~/.config/penmark-comments/config.json`:

```json
{ "mode": "write" }
```

Write the config file only for the "Yes, and stop asking" answer, creating the directory when missing. Never write `chat` from the gate — a standing refusal is the user's own instruction-file line. Never write config into the skill directory: that is shipped, Git-tracked content.

## Gate

Print the full findings first, then ask using the harness question tool: `AskUserQuestion` on Claude Code, `ask_question` on Agy, `request_user_input` on Codex, `ask_user_question` on Grok, native input on Cursor.

Every one of these needs an interactive session. When the tool is unavailable for any reason — a headless run such as `claude -p` or `codex exec`, a subagent, or a harness that has none — use the text form below **verbatim**.

> These findings can also go into `<target>` as Penmark comments. A new passage gets a highlight. A passage that already has a comment gets a reply on that comment, not a second highlight.
>
> The document's wording stays as you wrote it. The command adds the comment. It does not rewrite the passage.
>
> Add them?

| Label | Description |
|---|---|
| Yes, add them | Writes N findings into `<target>`. Undo with `git checkout -- <target>`. |
| Yes, and stop asking | Same, and saves the preference to `~/.config/penmark-comments/config.json`. Edit or delete that file to change it back. |
| No, chat only | Leaves `<target>` byte-for-byte unchanged. The findings above are the complete review. |

Substitute the real target path and count. When the target is untracked or dirty, replace the undo sentence with: "The comments are additions — remove a highlight by resolving it in the preview, or delete the marker pair, its review entry, and any replies on that entry together."

### Gate — text form

```
Add these N findings to `<target>` as Penmark comments?

A new passage gets a highlight. A passage that already has a comment
gets a reply on that comment, not a second highlight. The document's
wording stays as you wrote it.

  1. Yes — add them to `<target>`. Undo: `git checkout -- <target>`
  2. Yes, and stop asking — same, and remembers the choice for next time.
  3. No — leave `<target>` unchanged. The findings above are the full review.

Reply 1, 2, or 3.
```

Substitute the real count and path. Never write "the design" or "the doc" where a path belongs — with no interface chrome, that path is the only thing showing what is about to be touched.

This form is already a numbered list of the single question, placed at the end of the reply, so it satisfies a reply-format convention that asks for questions that way. It needs no further compression to comply with one. Keep each option on its own line with its consequence.

## Writer steps

The `penmark` command writes the comments. Do not type marker lines, do not mint an id, and do not edit an existing review entry. The format rules for a file that already has comments are in [AGENTS-GUIDE.md](../../AGENTS-GUIDE.md) in the Penmark repository. This skill does not restate them.

1. Add findings only to the primary reviewed document. Source and comparison documents stay unchanged.
2. Build one JSON object. Each finding has `quote` (the passage text) and `body` (the note). Do not include an id. `start` and `end` are optional and must travel together. They are JavaScript string indexes into the file after it is decoded as text.

```json
{ "findings": [ { "quote": "eventual consistency", "body": "Name the staleness bound." } ] }
```

3. Run one command for that file. Pass `--provenance agent` and `--author` set to the current harness or model name. There is no `--yes` flag. Invoking the command is the write.

```bash
penmark comment apply --file <target> --provenance agent --author "<harness>"
```

The JSON goes on stdin. If `penmark` is not on `PATH`, run this from a Penmark checkout after `npm run build` in that checkout:

```bash
node dist-cli/cli.js comment apply --file <target> --provenance agent --author "<harness>"
```

Do not install the command with `npx` from a git URL. That install path is not verified. If neither command is available, print the findings in chat and stop. Do not write markers by hand as a fallback.

4. Read the JSON result and the exit code. The command writes the file only when every finding is accepted and the bytes have not changed since it read them.

| Exit | Meaning |
|---|---|
| 0 | Wrote the file, or every finding was `skipped` (same note already present). `wrote` is true only after the file is replaced. |
| 1 | Bad invocation, bad JSON, or no git author and no `--author`. A finding with only one of `start` or `end` is bad JSON. An author that contains a line break or `--` is rejected too. Nothing written. |
| 2 | A finding was rejected. Nothing written. |
| 3 | The file changed after the read. Nothing written. Re-read before any further attempt. Do not loop. |
| 4 | The review block is unreadable, or the file has a second review block. Leave the file untouched and report the `corruption` string. |

5. On exit 2, repair the batch and run the same command once more. Do not edit the file yourself.

| `reason` | What to change |
|---|---|
| `ambiguous-quote` | The result lists `matches`, each with `start`, `end`, and `excerpt`. Put the `start` and `end` of the passage you meant on that finding. Send `start` and `end` together. |
| `no-match` | The quote is not in the document body. Quote the passage as it is written. |
| `uncommentable` | That range cannot hold a comment (frontmatter, a link definition, or a blank gap). Quote a prose passage or a whole block instead. |
| `duplicate-roots` | More than one comment already covers that passage. The result lists those `ids`. Do not add another. Say so in the summary. |
| `empty-body` | The note is empty. Drop that finding or write the note. |
| `bad-range` | Both `start` and `end` are present, and they are out of order, not whole numbers, or outside the file. A finding with only one of them is exit 1. |
| `reply-to-reply` | The command only replies to a root comment. Leave the thread as it is. |

`penmark comment locate --file <target> --quote "<quote>"` returns `{ "matches", "truncated" }`. Each match has `start`, `end`, and `excerpt`. At most 20 matches are returned, and `truncated` is true when more exist. An `ambiguous-quote` result lists `matches` the same way and has no `truncated` field. If `penmark` is not on `PATH`, use `node dist-cli/cli.js comment locate` with the same flags from a Penmark checkout after `npm run build`. An empty `--quote` is exit 1.

6. Report the result. `placed` is a new highlight. `replied` is a note on an existing comment. `skipped` means that note was already there. Quote the passage, not a restatement of the finding.
7. Do not run Git commands or commit unless separately requested.

## Where the quote sits

Quote the passage that would have to change for the finding to be resolved. When a finding says a section's scope is too narrow, the quote is inside that section. Topical relatedness is not a quote — a section that merely governs the same outcome is the wrong target. When the finding's body names a specific section, requirement, or identifier, the quote sits inside that one unless the finding is explicitly about a mismatch between two of them.

| Finding is about | Quote |
|---|---|
| A specific claim, requirement, or passage | That passage |
| Something a section should cover but does not, or the section's overall approach | That section's heading |
| The document's framing, structure, or scope as a whole | The document title |

Each row is a fallback only when the row above genuinely does not apply. The command chooses a span, a block, or a range from the quote. You do not.

## Summary

Print after every write, including when no gate was shown:

> Added N comments to `<target>` (`placed` X, `replied` Y, `skipped` Z).
>
> - one terse line per finding, each citing the passage as a short quote plus `<target>:<line>`
>
> The document's wording was preserved. A new passage is highlighted. A repeated passage is a reply on the existing comment.
> Undo: `git checkout -- <target>`

Quote the passage, not a restatement of the finding. The quote is what lets the reader catch a wrong anchor without opening the document.

Group findings by theme instead of listing every one when a review is large. When `wrote` is false, say that the file was not changed and why.

## Common mistakes

- Skipping this skill because the review is read-only, no-write, or chat-only is an error. Activate, review, and let step 2 pick the surface.
- Treating "read-only" or "don't edit anything" as a refusal of comments is an error. Those gate.
- Asking when the user already requested comments, or already stored a preference, is noise.
- Activating for a named pull request or GitHub review is an error, even when every changed file is Markdown. That review belongs on the PR.
- Refusing an identified Markdown target because unrelated code is also uncommitted is an error. An identified target decides on its own.
- Guessing which document "review my design" means when several are plausible. Ask which one, then review.
- Compressing the gate's three options into a sentence to satisfy a reply-format rule. The text form above already complies; squashing it further strips the consequences the user needs to choose.
- Writing the config file for any answer other than "Yes, and stop asking".
- Claiming the file is byte-for-byte unchanged on a write path. A new highlight inserts markers. The guarantee is about wording.
- Using the document title as a home for findings that were merely hard to place. Widening the quote is for findings with no passage, not for findings you did not locate.
- Quoting a section that is merely related to the finding instead of the section it critiques.
- Commenting in a source or reference document when one primary target is being reviewed.
- Hand-writing `<!--pmk:…-->` lines, minting an id, editing an existing entry, or emitting a second review block. The command does that work.
- Passing `--yes`, or reading `penmark-comments: write` inside the command. The skill asks. The command writes when it is invoked.
- Retrying after exit 3 without re-reading the file.
