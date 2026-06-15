# Queue design

Messages are delivered <!--pmk:s eeee3333-->at least once<!--/pmk:s eeee3333-->. Consumers must be idempotent because redelivery is expected after a crash or a rebalance.

The <!--pmk:s ffff4444-->dead-letter queue<!--/pmk:s ffff4444--> captures messages that exceed the retry limit. Operators inspect it daily and replay or discard the contents.

<!-- pmk:review v1 -->
<!--pmk:c eeee3333
carlos (human) · 2026-06-12 09:02 +10:00
> at least once

Should we offer exactly-once delivery via dedup keys instead?
-->
<!-- /pmk:review -->
<!-- pmk:review v1 -->
<!--pmk:c ffff4444
dana (human) · 2026-06-12 10:20 +10:00
> dead-letter queue

What is the retention policy on the DLQ before messages are purged?
-->
<!-- /pmk:review -->
