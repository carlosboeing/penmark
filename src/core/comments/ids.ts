import { randomInt } from "node:crypto";

/**
 * Comment/anchor IDs (Penmark format spec §3).
 *
 * An ID is exactly 8 characters from the RFC 4648 lowercase base32 alphabet
 * `abcdefghijklmnopqrstuvwxyz234567` (regex `[a-z2-7]{8}`). The alphabet
 * deliberately excludes `0`, `1`, `8`, `9` and uppercase, so an ID slot
 * containing any of those is not a valid marker and is treated as corruption.
 */

const ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
const ID_LENGTH = 8;
const ID_RE = /^[a-z2-7]{8}$/;

/** True iff `s` is exactly 8 chars of valid base32 lowercase (spec §3). */
export function isValidId(s: string): boolean {
  return ID_RE.test(s);
}

/**
 * Generate a fresh 8-character base32 ID. `rng` returns a float in [0, 1);
 * the default draws from `node:crypto` (40 bits of entropy, spec §3) and is
 * quantized to 1/32 so `floor(rng() * 32)` recovers the chosen index exactly.
 */
export function generateId(
  rng: () => number = () => randomInt(0, ALPHABET.length) / ALPHABET.length,
): string {
  let id = "";
  for (let i = 0; i < ID_LENGTH; i++) {
    const idx = Math.min(ALPHABET.length - 1, Math.max(0, Math.floor(rng() * ALPHABET.length)));
    id += ALPHABET.charAt(idx);
  }
  return id;
}

/**
 * Generate an ID not present in `taken`, retrying on collision so a writer
 * never duplicates a live ID within a document (spec §3 / §7.4).
 */
export function freshId(taken: ReadonlySet<string>, rng?: () => number): string {
  let id = generateId(rng);
  while (taken.has(id)) {
    id = generateId(rng);
  }
  return id;
}
