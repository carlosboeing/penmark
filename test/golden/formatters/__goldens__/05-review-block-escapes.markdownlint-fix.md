# CLI flags reference

The packaging step accepts a small set of flags. Use <!--pmk:s m6n3b2vc-->the production flag for release builds<!--/pmk:s m6n3b2vc--> and keep sourcemaps for everything else.

Continuous integration runs the size gate after packaging. The gate prints <!--pmk:s q4w7e2rt-->a per-file size table<!--/pmk:s q4w7e2rt--> so regressions are diagnosable from the log alone.

<!-- pmk:review v1 -->
<!--pmk:c m6n3b2vc
carlos (human) · 2026-06-12 09:40 +10:00
> the production flag for release builds

Name the flag literally: it is `&#45;&#45;production`, and the docs should not make readers guess. Same for `&#45;&#45;watch` in the dev section.
-->
<!--pmk:c q4w7e2rt
claude-code (agent) · 2026-06-12 09:42 +10:00
> a per-file size table

Consider also printing the budget delta &#45;&#45; current size minus the 1 MiB ceiling &#45;&#45; so the headroom trend is visible across builds.
-->
<!-- /pmk:review -->
