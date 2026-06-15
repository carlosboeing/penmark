# Negative fixture — malformed markers and IDs

This fixture is **negative**: every `pmk:`-shaped construct below is invalid, and a conforming parser MUST NOT treat any of them as a live anchor. Each is classified as **corruption** (or ignored as ordinary HTML-comment text), never as `intact`. The fixture exercises the rejection rules in spec §3 (ID grammar) and §8 (degradation ladder / corruption). It deliberately carries no `pmk:review` block: a parser MUST tolerate malformed markers in a document that has no review block at all.

## Invalid ID alphabet — digits outside base32 `a-z2-7`

The ID `k7m2q9ax` contains `9`, which is not in the base32 alphabet, so this is not a valid span opener: <!--pmk:s k7m2q9ax-->text<!--/pmk:s k7m2q9ax--> and it MUST be classified as corruption.

The ID `f3w8r1zn` contains `8` and `1`, both excluded, so this is not a valid block anchor: <!--pmk:b f3w8r1zn-->

The ID `abcdef01` contains `0` and `1`, both excluded: <!--pmk:s abcdef01-->zero and one<!--/pmk:s abcdef01-->.

Uppercase is outside the lowercase base32 profile: <!--pmk:s ABCD2345-->upper<!--/pmk:s ABCD2345--> MUST be rejected.

## Wrong ID length — not exactly 8 characters

Too short: <!--pmk:s abc2-->short id<!--/pmk:s abc2--> is malformed.

Too long: <!--pmk:s abcdefghij-->long id<!--/pmk:s abcdefghij--> is malformed.

## Stray closer — opener absent

A closing span marker with no matching opener anywhere in the document is a stray closer and MUST be flagged as corruption for cleanup: <!--/pmk:s mn4p6q2r-->

## Half a range pair — opener with no closer

A range opener whose run is never closed is malformed. The ID `d6t4y6km` is valid base32, so this case isolates the §4.3 half-pair rule rather than tripping the §3 alphabet check first:

<!--pmk:r d6t4y6km o-->
This paragraph has a range opener, but the run is never closed by a matching `c` marker.

## Block marker not on its own line

A block anchor MUST occupy its own line. Embedded mid-sentence like this <!--pmk:b a5s4d6fg--> it is corruption, not a block anchor.

## Unknown marker kind

The kind letter after `pmk:` MUST be one of `s`, `b`, `r`, `c`. An unknown kind is not a marker: <!--pmk:x q4w7e2rt-->unknown kind<!--/pmk:x q4w7e2rt-->

## Malformed review header

A review header with an unrecognized version token is not a valid block delimiter: <!-- pmk:review v0 --> and neither is this one with the space removed: <!-- pmk:reviewv1 -->
