# Lint-dirty stressor

This document deliberately violates auto-fixable markdownlint rules near anchors, the way AI-generated docs often do.

- the first list uses dashes
- so the consistent-style rule locks onto dashes

A second list switches markers, which the fixer rewrites:

- item with <!--pmk:s lntspn2a-->a span inside a starred list item<!--/pmk:s lntspn2a--> and trailing spaces
- second starred item  

## Anchored list glued to its marker
<!--pmk:b lntblk2b-->
- list item immediately after the block anchor
- no blank line anywhere around this list

## Anchored fence without breathing room
<!--pmk:b lntblk2c-->
```js
console.log("blank-line rules will wedge space above this fence");
```

Trailing paragraph right after the fence.

<!-- pmk:review v1 -->
<!--pmk:c lntspn2a
carlos (human) · 2026-06-12 11:00 +10:00
> a span inside a starred list item

List style will be normalized by the fixer; the span must ride along.
-->
<!--pmk:c lntblk2b
carlos (human) · 2026-06-12 11:01 +10:00
> - list item immediately after the block anchor

Watch whether blank-line fixes separate this marker from its list.
-->
<!--pmk:c lntblk2c
claude-code (agent) · 2026-06-12 11:02 +10:00
> ```js

Same adjacency question for the fence; record any drift in the spike report.
-->
<!-- /pmk:review -->
