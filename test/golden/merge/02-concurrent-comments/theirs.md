# Queue design

Messages are delivered at least once. Consumers must be idempotent because redelivery is expected after a crash or a rebalance.

The <!--pmk:s ffff4444-->dead-letter queue<!--/pmk:s ffff4444--> captures messages that exceed the retry limit. Operators inspect it daily and replay or discard the contents.

<!-- pmk:review v1 -->
<!--pmk:c ffff4444
dana (human) · 2026-06-12 10:20 +10:00
> dead-letter queue

What is the retention policy on the DLQ before messages are purged?
-->
<!-- /pmk:review -->
