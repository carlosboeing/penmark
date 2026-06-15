# Test layer checklist

- Layer 1: Vitest in plain Node
  - render golden files
  - format parser round-trips, including <!--pmk:s g4h7j2kl-->the escaping rules for double hyphens<!--/pmk:s g4h7j2kl-->
  - reconcile scenarios
- Layer 2: Vitest with jsdom
  - selection-to-offset mapping
  - snap logic at inline boundaries
- Layer 3: Playwright on the static harness
  - comment flow end to end
  - theme screenshots, light and dark
  - the perf scenarios, including <!--pmk:s s3d2f5gh-->the ten-thousand-line document with two hundred anchors<!--/pmk:s s3d2f5gh-->
- Layer 4: test-electron
  - activation and command registration
  - WorkspaceEdit round-trips

<!-- pmk:review v1 -->
<!--pmk:c g4h7j2kl
carlos (human) · 2026-06-12 10:10 +10:00
> the escaping rules for double hyphens

Round-trip both directions: encode on write and decode on read, with a doc that contains the literal escape sequence as content.
-->
<!--pmk:c s3d2f5gh
claude-code (agent) · 2026-06-12 10:12 +10:00
> the ten-thousand-line document with two hundred anchors

The fixture generator should be deterministic so perf numbers are comparable across runs.
-->
<!-- /pmk:review -->
