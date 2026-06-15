---
type: adr
status: approved
scope: [comment-format, storage]
date: 2026-06-11
---

# 0002 — Single-file comment storage; resolve = delete

## Context

The product's core loop: a reviewer comments on an AI-authored .md, commits and pushes; later a human or AI agent pulls the doc, addresses the feedback, and clears it. Carlos ruled (2026-06-11) that the document must remain **standalone** — comments persist inside the .md itself, no sidecar file — while staying invisible in rendered output and keeping the raw markdown readable and valid everywhere (GitHub included).

## Decision

1. **Anchors** are HTML comments placed at/around the commented content (grammar in ADR 0003).
2. **Comment bodies** live as hidden HTML comments **appended at the bottom of the same document**, one HTML comment per entry, append-only, inside a delimited review block.
3. **Resolve = delete.** Resolving removes the anchor(s) and the bottom entry entirely, atomically. No resolved-state accumulation; git history is the audit trail.
4. The extension reconciles on open: orphaned anchors/entries are surfaced (orphan bucket), never silently dropped; the EOF block is relocated to EOF if content was appended after it.

## Options considered

- Hybrid in-file anchors + committed sidecar (recommended by all five reviewing models for diff hygiene): overruled by the owner — standalone single file is a hard product requirement.
- Fully visible inline syntax (CriticMarkup, `:comment[]` directives): rejected — pollutes rendered/raw output (markdown-docs cautionary tale).
- Workspace storage: rejected — invisible to git and agents.

## Consequences

Accepted consciously: every comment action dirties the document file and appears in its diffs; concurrent branch reviews can conflict in the EOF block (mitigated by one-entry-per-comment append-only layout and stable IDs). In exchange: a single self-contained artifact that any human, agent, or future web app can read with zero discovery logic, and trivially correct handoff semantics (one file = one commit = whole review).
