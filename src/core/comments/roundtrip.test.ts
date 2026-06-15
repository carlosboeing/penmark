import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import { parseDoc } from "./parser.js";
import {
  buildAddCommentEdits,
  buildResolveCommentEdits,
  type NewComment,
  type TextEdit,
} from "./serializer.js";
import type { AnchorPlacement } from "./placement.js";

const CONFORMANCE = resolve(__dirname, "../../../spec/conformance");

/** Splice TextEdits into `text`, applying right-to-left so earlier offsets stay valid. */
function applyEdits(text: string, edits: TextEdit[]): string {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  let out = text;
  for (const e of sorted) {
    out = out.slice(0, e.start) + e.newText + out.slice(e.end);
  }
  return out;
}

/**
 * Conformance fixtures that round-trip: every fixture EXCEPT the negative one
 * (`12-negative-malformed.md`, which deliberately contains corruption) and the
 * degraded-states fixture (`14`, which carries half-pairs that have no clean
 * anchor to resolve). Those are parser-corruption fixtures, not writer fixtures.
 */
const ROUNDTRIP_FIXTURES = readdirSync(CONFORMANCE)
  .filter((f) => f.endsWith(".md"))
  .filter((f) => !f.startsWith("12-") && !f.startsWith("14-"))
  .sort();

describe("round-trip: resolve drops exactly one id, leaves the rest intact", () => {
  for (const file of ROUNDTRIP_FIXTURES) {
    it(`${file}: resolving each comment removes only that id`, () => {
      const text = readFileSync(resolve(CONFORMANCE, file), "utf8");
      const doc = parseDoc(text);
      // Only resolve comments whose anchor parses intact (live anchor present).
      const resolvableIds = doc.entries
        .map((e) => e.id)
        .filter((id) => doc.anchors.has(id));
      expect(resolvableIds.length).toBeGreaterThan(0);

      for (const id of resolvableIds) {
        const edits = buildResolveCommentEdits(text, doc, id);
        const out = applyEdits(text, edits);
        const reparsed = parseDoc(out);

        // The resolved id is gone (no entry, no anchor).
        expect(reparsed.entries.some((e) => e.id === id)).toBe(false);
        expect(reparsed.anchors.has(id)).toBe(false);

        // Every OTHER originally-live entry still parses intact.
        for (const other of doc.entries) {
          if (other.id === id) continue;
          const stillThere = reparsed.entries.find((e) => e.id === other.id);
          expect(stillThere, `entry ${other.id} survives resolving ${id}`).toBeDefined();
          expect(stillThere?.quote).toBe(other.quote);
          expect(stillThere?.body).toBe(other.body);
        }

        // No corruption introduced by the edit.
        expect(reparsed.corruption).toEqual([]);
      }
    });
  }
});

describe("round-trip: add inserts a new id with decoded quote/body equal to inputs", () => {
  for (const file of ROUNDTRIP_FIXTURES) {
    it(`${file}: adding a span comment yields the new id intact`, () => {
      const text = readFileSync(resolve(CONFORMANCE, file), "utf8");
      const doc = parseDoc(text);

      // Pick a safe insertion point: just inside the first live span extent if
      // one exists, else at the start of the document body (offset 0). We only
      // need a valid, non-marker offset for the property — placement legality is
      // R4's concern, not the serializer's.
      const placement = pickSpanPlacement(text, doc);
      const quote = "round-trip -- quote\nsecond line";
      const body = "round-trip body with -- and a trailing dash-";
      const c: NewComment = {
        placement,
        author: "tester",
        provenance: "human",
        timestamp: "2026-06-14 12:00 +10:00",
        quote,
        body,
        id: "z3z3z3z3",
      };

      const out = applyEdits(text, buildAddCommentEdits(text, doc, c));
      const reparsed = parseDoc(out);

      // Exactly one review block at EOF (§5.1, §7.2).
      expect(reparsed.reviewCount).toBe(1);
      expect(reparsed.review).not.toBeNull();
      expect(reparsed.review?.atEof).toBe(true);

      // The new id is present with decoded quote/body equal to the raw inputs.
      const entry = reparsed.entries.find((e) => e.id === "z3z3z3z3");
      expect(entry, "new entry parses").toBeDefined();
      expect(entry?.quote).toBe(quote);
      expect(entry?.body).toBe(body);
      expect(entry?.author).toBe("tester");
      expect(entry?.provenance).toBe("human");

      // All originally-live entries still parse intact (append-only, §7.6).
      for (const other of doc.entries) {
        const stillThere = reparsed.entries.find((e) => e.id === other.id);
        expect(stillThere?.body).toBe(other.body);
      }

      // §7 writer invariants: no emitted entry carries a bare `--` or `-->`.
      assertNoBareHyphenPairs(out, reparsed.review!.start, reparsed.review!.end);
    });
  }
});

describe("§7 writer invariants over the corpus", () => {
  for (const file of ROUNDTRIP_FIXTURES) {
    it(`${file}: emitted entries are §6-clean and IDs are valid`, () => {
      const text = readFileSync(resolve(CONFORMANCE, file), "utf8");
      const doc = parseDoc(text);
      const c: NewComment = {
        placement: pickSpanPlacement(text, doc),
        author: "tester",
        provenance: "agent",
        timestamp: "2026-06-14 12:00 +10:00",
        quote: "x--y",
        body: "uses --flag everywhere --",
        id: "y2y2y2y2",
      };
      const out = applyEdits(text, buildAddCommentEdits(text, doc, c));
      const reparsed = parseDoc(out);

      // The new entry exists and its id is valid base32 (§3).
      const entry = reparsed.entries.find((e) => e.id === "y2y2y2y2");
      expect(entry).toBeDefined();
      expect(/^[a-z2-7]{8}$/.test("y2y2y2y2")).toBe(true);

      // No bare `--` survives anywhere inside the review block (§6).
      assertNoBareHyphenPairs(out, reparsed.review!.start, reparsed.review!.end);
      // The block is the last meaningful content (§5.1).
      expect(out.slice(reparsed.review!.end).trim()).toBe("");
    });
  }
});

describe("round-trip: add then resolve the sole comment restores a clean document", () => {
  // Document-integrity guard (§7.2): resolving the last comment must leave no
  // residue. For a document that already ends in a newline (the dominant case —
  // editors default to a final newline), the restoration is byte-exact. The
  // leading-newline strip on block removal is exactly compensated by the block's
  // own trailing newline (which the parser's review.end excludes); this test
  // pins that subtle invariant so a future refactor cannot silently break it.
  const c = (id: string): NewComment => ({
    placement: { kind: "span", range: { start: 0, end: 5 } },
    author: "tester",
    provenance: "human",
    timestamp: "2026-06-14 12:00 +10:00",
    quote: "Hello",
    body: "a note",
    id,
  });

  function addThenResolve(text: string): string {
    const doc = parseDoc(text);
    const added = applyEdits(text, buildAddCommentEdits(text, doc, c("z3z3z3z3")));
    const doc2 = parseDoc(added);
    return applyEdits(added, buildResolveCommentEdits(added, doc2, "z3z3z3z3"));
  }

  it("byte-exact for a single-line document ending in a newline", () => {
    const text = "Hello world.\n";
    expect(addThenResolve(text)).toBe(text);
  });

  it("byte-exact for a multi-paragraph document ending in a newline", () => {
    const text = "Hello world.\n\nSecond para here.\n";
    expect(addThenResolve(text)).toBe(text);
  });

  it("normalizes a document with no trailing newline by adding one (benign, POSIX-clean)", () => {
    const text = "Hello world.";
    expect(addThenResolve(text)).toBe("Hello world.\n");
  });
});

/**
 * Assert that, inside the review-block region, the only `--` sequences are the
 * comment delimiters themselves (`<!--`, `-->`). Any other `--` would be a bare
 * hyphen pair that violates §6.
 */
function assertNoBareHyphenPairs(text: string, start: number, end: number): void {
  const region = text.slice(start, end);
  // Strip the legal delimiters, then assert no `--` remains.
  const stripped = region.replaceAll("<!--", "").replaceAll("-->", "");
  expect(stripped.includes("--"), "no bare -- inside review block").toBe(false);
}

/**
 * Build a span placement whose markers land at a safe offset for the test: just
 * after the first live span opener's extent start, wrapping a single character,
 * or `[0, 1)` when the document has no live span. The serializer does not care
 * about AST-safety (that is R4); it only needs a valid `[start, end)`.
 */
function pickSpanPlacement(text: string, doc: ReturnType<typeof parseDoc>): AnchorPlacement {
  for (const anchor of doc.anchors.values()) {
    if (anchor.kind === "span" && anchor.extentStart !== undefined && anchor.extentEnd !== undefined) {
      const s = anchor.extentStart;
      const e = Math.min(anchor.extentEnd, s + 1);
      if (e > s) return { kind: "span", range: { start: s, end: e } };
    }
  }
  return { kind: "span", range: { start: 0, end: Math.min(1, text.length) } };
}
