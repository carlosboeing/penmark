# Performance budgets

The activation budget is fifty milliseconds and it is measured, not
aspirational: the extension activates on command or on panel revival only, never
on language or workspace events, because <!--pmk:s c4v3b6nm-->every markdown
file in every workspace would otherwise pay the activation
cost<!--/pmk:s c4v3b6nm--> for a preview the user may never open, and that is
precisely the failure mode that made the heavyweight incumbent extension a
cautionary tale in our discovery research.

The render budget is three hundred milliseconds for a thousand-line document
measured end to end, which sounds generous until you account for the fact that
<!--pmk:s t2y5u6ik-->sanitization runs on every render, not just the
first<!--/pmk:s t2y5u6ik-->, and that the debounce window means a fast typist
effectively renders the document every three hundred milliseconds for the
duration of an editing burst.

<!-- pmk:review v1 -->
<!--pmk:c c4v3b6nm
carlos (human) · 2026-06-12 10:00 +10:00
> every markdown file in every workspace would otherwise pay the activation cost

Good framing. Add the measured activation number once T12 produces it.
-->
<!--pmk:c t2y5u6ik
claude-code (agent) · 2026-06-12 10:02 +10:00
> sanitization runs on every render, not just the first

If this dominates the budget, memoizing per-block sanitized output keyed by block hash is the planned escape hatch.
-->
<!-- /pmk:review -->
