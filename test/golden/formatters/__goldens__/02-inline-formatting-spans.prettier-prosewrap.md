# Renderer pipeline notes

The pipeline uses **markdown-it** with a curated plugin set. We rely on
<!--pmk:s b5x4c3mf-->the `linkify` option for autolinks<!--/pmk:s b5x4c3mf-->
instead of a separate plugin, which keeps the bundle smaller.

Sanitization happens after rendering: see the
[DOMPurify documentation](https://github.com/cure53/DOMPurify) for the API. The
<!--pmk:s j2k7s6wn-->sanitizer must preserve `data-pmk-offset`
attributes<!--/pmk:s j2k7s6wn--> or scroll sync breaks silently.

Highlighting is lazy. A fence like
```ts only triggers the loader once per session, and *unknown languages* fall back to <!--pmk:s e4g7h2ty-->plain `<code>`
output without crashing<!--/pmk:s e4g7h2ty-->, which matters for AI-generated
docs that invent language tags.

<!-- pmk:review v1 -->
<!--pmk:c b5x4c3mf
carlos (human) · 2026-06-12 09:10 +10:00
> the `linkify` option for autolinks

Double-check linkify handles bare domains the same way GitHub does.
-->
<!--pmk:c j2k7s6wn
carlos (human) · 2026-06-12 09:11 +10:00
> sanitizer must preserve `data-pmk-offset` attributes

Add a regression test for this; it is the kind of thing a DOMPurify upgrade silently breaks.
-->
<!--pmk:c e4g7h2ty
claude-code (agent) · 2026-06-12 09:13 +10:00
> plain `<code>` output without crashing

Confirmed by test in T7; consider logging unknown languages to the output channel.
-->
<!-- /pmk:review -->
