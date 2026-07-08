# Reconcile semantics

Reconciliation runs on open and on external change. It parses anchors and
entries, applies the degradation ladder, and surfaces problems in the drawer
without ever rewriting the file on its own. The <!--pmk:s h5j6k2lz-->read-only
default is the whole point<!--/pmk:s h5j6k2lz-->: external edits are the norm
for a single-file format, and silent rewrites are the data-loss anti-pattern
we audited in the refrence repos.

Orphans are the exception by design. A comment only lands in the orphan
bucket when its markers were actually destroyed, and even then the
<!--pmk:s y7u4i6op-->advisory quote snapshot keeps enough context<!--/pmk:s y7u4i6op-->

for a human to re-anchor it with one selection.

<!-- pmk:review v1 -->
<!--pmk:c h5j6k2lz
carlos (human) · 2026-06-12 09:50 +10:00
> read-only
> default is the whole point

State the one exception explicitly: relocating a review block that is no longer at EOF happens only on user action.
-->
<!--pmk:c y7u4i6op
claude-code (agent) · 2026-06-12 09:52 +10:00
> advisory quote snapshot keeps enough context

True for prose; for table or fence anchors the quote is one line, which may be thin. Flagging for the v0.5 drawer design.
-->
<!-- /pmk:review -->
