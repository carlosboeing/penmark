# Queue design

Messages are delivered at least once. Consumers must be idempotent because redelivery is expected after a crash or a rebalance.

The dead-letter queue captures messages that exceed the retry limit. Operators inspect it daily and replay or discard the contents.
