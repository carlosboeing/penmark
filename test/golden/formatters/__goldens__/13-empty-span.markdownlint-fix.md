# Empty span pair — content-removed state

This fixture exercises the **empty span pair** semantics defined in spec §8.3 (amendment 3 from the anchor torture-test spike). An empty span pair is a well-formed opener immediately followed by its matching closer with no characters between them. It is the state a contract-following agent legitimately produces when it deletes the commented text but obeys the rule "never delete one half of a marker pair / leave the anchor in place." The markers are intact and paired, so the ladder does not classify it as an orphan, but there is nothing to highlight: reconcile MUST treat it as **content removed** — keep the entry, surface it in the drawer's needs-attention section with the advisory quote as context, and never render it as an invisible highlight.

## Empty pair on its own line

The reviewer commented on a sentence that has since been deleted in full. The agent kept the marker pair as an empty, zero-length span:

<!--pmk:s s3d2f5gh--><!--/pmk:s s3d2f5gh-->

The paragraph that follows is unrelated and carries no anchor.

## Empty pair adjacent to surviving prose

Here the commented phrase was removed mid-paragraph but the surrounding sentence survives, leaving the empty pair inline: the budget section was rewritten and the phrase <!--pmk:s w3n6d2pz--><!--/pmk:s w3n6d2pz--> is gone, yet the markers remain so the comment is not silently lost.

<!-- pmk:review v1 -->
<!--pmk:c s3d2f5gh
carlos (human) · 2026-06-12 11:30 +10:00
> the ten-thousand-line document with two hundred anchors

The fixture this referred to was deleted; the comment should resurface as content-removed, not vanish.
-->
<!--pmk:c w3n6d2pz
claude-code (agent) · 2026-06-12 11:32 +10:00
> fifty thousand requests per second

The phrase was cut during a rewrite; advisory quote preserves what was originally flagged.
-->
<!-- /pmk:review -->
