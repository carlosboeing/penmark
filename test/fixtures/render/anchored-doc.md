# Anchored document

This fixture exercises span pairs, block anchors, range pairs, and a review block.
Derived from spec/conformance/ fixtures 01, 03, and 04.

## Span pairs

This document describes the <!--pmk:s k7m2q5ax-->high level<!--/pmk:s k7m2q5ax--> design. We expect <!--pmk:s w3n6d5pz-->fifty thousand requests per second<!--/pmk:s w3n6d5pz--> at peak.

## Block anchor

<!--pmk:b f3w6r5zn-->
| IDE         | Base version |
| ----------- | ------------ |
| VS Code     | 1.105        |
| Cursor      | 1.105        |

## Range pair

<!--pmk:r d3t4y6km o-->
First, all rendering happens in the extension host. The webview receives sanitized HTML over a versioned protocol, never raw markdown.

Second, the core engine has zero IDE imports.
<!--pmk:r d3t4y6km c-->

The main risk is <!--pmk:s u3i7o2pe-->webview behavior drift between the forks<!--/pmk:s u3i7o2pe-->.

<!-- pmk:review v1 -->
<!--pmk:c k7m2q5ax
carlos (human) · 2026-06-12 09:02 +10:00
> high level

This doc should also contain low level details.
-->
<!--pmk:c w3n6d5pz
carlos (human) · 2026-06-12 09:04 +10:00
> fifty thousand requests per second

Where does this number come from?
-->
<!--pmk:c f3w6r5zn
carlos (human) · 2026-06-12 09:20 +10:00
> | IDE         | Base version |

Table is missing the verification date column.
-->
<!--pmk:c d3t4y6km
carlos (human) · 2026-06-12 09:30 +10:00
> First, all rendering happens in the extension host.

This should reference ADR 0001 explicitly.
-->
<!--pmk:c u3i7o2pe
claude-code (agent) · 2026-06-12 09:32 +10:00
> webview behavior drift between the forks

Antigravity 1.107 changed webview CSP handling.
-->
<!-- /pmk:review -->
