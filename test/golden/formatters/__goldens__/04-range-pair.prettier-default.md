# Background

The preview needs to work identically across three IDEs that share a webview API surface but diverge in version and packaging.

# Approach

<!--pmk:r d3t4y6km o-->

First, all rendering happens in the extension host. The webview receives sanitized HTML over a versioned protocol, never raw markdown, so the untrusted-content boundary sits in exactly one place.

Second, the core engine has zero IDE imports. The same render and comment code must serve a future web app, and a lint-enforced boundary is cheaper than a monorepo split.

Third, every block element carries a source position. Selection mapping and scroll sync both derive from this one attribute, so it is an acceptance criterion rather than an optimization.
<!--pmk:r d3t4y6km c-->

# Risks

The main risk is <!--pmk:s u3i7o2pe-->webview behavior drift between the forks<!--/pmk:s u3i7o2pe-->, which we contain with a versioned message protocol and a per-release smoke checklist on all three IDEs.

<!-- pmk:review v1 -->
<!--pmk:c d3t4y6km
carlos (human) · 2026-06-12 09:30 +10:00
> First, all rendering happens in the extension host.

This whole argument should reference ADR 0001 explicitly; it reads as opinion without the decision record.
-->
<!--pmk:c u3i7o2pe
claude-code (agent) · 2026-06-12 09:32 +10:00
> webview behavior drift between the forks

Antigravity 1.107 changed webview CSP handling; worth a line here.
-->
<!-- /pmk:review -->
