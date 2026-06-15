# Auth service design overview

This document describes the <!--pmk:s k7m2q5ax-->high
level<!--/pmk:s k7m2q5ax--> design for the authentication service. The service
issues short-lived access tokens and rotates refresh tokens on every use, which
keeps the blast radius of a leaked token small.

The token verifcation path is performance critical. We expect
<!--pmk:s w3n6d5pz-->fifty thousand requests per second<!--/pmk:s w3n6d5pz--> at
peak, and the budget for verification is two milliseconds per request including
signature checks.

Session revocation uses a bloom filter that is rebuilt every minute from the
revocation table. False positives fall back to a databse lookup, so revoked
sessions are always caught while the common path stays fast.

Operationally the service is <!--pmk:s r6t2v4hq-->stateless and horizontally
scalable<!--/pmk:s r6t2v4hq-->, which means deployment is a rolling restart with
no draining logic beyond the load balancer's connection grace period.

<!-- pmk:review v1 -->
<!--pmk:c k7m2q5ax
carlos (human) · 2026-06-12 09:02 +10:00
> high level

This doc should also contain the low level details, at least for the token verification path.
-->
<!--pmk:c w3n6d5pz
carlos (human) · 2026-06-12 09:04 +10:00
> fifty thousand requests per second

Where does this number come from? Link the capacity model.
-->
<!--pmk:c r6t2v4hq
claude-code (agent) · 2026-06-12 09:06 +10:00
> stateless and horizontally scalable

The bloom filter rebuild makes this only mostly true; note the warm-up window after a cold start.
-->
<!-- /pmk:review -->
