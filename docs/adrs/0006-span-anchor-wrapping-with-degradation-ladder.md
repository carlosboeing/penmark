---
type: adr
status: approved
scope: [comment-format, anchoring]
date: 2026-06-12
supersedes: 0003-anchor-model-and-encoding.md
---

# 0006 — Span anchors: wrapping pair with degradation ladder; quote demoted to advisory snapshot

## Context

ADR 0003 made point-anchor + quote-derived extent the default for inline spans, treating any quote mismatch as an orphan. Carlos rejected this on frequency grounds (2026-06-12): editing the commented text is the *common* event during doc revision — a one-character typo fix inside the commented words would orphan the comment — while marker destruction (the failure the reviewing models optimized against) is the *rare* event. Requirement: **orphaned comments must be an exception, rarely seen**, not a routine consequence of editing.

## Decision

1. **Inline spans use a wrapping pair** of invisible HTML comments:
   `<!--pmk:s a1b2-->selected text<!--/pmk:s a1b2-->`
   The markers define the highlight extent. Text between them can be edited freely — typo fixes and rewording keep the comment attached and the highlight adjusts; no quote matching in the happy path.
2. **The stored quote is an advisory snapshot, not a tripwire.** It remains in the review-block entry (agents see what was originally commented). When current text differs from the snapshot, the UI shows a subtle "edited since commented" indicator with the original on hover — never an orphan. Tooling refreshes the snapshot; users never maintain it.
3. **Degradation ladder:** both markers present → exact span. Closing marker destroyed → the opener degrades to a point anchor with quote-match fallback (ADR 0003's model becomes the fallback, not the default). Opening marker destroyed → reconcile strips the stray closer and the entry goes to the orphan bucket. Orphans therefore require actually destroying markers.
4. **AST-safety snap rules stay:** selections snap so markers never split inline-code spans or emphasis/link delimiters, never cross block boundaries, never land inside fences/frontmatter (block anchor instead).
5. Unchanged from ADR 0003: block anchors (`pmk:b`), block-aligned range pairs (`pmk:r … o/c`), 8-char base32 IDs, `pmk:` namespacing, spec versioning, and human-readable `&#45;&#45;` escaping.

## Options considered

- Point + quote as default (ADR 0003): superseded — orphans on the common event; four-of-five reviewer consensus underweighted in-span edit frequency. Retained as the ladder's fallback, so its safety properties are kept.
- Auto-healing quote heuristics (fuzzy re-match + boundary guessing after edits): rejected — guesses span boundaries silently; markers make the boundary explicit.

## Consequences

Two inline tokens instead of one (more raw-source noise, roughly double formatter exposure) — accepted; the Phase 0 **anchor torture-test spike** (golden corpus + real agent-rewrite sessions + Prettier/markdownlint passes) validates both grammars on measured orphan/survival/corruption rates before the v0.5 spec freeze, with "orphan rate under typical edits" as the headline metric. Evidence also favors in-text markers: markdown-review and markdown-docs both demonstrate daily that markers moving with text survive editing best; their failure was visible syntax and inline bodies, which Penmark avoids.
