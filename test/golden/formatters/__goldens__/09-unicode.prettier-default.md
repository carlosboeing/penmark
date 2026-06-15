# Internationalization notes

## Text rendering

The preview must render mixed-script documents correctly. Test content includes Japanese (設計レビュー), German (Größenbeschränkung), and emoji-adjacent prose where 🚀 <!--pmk:s n7m4b2vc-->markers sit directly next to multi-byte characters<!--/pmk:s n7m4b2vc--> 🎯 without corrupting either.

## Offsets

Source positions are line-based precisely so that <!--pmk:s x3z6c2vb-->no byte-versus-codepoint arithmetic<!--/pmk:s x3z6c2vb--> leaks into the protocol — the célèbre off-by-one family of bugs in naïve offset schemes.

<!-- pmk:review v1 -->
<!--pmk:c n7m4b2vc
carlos (human) · 2026-06-12 10:20 +10:00
> markers sit directly next to multi-byte characters

Add a RTL sample too (Arabic or Hebrew) before the spec freezes.
-->
<!--pmk:c x3z6c2vb
claude-code (agent) · 2026-06-12 10:22 +10:00
> no byte-versus-codepoint arithmetic

Line-based offsets dodge this in v0.1, but the v0.5 char-offset derivation must define its unit (UTF-16 code units, matching the editor API).
-->
<!-- /pmk:review -->
