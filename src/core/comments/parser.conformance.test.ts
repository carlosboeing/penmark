import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { parseDoc } from "./parser.js";
import type { AnchorKind, ParsedDoc } from "./types.js";

// src/core/comments is 3 levels under repo root.
const CONFORMANCE = resolve(__dirname, "../../../spec/conformance");

function fixture(name: string): string {
  return readFileSync(resolve(CONFORMANCE, name), "utf8");
}

function countKind(doc: ParsedDoc, kind: AnchorKind): number {
  let n = 0;
  for (const a of doc.anchors.values()) {
    if (a.kind === kind) n++;
  }
  return n;
}

interface Expect {
  file: string;
  span: number;
  block: number;
  range: number;
  entries: number;
  review: boolean;
  atEof?: boolean;
}

// Derived by reading each fixture against the spec §10 rule-to-fixture map.
// Anchor counts are LIVE anchors only (corruption is excluded). 14's spans are
// lone openers (closer destroyed) — still live span anchors; reconcile, not the
// parser, applies the §8.2 ladder.
const TABLE: Expect[] = [
  {
    file: "01-plain-prose-spans.md",
    span: 3,
    block: 0,
    range: 0,
    entries: 3,
    review: true,
    atEof: true,
  },
  {
    file: "02-inline-formatting-spans.md",
    span: 3,
    block: 0,
    range: 0,
    entries: 3,
    review: true,
    atEof: true,
  },
  {
    file: "03-block-anchors.md",
    span: 0,
    block: 4,
    range: 0,
    entries: 4,
    review: true,
    atEof: true,
  },
  { file: "04-range-pair.md", span: 1, block: 0, range: 1, entries: 2, review: true, atEof: true },
  {
    file: "05-review-block-escapes.md",
    span: 2,
    block: 0,
    range: 0,
    entries: 2,
    review: true,
    atEof: true,
  },
  {
    file: "06-hard-wrapped.md",
    span: 2,
    block: 0,
    range: 0,
    entries: 2,
    review: true,
    atEof: true,
  },
  { file: "07-long-lines.md", span: 2, block: 0, range: 0, entries: 2, review: true, atEof: true },
  {
    file: "08-nested-lists.md",
    span: 2,
    block: 0,
    range: 0,
    entries: 2,
    review: true,
    atEof: true,
  },
  { file: "09-unicode.md", span: 2, block: 0, range: 0, entries: 2, review: true, atEof: true },
  {
    file: "10-dense-anchors.md",
    span: 50,
    block: 0,
    range: 0,
    entries: 50,
    review: true,
    atEof: true,
  },
  { file: "11-lint-dirty.md", span: 1, block: 2, range: 0, entries: 3, review: true, atEof: true },
  { file: "13-empty-span.md", span: 2, block: 0, range: 0, entries: 2, review: true, atEof: true },
  {
    file: "14-degraded-states.md",
    span: 2,
    block: 0,
    range: 0,
    entries: 2,
    review: true,
    atEof: true,
  },
];

describe("conformance corpus — well-formed fixtures parse to the expected model", () => {
  for (const t of TABLE) {
    it(`${t.file}: ${t.span} span / ${t.block} block / ${t.range} range, ${t.entries} entries`, () => {
      const doc = parseDoc(fixture(t.file));
      expect(countKind(doc, "span")).toBe(t.span);
      expect(countKind(doc, "block")).toBe(t.block);
      expect(countKind(doc, "range")).toBe(t.range);
      expect(doc.entries).toHaveLength(t.entries);
      // Every well-formed fixture has exactly one anchor per entry id (1:1, §5.2).
      expect(doc.anchors.size).toBe(t.span + t.block + t.range);
      for (const e of doc.entries) {
        expect(doc.anchors.has(e.id)).toBe(true);
      }
      // No corruption in well-formed fixtures.
      expect(doc.corruption).toHaveLength(0);
      // Review block present, single, at EOF.
      expect(doc.review).not.toBeNull();
      expect(doc.reviewCount).toBe(1);
      expect(doc.review?.atEof).toBe(t.atEof);
    });
  }
});

describe("conformance corpus — fixture 12 negative-malformed", () => {
  const doc = parseDoc(fixture("12-negative-malformed.md"));

  it("produces ZERO live anchors", () => {
    expect(doc.anchors.size).toBe(0);
  });

  it("produces ZERO entries (no review block at all)", () => {
    expect(doc.entries).toHaveLength(0);
    expect(doc.review).toBeNull();
    expect(doc.reviewCount).toBe(0);
  });

  it("classifies exactly the expected corruption rule set", () => {
    const rules = doc.corruption.map((c) => c.rule).sort();
    // Enumeration of every malformed construct in 12 (see fixture):
    //   k7m2q9ax (9)            -> §3-invalid-alphabet  (opener + closer = 2)
    //   f3w8r1zn (8,1) block    -> §3-invalid-alphabet  (1)
    //   abcdef01 (0,1)          -> §3-invalid-alphabet  (opener + closer = 2)
    //   ABCD2345 (uppercase)    -> §3-invalid-alphabet  (opener + closer = 2)
    //   abc2 (too short)        -> §3-wrong-length       (opener + closer = 2)
    //   abcdefghij (too long)   -> §3-wrong-length       (opener + closer = 2)
    //   /pmk:s mn4p6q2r stray   -> §9-stray-closer       (1)
    //   pmk:r d6t4y6km o (half) -> §8.4-range-half-pair  (1)
    //   pmk:b a5s4d6fg not own  -> §4.2-block-not-own-line (1)
    //   pmk:x q4w7e2rt unknown  -> §4-unknown-kind       (opener + closer = 2)
    //   review v0 / reviewv1    -> §5.1-malformed-review-header (2)
    const expected = [
      "§3-invalid-alphabet",
      "§3-invalid-alphabet",
      "§3-invalid-alphabet",
      "§3-invalid-alphabet",
      "§3-invalid-alphabet",
      "§3-invalid-alphabet",
      "§3-invalid-alphabet",
      "§3-wrong-length",
      "§3-wrong-length",
      "§3-wrong-length",
      "§3-wrong-length",
      "§4-unknown-kind",
      "§4-unknown-kind",
      "§4.2-block-not-own-line",
      "§5.1-malformed-review-header",
      "§5.1-malformed-review-header",
      "§8.4-range-half-pair",
      "§9-stray-closer",
    ].sort();
    expect(rules).toEqual(expected);
  });

  it("never throws and reports each corruption with an index", () => {
    for (const c of doc.corruption) {
      expect(c.index).toBeGreaterThanOrEqual(0);
      expect(typeof c.detail).toBe("string");
    }
  });
});
