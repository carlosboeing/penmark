---
type: adr
status: superseded
superseded_by: 0006-span-anchor-wrapping-with-degradation-ladder.md
scope: [comment-format, anchoring]
date: 2026-06-11
---

# 0003 — Anchor model: point/block/range (no span-wrapping); human-readable escaping

> **Superseded by [ADR 0006](0006-span-anchor-wrapping-with-degradation-ladder.md) (2026-06-12):** inline spans now use a wrapping marker pair with a degradation ladder; point+quote is the fallback, the quote is an advisory snapshot. Block/range anchors, IDs, namespacing and `&#45;&#45;` escaping carry forward unchanged.

## Context

Within single-file storage (ADR 0002), the anchor grammar must survive agent rewrites, external editors, and formatters, and must never break markdown rendering. Span-wrapping anchors (`<!--x-->text<!--/x-->`) were independently flagged by four of five reviewing models as hazardous: tag-splitting during rewrites, and illegal/unstable inside links, emphasis, inline code, and table cells. Separately, `--` cannot legally appear inside an HTML comment, but comment bodies will contain arbitrary prose.

## Decision

1. **Three anchor types, all HTML comments, no closing tag wrapped around visible text:**
   - **Point** — single comment immediately before the selected text, allowed only where the markdown AST proves it safe (plain text runs).
   - **Block** — own line before a block (tables, images, fences, diagrams, whole paragraphs).
   - **Range** — block-aligned pair: own line before the first block and after the last block of a contiguous selection.
2. Mid-block-to-mid-block ranges are out of scope for v1. Cross-block selections snap to the contiguous block range, with the snapped highlight shown before the user types.
3. The **exact quoted text is stored redundantly** in the comment entry. Recovery ladder: anchor ID → quote match → orphan bucket. Orphans keep their quote so context survives.
4. **Encoding: human-readable with minimal escaping** — `--` in quotes/bodies is written as `&#45;&#45;` and decoded on read. No base64.
5. IDs are 8-character random base32 (collision-resistant across concurrent branches). Anchor and entry prefixes are namespaced (`pmk:`) and the review block carries a spec version from day one.

## Options considered

- Span-wrapping as default (original sketch): rejected per reviewer consensus (multiple independent AI models).
- base64url-encoded bodies (proposed by one model): rejected by owner — a core premise is that agents and humans reading the raw file see the feedback in context; base64 destroys that to solve a problem one escape rule already solves.

## Consequences

Highlights for point anchors derive from quote-matching forward of the anchor (repeat-quote ambiguity resolved by nearest-anchor, warned in UI). Anchors are formatter-sensitive; mitigations (ignore directives, golden tests against Prettier/markdownlint `--fix`) are v0.1 acceptance criteria per Carlos's ruling.
