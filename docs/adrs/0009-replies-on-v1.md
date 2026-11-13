---
title: "Replies stay on the v1 review header"
type: adr
status: approved
scope: [comments, format, cli]
date: 2026-11-13
authors:
  - "Carlos Boeing"
---

# 0009 — Replies stay on the v1 review header

## Context

A second note on a sentence that already has a comment needs a thread, not a second highlight. The v1 review header is `<!-- pmk:review v1 -->`. Spec §2 tells a parser that does not recognize a version to leave that block unparsed. A new header would hide every comment, including the roots, from an extension that only knows v1.

The v1 parser already records an optional ` re <parent-id>` suffix on an entry's id line and then ignores it.

## Decision

The header stays `<!-- pmk:review v1 -->`. A root line stays `pmk:c <ID>` and keeps exactly one body anchor. A reply line is `pmk:c <ID> re <parent-id>`, has no body anchor, and names a root entry in the same review block. One level only: the parent is never itself a reply.

Resolving a root deletes its anchor, its entry, and every reply that names it. Resolving a reply deletes only that entry. Resolve remains delete ([ADR 0002](0002-single-file-comment-storage.md)). Anchor placement and the degradation ladder are unchanged ([ADR 0006](0006-span-anchor-wrapping-with-degradation-ladder.md)).

Agents do not hand-write these lines. A local `penmark` command places a new comment or appends a reply. The human is asked before that command runs.

## Consequences

- An extension that predates this decision still opens the file. It shows the reply as needing attention and still highlights the root.
- An updated extension nests the reply under the root and adds no second highlight.
- Documents written before this decision contain no reply lines and parse as they do today.
