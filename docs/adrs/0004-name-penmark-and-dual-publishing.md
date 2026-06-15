---
type: adr
status: approved
scope: [naming, publishing]
date: 2026-06-11
revised: 2026-06-12 (amendment — publishing deferred, local-first)
---

# 0004 — Name: Penmark; dual-registry publishing

## Context

Naming criteria: brand-safety (the say-it-in-a-meeting test — "Crit" was rejected for failing it), discoverability in IDE extension search across VS Code (MS Marketplace), Cursor (MS-marketplace mirror), and Antigravity (Open VSX), and distinctiveness. Reviewer consensus: the winnable search queries are "markdown review/comments", not "markdown preview" (owned by 10M-install incumbents); brand word carries identity, the display-name tail and keywords carry search.

## Decision

1. **Name: Penmark** (Carlos, 2026-06-11). Display name pattern: **"Penmark — Markdown Review Comments & Preview"**. Extension ID: `penmark-markdown-review` (review-biased, not preview-biased).
2. Availability verified 2026-06-11: MS Marketplace gallery API — 0 results for "penmark"; Open VSX — 0 results. npm package `penmark` is taken (abandoned 2022 alpha) → future core library publishes as `penmark-core` or scoped under Carlos's npm account.
3. **Publisher + namespace registration on BOTH registries is a Phase 0 task** (namespaces are first-come-first-served; the 2025–26 fork/Open-VSX squatting wave makes this non-theoretical). Same publisher name on both.
4. Keyword payload lives in description and `keywords` (markdown, review, comments, annotations, preview, mermaid, AI, agent, design doc, …), not stuffed into the display name.

## Options considered

Crit (rejected — brand-safety), Quillmark (one model's pick), Markwise (proposed by two models), Marginnote, Margins, Sidenote, Noted, "Markdown Ultimate Preview" (working title; generic, no differentiator signal). Penmark was one model's pick and on the original shortlist: distinctive, safe, coherent story (the reviewer's pen on markdown).

## Consequences

Repo renamed to `carlosboeing/penmark` (GitHub redirects the old URL). Comment-format namespace prefix is `pmk:` (ADR 0003). Marketplace listing copy leads with the differentiator: review comments for AI-authored markdown.

## Amendment — 2026-06-12: publishing deferred (local-first)

Owner decision (Carlos): Penmark is being built **local-first** — packaged as a VSIX and sideloaded into VS Code/Cursor/Antigravity for personal use; whether it ever goes public is undecided. Decision 3 (Phase 0 publisher/namespace registration) and the dual-registry publishing strategy are **suspended** until/unless a publish decision is made; they become the first steps of the implementation plan's deferred publish track. Accepted consequence: the name may be squatted in the meantime — availability is re-verified at publish time, and a rename would be a brand-string + ADR change, not a code change. The naming itself (Penmark, `pmk:`, extension ID, display-name pattern) is unchanged and remains in force locally.

## Amendment — 2026-06-14: repository made public (source-visibility only)

Owner decision (Carlos): the GitHub repository `carlosboeing/penmark` is now **public**. This is a **source-visibility change only** and does not alter the distribution model — Penmark remains local-first (VSIX sideloaded), and marketplace / dual-registry publishing stays in the deferred publish track (decision 3 remains suspended; the prior amendment stands). Motivation: public repositories get unlimited free GitHub Actions minutes, which unblocks CI/Release — previously every run failed under the private-repo spending limit, a billing block rather than a code failure. Going public is also the point at which the standard open-source security and community gates are added (secret scanning + push protection, Dependabot, CodeQL default setup, private vulnerability reporting, branch protection, Code of Conduct, contributing guide, issue/PR templates). A pre-flight gitleaks scan over the full history was clean before the flip. The naming, `pmk:` namespace, extension ID, and display-name pattern are unchanged.
