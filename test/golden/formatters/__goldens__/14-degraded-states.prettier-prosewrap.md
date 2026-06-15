# Degraded states — closer-destroyed fallback ladder

This fixture exercises the **closer-destroyed fallback** defined in spec §8.2.
Each span below has a surviving opener but no matching closer — the state a
destructive user edit produces when it deletes the closing marker. The opener
degrades to a point anchor and the extent is recovered by matching the advisory
quote (whitespace-normalized) against the current document text. It is a mutated
document, not a clean baseline: reconcile MUST apply the §8.2 ladder rather than
treat the lone opener as `intact`. Where the quote still matches, the comment
recovers (`degraded-recovered`); where it no longer matches anything, the ladder
is exhausted and the comment is an `orphan`.

## Degraded but recovered — advisory quote still matches

The reviewer commented on a phrase whose closer was later deleted by a careless
edit, but the phrase itself still appears verbatim in the prose. The opener
survives <!--pmk:s t4m7k2qx-->here with no closer, and the advisory quote
`the token verification path` matches the document text below, so the extent is
recovered:

The design must document the token verification path before the renderer ships.

Reconcile classifies `t4m7k2qx` as `degraded-recovered`: the opener is the point
anchor, and the whitespace-normalized quote locates the extent.

## Orphan — quote no longer matches

Here the closer was destroyed and the commented text was also rewritten away, so
the advisory quote matches nothing in the current document. The opener survives
<!--pmk:s r5n3p6sw-->but the quoted phrase is gone, leaving the ladder
exhausted.

The surrounding paragraph was rewritten and no longer contains the originally
flagged wording.

Reconcile classifies `r5n3p6sw` as `orphan`: opener present, closer absent,
advisory quote unrecoverable. The entry is preserved and surfaced in the
needs-attention bucket with re-anchor / delete actions offered.

<!-- pmk:review v1 -->
<!--pmk:c t4m7k2qx
carlos (human) · 2026-06-12 14:10 +10:00
> the token verification path

Make sure this is described before the renderer section.
-->
<!--pmk:c r5n3p6sw
carlos (human) · 2026-06-12 14:12 +10:00
> fifty thousand requests per second at peak load

The quoted figure no longer appears anywhere in the document, so this recovers to nothing.
-->
<!-- /pmk:review -->
