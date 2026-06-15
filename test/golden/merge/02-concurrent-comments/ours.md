# Queue design

Messages are delivered <!--pmk:s eeee3333-->at least once<!--/pmk:s eeee3333-->. Consumers must be idempotent because redelivery is expected after a crash or a rebalance.

The dead-letter queue captures messages that exceed the retry limit. Operators inspect it daily and replay or discard the contents.

<!-- pmk:review v1 -->
<!--pmk:c eeee3333
carlos (human) · 2026-06-12 09:02 +10:00
> at least once

Should we offer exactly-once delivery via dedup keys instead?
-->
<!-- /pmk:review -->
