---
type: spec
status: frozen-draft
date: 2026-06-13
spec-version: 1
---

# Penmark comment format — specification v1 (frozen-draft)

This document is the **normative** specification of the Penmark in-document comment format, version 1 (`pmk:review v1`). It is the single source of truth for any program that reads or writes the format: the Penmark extension, AI agents acting on a reviewed document, and the future Penmark web app. The design document is descriptive and motivational; where the two differ, **this spec governs**. Decisions of record: ADR 0002 (single-file storage, resolve = delete) and ADR 0006 (span wrapping pairs, degradation ladder, advisory quote), which supersedes ADR 0003.

The key words MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD NOT, MAY, and OPTIONAL are to be interpreted as described in RFC 2119.

A document conforms to this spec if it satisfies §3–§7. A parser conforms if it accepts every conforming document, applies the degradation ladder of §8 to a mutated document, and rejects or classifies as corruption every construct in §9. The conformance corpus under [`conformance/`](conformance/) is the executable witness; §10 maps each normative rule to the fixtures that exercise it.

## 1. Scope

This spec covers:

- the **anchor grammar** placed in the document body — span pairs, block anchors, and range pairs (§4);
- the **review-block grammar** at end of file — the block delimiters and the per-comment entry format (§5);
- **escaping** of the HTML-comment terminator inside entry text (§6);
- **invariants** a conforming writer MUST maintain (§7);
- the **degradation ladder and reconcile semantics** a conforming parser applies to a possibly-mutated document, including empty-pair (content-removed) and orphan states (§8);
- **corruption** — the constructs a parser MUST reject (§9).

It does not cover: rendering, the webview protocol, settings, or UI surfacing of orphans (those are design/architecture concerns). It does not define a v2 grammar; it defines how v1 is detected so a future v2 can coexist (§2).

## 2. Spec versioning

The format version is carried by the review-block header, not by any application version. A committed document outlives any installed version of any tool, so every parser MUST be able to detect which grammar wrote a document's review block and refuse to silently misread a future version.

- The review block opens with the exact line `<!-- pmk:review v1 -->` (§5.1). The token `v1` is the **format version**, and it is the only version this spec defines.
- A parser implementing this spec MUST recognize `v1`. On encountering a header whose version token it does not recognize (for example a future `v2`), a parser MUST NOT parse the entries with v1 rules; it SHOULD surface the block as "review data needs attention" and leave it untouched.
- The version token matches `v[0-9]+`. A header that does not match the exact `<!-- pmk:review v1 -->` byte sequence (including the single spaces) is not a valid v1 review header (§9).
- All markers share the `pmk:` namespace. The `pmk:` prefix is RESERVED; documents MUST NOT use HTML comments beginning with `pmk:` for any purpose other than this format.

## 3. ID grammar (normative)

Every anchor and every entry is keyed by an **ID**.

- An ID is **exactly 8 characters** from the RFC 4648 lowercase base32 alphabet: `abcdefghijklmnopqrstuvwxyz234567` (regex `[a-z2-7]{8}`).
- The alphabet **excludes** the digits `0`, `1`, `8`, and `9` and excludes uppercase letters. A construct whose ID slot contains any excluded character, or is not exactly 8 characters long, is **not a valid marker** and MUST be treated as corruption (§9).
- IDs SHOULD be generated from a cryptographically adequate random source (40 bits of entropy). Collision within a single document MUST be avoided by the writer; a parser encountering two live anchors with the same ID and kind MAY treat the later as corruption.
- An anchor in the body and its entry in the review block share the same ID; that shared ID is the join key.

> Rationale (informative): the explicit alphabet closes the defect found in the anchor torture-test spike (finding 1) — the original design examples `k7m2q9ax` / `f3w8r1zn` used `9`, `8`, and `1`, which are not base32. Every example and fixture in this spec uses only valid base32 IDs.

## 4. Anchor grammar (normative)

Anchors are invisible HTML comments placed in the document body. There are three kinds. All anchor markers are written with **no internal spaces other than the single space between `pmk:<kind>` and the ID** (and, for ranges, the single space before the `o`/`c` side letter).

### 4.1 Span pair

A span anchor is a **wrapping pair** of HTML comments around the selected inline text:

```
<!--pmk:s ID-->selected text<!--/pmk:s ID-->
```

- Grammar: opener `<!--pmk:s <ID>-->`, then the selected text (zero or more characters), then closer `<!--/pmk:s <ID>-->` with the **same ID**.
- The markers — not a stored offset and not the quote — define the highlight extent. Text between the markers MAY be edited freely; a conforming writer MUST keep both markers intact while editing the span text (§7). Editing the span text MUST NOT orphan the comment.
- The two markers of a pair MAY be separated by line breaks (a formatter may reflow prose between them); they need not be on the same line. The opener and closer MUST share the same ID.
- An opener immediately followed by its closer with **no characters between** is an **empty span pair** — a valid construct with defined "content removed" semantics (§8.3).

A writer MUST place span markers so they never split an inline-code span, never split emphasis or link delimiters, and never cross a block boundary. Where a selection cannot satisfy these rules inline, the writer MUST use a block anchor (§4.2) on the enclosing block instead. Span markers MUST NOT be placed inside code fences, YAML frontmatter, link-reference definitions, or table internals; the enclosing block gets a block anchor.

### 4.2 Block anchor

A block anchor marks a whole block element (table, image, fenced code, diagram, or paragraph):

```
<!--pmk:b ID-->
| col | col |
|-----|-----|
```

- Grammar: a single comment `<!--pmk:b <ID>-->` on **its own line**, placed on the line immediately preceding the target block, with no blank line wedged between the marker and its block.
- The marker MUST be the only non-whitespace content on its line. A `pmk:b` comment that shares a line with other text is corruption (§9), not a block anchor.
- A block anchor has no closer; the target is the single block that follows.

### 4.3 Range pair

A range anchor is a **block-aligned pair** wrapping a contiguous run of one or more whole blocks:

```
<!--pmk:r ID o-->
First block of the run.

Last block of the run.
<!--pmk:r ID c-->
```

- Grammar: opener `<!--pmk:r <ID> o-->` and closer `<!--pmk:r <ID> c-->`, sharing the **same ID**, the opener carrying the side letter `o` and the closer `c`. Each marker is on its own line.
- The opener MUST appear before the closer in document order. The wrapped run is every block between them.
- A range opener without a matching closer (or vice versa) is a half-pair and is corruption / orphan-producing (§8.4, §9).

## 5. Review block grammar (normative)

### 5.1 Block delimiters

Comment bodies live in a single delimited block at the **end of the file**:

- The block opens with the exact line `<!-- pmk:review v1 -->` and closes with the exact line `<!-- /pmk:review -->`. Both are HTML comments with the spacing shown (a space after `<!--` and before `-->`).
- A conforming document has **at most one** review block. After the closing delimiter there MUST be no content other than optional trailing whitespace; the block is the last meaningful content in the file.
- A document with **zero comments has no review block at all** — the delimiters MUST NOT be emitted for an empty review.
- Everything between the delimiters is HTML comments and therefore invisible in every Markdown renderer.

### 5.2 Entry grammar

Each comment is one HTML comment — an **entry** — using the markdown-style chat shape. Entries are **append-only**: a writer adds new entries at the end of the block and never reorders existing ones.

```
<!--pmk:c ID
<author> (human|agent) · <timestamp>
> advisory quote line
> second advisory quote line

body prose, one or more lines, until the terminator
-->
```

The entry grammar, line by line:

| Part | Rule |
|---|---|
| Line 1 | `pmk:c <ID>` — the literal `<!--pmk:c ` followed by the ID. In v1 nothing else appears on line 1. (v2 replies append ` re <parent-id>`; a v1 writer MUST NOT emit it. See §5.3.) |
| Line 2 | `<author> (human\|agent) · <timestamp>` — the meta line (§5.2.1). |
| Quote lines | Zero or more lines each beginning with `> `, holding the advisory quote (§5.2.2). |
| Blank line | Exactly one blank line separates the quote from the body. |
| Body | One or more lines of plain prose, terminated by the closing `-->` of the HTML comment. |

- One entry per HTML comment. There MUST be exactly one entry per live anchor ID, and exactly one anchor per entry ID (the join is 1:1 in v1).
- The order of entries in the block is not semantically significant to anchoring (the anchor is the source of truth for location), but writers append.

#### 5.2.1 Meta line

`<author> (human|agent) · <timestamp>`

- `<author>` is free-form text; the default is the value of `git config user.name`. It MUST NOT contain the substring ` (human)` or ` (agent)` followed by ` · ` ahead of the real tag (i.e. the provenance tag and the ` · ` separator delimit the author from the timestamp).
- The provenance tag is exactly `(human)` or `(agent)`, in parentheses, distinguishing who authored the comment. It is stable so the future web app can layer authentication on it.
- The separator between the tag and the timestamp is ` · ` (space, U+00B7 MIDDLE DOT, space).
- `<timestamp>` matches `YYYY-MM-DD HH:MM[:SS] ±HH:MM` — a date, a 24-hour time with optional seconds, and a numeric UTC offset. It is human-readable in raw and machine-parseable.

#### 5.2.2 Advisory quote

- The quote is the lines beginning with `> `, holding a snapshot of the commented text **at comment time**. It is rendered as a Markdown blockquote shape but lives inside the HTML comment, so it is invisible.
- The quote is **advisory only** (ADR 0006): it powers the "edited since commented" indicator, the degradation-ladder fallback (§8.2), and orphan/content-removed context. It is maintained by tooling, never by hand. A mismatch between the quote and the current span text is **not** an orphan and MUST NOT be treated as one.
- A quote spanning multiple source lines is written as one `> ` line per source line.

#### 5.2.3 Anchor type is not stored

The entry MUST NOT record the anchor kind. The anchor in the body (`pmk:s` / `pmk:b` / `pmk:r`) is the single source of truth for the kind and location. A reader determines an entry's kind by finding the body anchor with the matching ID.

### 5.3 Replies (v2 — reserved, not written in v1)

The format reserves threaded replies for v2: an entry may carry ` re <parent-id>` on line 1 (`pmk:c <new-id> re <parent-id>`). A **v1 writer MUST NOT emit this form.** A v1 parser MAY ignore a trailing ` re <parent-id>` it does not understand, but documents produced under this spec do not contain it. Replies are listed here only so the v1 grammar leaves room for them.

## 6. Escaping (normative)

The HTML-comment terminator is `-->`, and `--` may not legally appear inside an HTML comment. The format therefore escapes hyphens:

- Any occurrence of the two-character sequence `--` inside an entry's quote or body MUST be written as `&#45;&#45;` (two HTML decimal character references for the hyphen). A reader decodes `&#45;&#45;` back to `--`.
- A writer MUST guarantee that no unescaped `-->` (and no bare `--`) can appear inside an entry, so the entry's own terminator is always the first `-->` after the body. This is a hard writer guarantee, not best-effort.
- The escape applies to entry text only (quote lines and body). It does not apply to the markers themselves, which contain no `--` other than their own comment delimiters.
- Round-trip property: `decode(encode(s)) == s` for any string `s`; a body containing the literal text `--production` is stored as `&#45;&#45;production` and read back as `--production`.

## 7. Writer invariants (normative)

A conforming writer MUST maintain all of the following:

1. **Atomic mutation.** Adding a comment inserts the anchor and the entry in a single edit (one undo step). Resolving/deleting removes the anchor(s) and the entry in a single edit. Resolve and delete are the same operation (ADR 0002).
2. **Review block lifecycle.** The review block is created on the first comment and removed entirely when the last comment is removed. It is always the last meaningful content in the file (§5.1).
3. **Marker pair integrity.** A writer MUST NOT emit, or leave behind, half of a span pair or half of a range pair except as the transient result of destructive user edits the reconcile pass then cleans up. A writer MUST NOT re-ID, duplicate, or split an existing anchor.
4. **ID validity.** Every emitted ID conforms to §3.
5. **Escaping.** Every emitted entry conforms to §6.
6. **Append-only entries.** New entries are appended; existing entries are never reordered or rewritten except to refresh the advisory quote snapshot (tooling only). Tooling SHOULD refresh an entry's advisory quote whenever it performs its own write to the review block for that comment; agents and humans MUST NOT edit quote lines by hand (see the agent contract in `AGENTS-GUIDE.md`).
7. **No silent rewrite.** A writer MUST NOT rewrite the file as a side effect of merely reading it; structural repairs (relocating a misplaced review block, stripping stray closers) happen only on explicit user action (§8.5).

## 8. Degradation ladder and reconcile (normative)

Reconcile runs on open and on external change. It parses the body anchors and the review-block entries and classifies each comment by applying the ladder below to the **current** document. Reconcile is **read-only by default**: it computes states for surfacing and only rewrites the file on explicit user action (§8.5).

### 8.1 Span states

For a span comment with ID `X`:

| Condition in current document | State |
|---|---|
| Opener `pmk:s X` and closer `/pmk:s X` both present, opener before closer | `intact` — highlight is the text between them (or content-removed if empty, §8.3) |
| Opener present, closer absent | descend to §8.2 |
| Opener absent | `orphan` (if a stray closer remains, flag it for cleanup) |

### 8.2 Closer-destroyed fallback (advisory quote)

When the opener survives but the closer is gone, the opener degrades to a **point anchor** and the extent is recovered by matching the advisory quote against the document text:

- If the advisory quote (whitespace-normalized) is found in the current document, the state is `degraded-recovered` and the extent is the matched text.
- If the whitespace-normalized quote matches at multiple positions, the match nearest to the surviving opener marker (by line distance) is the recovered extent.
- If the quote is empty or no longer matches, the state is `orphan`.

This is ADR 0003's point-plus-quote model retained strictly as the **fallback**, not the default. Reaching it requires the closer to have been destroyed — by design a rare event.

### 8.3 Empty span pair — content removed (normative; amendment 3)

An `intact` span whose markers are adjacent with **no characters between them** is an **empty span pair**. Its meaning is defined:

- It signals that **the commented content was removed** while the marker pair was preserved (the contract-sanctioned alternative to deleting the markers — see the agent contract, §11 of the design and `AGENTS-GUIDE.md`).
- Reconcile MUST classify it as **content-removed**, a distinct state from both `intact` (with content) and `orphan`. It MUST keep the entry, and it MUST surface the comment in the drawer's needs-attention section using the advisory quote as context — the same UX as an orphan, but with better data: the location is still known exactly.
- An empty span pair MUST NOT be silently dropped, and MUST NOT be rendered as a zero-width / invisible highlight (an invisible highlight would defeat the product).

> Rationale (informative): the spike (finding 3) observed a contract-following agent delete a commented sentence in full but keep the span as `<!--pmk:s ID--><!--/pmk:s ID-->`, citing the "never delete one half / leave the anchor in place" rules. The markers are intact, so the ladder does not orphan it; this section gives that intact-but-empty state a name and a defined behavior.

### 8.4 Block and range states

| Kind | Condition | State |
|---|---|---|
| Block | `pmk:b X` present on its own line | `intact` |
| Block | `pmk:b X` present but not alone on its line | `corruption` (§9) |
| Block | `pmk:b X` absent | `orphan` |
| Range | `pmk:r X o` and `pmk:r X c` both present, `o` before `c` | `intact` |
| Range | exactly one side present | `orphan`, the surviving half flagged as a stray for cleanup |
| Range | both absent | `orphan` |

### 8.5 Reconcile actions

- Only comments whose ladder is **exhausted** (markers destroyed, quote unrecoverable) land in the **orphan bucket**, with the quote preserved and re-anchor / delete actions offered. Content-removed comments (§8.3) appear in the same needs-attention surface with their location intact.
- **Stray unmatched closers** (a `/pmk:s X` or a lone range half with no live opener) are flagged for cleanup.
- A review block **not at EOF** is relocated to EOF — only on explicit user action.
- A **second review block** (more than one in the document, §9) surfaces the document as corrupted: the EOF block is authoritative, and the extra block's entries are preserved for needs-attention rather than dropped; merging or removing the extra block happens only on explicit user action.
- Reconcile MUST NEVER silently discard a comment. It rewrites the file only on explicit user action; on open it is read-only.

## 9. Corruption — constructs a parser MUST reject (normative)

The following are **not** valid markers. A conforming parser MUST NOT treat any of them as a live anchor or entry; it classifies them as corruption (or, where they are simply ordinary HTML comments, ignores them) and surfaces affected review data as "needs attention" rather than misreading it:

| Construct | Why it is rejected |
|---|---|
| ID with a character outside `[a-z2-7]` (e.g. contains `0`, `1`, `8`, `9`, or uppercase) | §3 — invalid alphabet |
| ID not exactly 8 characters | §3 — wrong length |
| Closing span marker `/pmk:s X` with no matching opener | §8.1 — stray closer |
| Range half (`o` or `c`) with no matching opposite half | §8.4 — half-pair |
| `pmk:b X` not alone on its line | §4.2 — block marker not on own line |
| Marker with an unknown kind letter (anything other than `s`, `b`, `r`, `c`) | §4 / §5 — unknown kind |
| Review header that is not the exact byte sequence `<!-- pmk:review v1 -->` | §2, §5.1 — malformed or unrecognized header |
| More than one review block in the document | §5.1 — at most one review block; the block satisfying §5.1's position rule (the one at EOF) is authoritative, any other review block is corruption. The parser MUST NOT silently drop its entries and MUST surface the document as corrupted. |
| Any other `pmk:`-prefixed residue that does not parse as a defined marker | §2 — reserved namespace, mangled marker |

A parser MUST be able to process a document containing corruption without crashing and without losing the well-formed comments around it. Corruption in the review block surfaces as "review data needs attention" (design §9); corruption among body anchors surfaces via the orphan/needs-attention path.

## 10. Conformance fixtures

The conformance corpus lives in [`conformance/`](conformance/). Fixtures `01`–`11` are the anchor torture-test spike corpus (graduated here in plan task P0.6); `12`–`14` were added to close the coverage gaps from the spike amendments. Every fixture is a complete, well-formed Penmark document except `12-negative-malformed.md`, which is deliberately invalid (a negative fixture). Fixture `14-degraded-states.md` is well-formed but carries deliberately mutated spans (closer destroyed) so reconcile must apply the §8.2 fallback ladder.

| File | Exercises |
|---|---|
| `01-plain-prose-spans.md` | Span pairs in plain prose; multiple human + agent entries |
| `02-inline-formatting-spans.md` | Span pairs adjacent to inline code, emphasis, links (AST-safety) |
| `03-block-anchors.md` | Block anchors before table / fenced code / image / paragraph |
| `04-range-pair.md` | A multi-block range pair plus a span in the same document |
| `05-review-block-escapes.md` | `&#45;&#45;` escaping in quote and body; round-trip of `--production` |
| `06-hard-wrapped.md` | Span pair split across hard-wrapped lines; multi-line advisory quote |
| `07-long-lines.md` | Very long unwrapped lines containing span pairs |
| `08-nested-lists.md` | Span pairs inside nested list items |
| `09-unicode.md` | Markers adjacent to multi-byte / emoji / RTL-candidate text |
| `10-dense-anchors.md` | 50 span anchors + entries (density / dense review block) |
| `11-lint-dirty.md` | Lint-dirty doc: list-marker normalization, blank-line adjacency around anchors |
| `12-negative-malformed.md` | **Negative:** invalid-alphabet IDs, wrong-length IDs, stray closer, half range, block-not-on-own-line, unknown kind, malformed review header |
| `13-empty-span.md` | Empty span pairs (content-removed state) on their own line and inline |
| `14-degraded-states.md` | Closer-destroyed fallback (§8.2): degraded-recovered (quote matches) and orphan (quote unrecoverable) |

### 10.1 Rule-to-fixture coverage

Every normative rule below is exercised by at least one fixture. Cells list the fixture numbers (omitting `.md`).

| § | Rule | Fixtures |
|---|---|---|
| 2 | `<!-- pmk:review v1 -->` header recognized | 01–11, 13, 14 |
| 2 | Unrecognized / malformed review header rejected | 12 |
| 3 | Valid base32 `[a-z2-7]{8}` IDs only | 01–11, 13, 14 |
| 3 | Invalid-alphabet ID rejected | 12 |
| 3 | Wrong-length ID rejected | 12 |
| 4.1 | Span pair around inline text | 01, 02, 05, 06, 07, 08, 09, 10, 13 |
| 4.1 | Span markers may be separated by line breaks | 06 |
| 4.1 | Span adjacent to inline formatting (AST-safety) | 02, 09 |
| 4.2 | Block anchor on its own line before a block | 03, 11 |
| 4.2 | Block marker not on own line rejected | 12 |
| 4.3 | Range pair around a contiguous block run | 04 |
| 4.3 | Range half-pair (no matching side) rejected | 12 |
| 5.1 | Single review block, at EOF, omitted when empty | 01–11, 13, 14 |
| 5.2 | Entry: `pmk:c ID`, meta line, quote, blank, body | 01–11, 13, 14 |
| 5.2.1 | Meta line `author (human\|agent) · timestamp` | 01–11, 13, 14 |
| 5.2.2 | Advisory quote as `> ` lines; multi-line quote | 01–11, 14 (multi-line: 06) |
| 5.2.3 | Anchor type not stored in entry | 03, 04 (mix of block/range/span entries, no kind field) |
| 6 | `&#45;&#45;` escaping + `--production` round-trip | 05 |
| 7 | Writer invariants (well-formed corpus is the witness) | 01–11, 13 |
| 8.1 | Span intact baselines | 01–11 |
| 8.2 | Closer-destroyed fallback: degraded-recovered and orphan | 14 |
| 8.3 | Empty span pair (content-removed) | 13 |
| 8.4 | Block / range state inputs | 03, 04 (intact); 12 (corruption inputs) |
| 9 | Corruption: stray closer, unknown kind, residue | 12 |

No normative rule lacks a fixture. The negative fixture `12`, the empty-span fixture `13`, and the degraded-states fixture `14` were added in P0.6 specifically to cover the rejection rules (§3, §4.2, §4.3, §9), the content-removed state (§8.3), and the closer-destroyed fallback ladder (§8.2), which the original spike corpus did not exercise directly.

## 11. Tooling appendix (informative)

Not normative, but recorded for implementers:

- **Formatter compatibility.** The spike validated the grammar against Prettier 3.8.4 (defaults and `--prose-wrap always`) and markdownlint-cli2 0.22.1 `--fix`: 0 orphans, 0 corruption across 75 anchors. Wrapping pairs survive prose reflow that moves opener and closer onto different lines.
- **Prettier ignore-path (spike finding 2).** Prettier 3 honors `.gitignore` and `.prettierignore` by default. Formatter golden tests (plan task T11) MUST pass `--ignore-path=/dev/null` (or the equivalent API option) or risk silently testing nothing.
- **Reference parser.** A prototype classifier from the Phase 0 anchor torture-test spike implemented the §8 ladder and was the basis for the production parser TDD'd in v0.5. It is illustrative, not normative; this spec is the contract.
