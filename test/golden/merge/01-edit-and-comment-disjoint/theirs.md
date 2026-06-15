# Cache design

The cache uses <!--pmk:s aaaaaaaa-->write-through<!--/pmk:s aaaaaaaa--> semantics for durability. Every write hits the backing store before the cache acknowledges.

Reads are served from memory with a short time-to-live. Eviction is least-recently-used and the warm set is kept small to bound memory.

The invalidation path is <!--pmk:s bbbbbbbb-->event-driven<!--/pmk:s bbbbbbbb-->. Publishers emit change events and subscribers drop the affected keys within one second.

<!-- pmk:review v1 -->
<!--pmk:c aaaaaaaa
carlos (human) · 2026-06-12 09:02 +10:00
> write-through

Confirm write-through is required here, or can we use write-back with a journal?
-->
<!--pmk:c bbbbbbbb
dana (human) · 2026-06-12 10:15 +10:00
> event-driven

Is there a fallback if the event bus drops a message?
-->
<!-- /pmk:review -->
