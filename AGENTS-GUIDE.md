# Penmark — agent guide

You are an AI agent editing a Markdown document that contains **Penmark review comments**. A human (or another agent) has left feedback inside the document itself, stored as invisible HTML comments. Your job is to act on that feedback without corrupting the comment data.

This guide is the **agent contract**. Follow these six rules. They are normative; the full grammar is in [`spec/penmark-format.md`](spec/penmark-format.md). Worked before/after examples follow each rule. IDs in examples are valid lowercase base32 (`a-z2-7`).

## How the format looks

Feedback locations are marked in the body by invisible anchors. Comment bodies live in a `pmk:review` block at the very end of the file. Both are HTML comments, so they do not render.

```
This is the <!--pmk:s k7m2q5ax-->commented phrase<!--/pmk:s k7m2q5ax--> in the prose.

<!-- pmk:review v1 -->
<!--pmk:c k7m2q5ax
carlos (human) · 2026-06-12 09:02 +10:00
> commented phrase

Please expand this section.
-->
<!-- /pmk:review -->
```

The anchor ID (`k7m2q5ax`) joins the body marker to its entry. The `> ` line is an advisory snapshot of what was commented — you may edit the marked text freely and it stays attached.

## The six rules

### Rule 1 — Read the whole file first

Read the entire document. Entries live in the `pmk:review` block at the end; anchors (`pmk:s`, `pmk:b`, `pmk:r`) mark the locations they refer to. Map each entry to its anchor by matching IDs before you change anything.

**Before (you skim only the top of the file):** you edit the prose, never scroll to the `pmk:review` block, and miss that the comment you just "addressed" actually asked for the opposite change.

**After (you read the whole file):** you read the entry for `k7m2q5ax` ("Please expand this section"), find the matching `<!--pmk:s k7m2q5ax-->...<!--/pmk:s k7m2q5ax-->` in the body, and act on the real request.

### Rule 2 — Edit prose first, then delete the marker pair and its entry together

Address feedback by editing the document prose. **Text between span markers may be edited freely; keep the markers intact while you work.** Once the feedback is addressed, delete the marker pair and its matching entry **in a single edit** (one undo step, per spec §7.1).

**Before:**

```
The <!--pmk:s k7m2q5ax-->high level<!--/pmk:s k7m2q5ax--> design.
```
```
<!--pmk:c k7m2q5ax
carlos (human) · 2026-06-12 09:02 +10:00
> high level

Add the low-level details too.
-->
```

**After** (you added the detail, then removed both the marker pair and the entry):

```
The high-level and low-level design, including the token verification path.
```

The `pmk:review` block no longer contains the `k7m2q5ax` entry. If it was the last entry, the whole `pmk:review` block is removed.

While you are still working (detail not yet written), keep the markers on:

```
The <!--pmk:s k7m2q5ax-->high level and low level<!--/pmk:s k7m2q5ax--> design.
```

Editing the text inside the pair does not detach the comment.

### Rule 3 — Never re-ID, duplicate, or split anchors; never delete one half of a pair; never edit another author's entry body

Do not change an anchor's ID, do not duplicate it, do not split one anchor into two. **Never delete just the opener or just the closer of a pair** — a lone half is corruption. Do not rewrite the body prose of an entry written by someone else.

**Before:**

```
The <!--pmk:s w3n6d5pz-->fifty thousand requests per second<!--/pmk:s w3n6d5pz--> peak.
```

**Wrong (deleted the closer only — leaves a stray opener):**

```
The <!--pmk:s w3n6d5pz-->fifty thousand requests per second peak.
```

**Right (keep both markers; edit only the text between them):**

```
The <!--pmk:s w3n6d5pz-->sixty thousand requests per second<!--/pmk:s w3n6d5pz--> peak.
```

If you are resolving the comment, remove **both** markers and the entry together (Rule 2) — never one marker alone.

### Rule 4 — If the anchored text is gone, leave the anchor and entry in place and report

If the content a comment refers to no longer exists, do not guess where it went and do not invent a replacement. Leave the anchor and its entry in place and report that you could not locate the target.

**Before** (the section the comment targets has already been deleted by an earlier edit, but the entry remains):

```
<!--pmk:c a5s4d6fg
carlos (human) · 2026-06-12 09:22 +10:00
> ![preview concept](../assets/concept.png)

Replace with the final light/dark pair.
-->
```

**After (correct):** the image is nowhere in the document. You leave the entry untouched, leave any surviving marker in place, and report: "Comment `a5s4d6fg` targets an image that is no longer in the document — left in place for human review."

If you deleted the anchored content yourself on purpose, you may leave the span as an **empty pair** to preserve the location — on its own line or inline within surviving prose (spec §8.3):

```
<!--pmk:s a5s4d6fg--><!--/pmk:s a5s4d6fg-->
```

This is the "content removed" state — the markers stay paired, the comment resurfaces for a human, and nothing is silently lost.

### Rule 5 — Replies are v2; append a new entry, never edit the parent

Threaded replies are a v2 feature. In v1 you do not write them. When v2 lands, a reply is a **new** entry of the form `pmk:c <new-id> re <parent-id>`; you append it and you **never edit the parent entry**.

**Before:**

```
<!--pmk:c k7m2q5ax
carlos (human) · 2026-06-12 09:02 +10:00
> high level

Add the low-level details too.
-->
```

**Wrong (you rewrote the parent to bolt on your response):**

```
<!--pmk:c k7m2q5ax
carlos (human) · 2026-06-12 09:02 +10:00
> high level

Add the low-level details too. [agent: done in section 3]
-->
```

**Right (v2 — append a separate reply entry, leave the parent verbatim):**

```
<!--pmk:c k7m2q5ax
carlos (human) · 2026-06-12 09:02 +10:00
> high level

Add the low-level details too.
-->
<!--pmk:c d6t4y6km re k7m2q5ax
claude-code (agent) · 2026-06-12 10:00 +10:00
> high level

Done — added the token verification path in section 3.
-->
```

In v1, instead of replying you resolve the comment by editing the prose and deleting the entry (Rule 2).

### Rule 6 — Escape `--` as `&#45;&#45;` inside entries; keep the review block last

Any `--` you write **inside an entry** (quote or body) MUST be written `&#45;&#45;`, because `--` cannot appear inside an HTML comment. Keep the `pmk:review` block as the **last** content in the file; never insert content after the closing `<!-- /pmk:review -->`.

**Before (you write a flag name with a literal double hyphen — this breaks the entry):**

```
<!--pmk:c m6n3b2vc
carlos (human) · 2026-06-12 09:40 +10:00
> the production flag

Name it literally: it is --production.
-->
```

**After (escaped — the entry stays valid):**

```
<!--pmk:c m6n3b2vc
carlos (human) · 2026-06-12 09:40 +10:00
> the production flag

Name it literally: it is &#45;&#45;production.
-->
```

When read back, `&#45;&#45;production` decodes to `--production`. And if you appended any new section to the document, make sure the `pmk:review` block still sits at the very end of the file.

## Summary

| Rule | One-liner |
|---|---|
| 1 | Read the whole file; match entries to anchors by ID. |
| 2 | Edit prose freely between markers; delete the pair + entry together when done. |
| 3 | Never re-ID, duplicate, split, or half-delete an anchor; never edit another author's entry. |
| 4 | If the target is gone, leave anchor + entry and report — don't guess. |
| 5 | Replies are v2 (`re <parent-id>`); append, never edit the parent. |
| 6 | Escape `--` as `&#45;&#45;` in entries; keep `pmk:review` last. |

Full normative grammar: [`spec/penmark-format.md`](spec/penmark-format.md).
