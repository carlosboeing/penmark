/**
 * T11 — Formatter golden tests (v0.1 acceptance gate).
 *
 * The P0.1 anchor torture-test spike returned a GO verdict: mechanical markdown
 * formatters (prettier defaults, prettier `proseWrap: always`, markdownlint
 * `--fix`) do NOT break `pmk:` anchors — 0 orphans, 0 corruption across the
 * corpus (`docs/1-discovery/2026-06-12-anchor-torture-test-spike.md`). This
 * suite graduates that throwaway check into a permanent CI gate.
 *
 * Any red here is a v0.1 RELEASE BLOCKER. The fix is the spec / the committed
 * golden, never weakening an assertion.
 *
 * Matrix: {prettier defaults, prettier proseWrap:always, markdownlint --fix}
 *         × positive conformance corpus (01–11, 13, 14), run in-memory.
 *
 * Assertions per cell:
 *   (a) all pmk: markers present and well-formed after formatting (malformed === 0,
 *       and the same set of markers the pristine had survives).
 *   (b) no anchor regresses below its pristine baseline state on the ADR 0006
 *       ladder — i.e. formatting introduces zero new orphans/corruption. (File 14
 *       is a deliberately-mutated fixture whose baseline already contains a
 *       degraded-recovered and an orphan anchor; the invariant is "no worse than
 *       pristine", which for 01–10/13 reduces to "all intact".)
 *   (c) review block intact and last in file (for files that have one).
 *   (d) rendered + sanitized output contains no visible `pmk` artifact.
 *   (e) formatted text matches the committed golden byte-for-byte.
 *
 * Negative fixture 12 is NOT run through the matrix; it has its own detection
 * test asserting parseDoc flags the documented malformations.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import type { WindowLike } from "dompurify";
import { createRenderer } from "../../../src/core/render/markdown.js";
import { createSanitizer } from "../../../src/core/render/sanitize.js";
import { stripFrontmatter } from "../../../src/core/render/frontmatter.js";
import { parseDoc, classify, type AnchorState } from "./pmkCheck.js";
import { FORMATTERS } from "./formatters.js";

const CORPUS = resolve(__dirname, "../../../spec/conformance");
const GOLDENS = resolve(__dirname, "__goldens__");

/** Positive corpus: anchored docs whose anchors must not regress under formatting. */
const POSITIVE_CORPUS = [
  "01-plain-prose-spans",
  "02-inline-formatting-spans",
  "03-block-anchors",
  "04-range-pair",
  "05-review-block-escapes",
  "06-hard-wrapped",
  "07-long-lines",
  "08-nested-lists",
  "09-unicode",
  "10-dense-anchors",
  // 11 deliberately violates auto-fixable markdownlint rules near anchors — the
  // key fixture proving anchors "ride along" when markdownlint --fix actually
  // reformats the doc (blank-line/list-style fixes adjacent to markers).
  "11-lint-dirty",
  "13-empty-span",
  "14-degraded-states",
] as const;

const UPDATE = process.env.UPDATE_GOLDENS === "1" || process.env.UPDATE_GOLDENS === "true";

function readCorpus(stem: string): string {
  return readFileSync(resolve(CORPUS, `${stem}.md`), "utf8");
}

/** Byte-for-byte golden compare with an UPDATE_GOLDENS=1 write escape hatch. */
function assertGolden(stem: string, formatterId: string, formatted: string): void {
  const goldenPath = resolve(GOLDENS, `${stem}.${formatterId}.md`);
  if (UPDATE) {
    mkdirSync(GOLDENS, { recursive: true });
    writeFileSync(goldenPath, formatted, "utf8");
    return;
  }
  expect(existsSync(goldenPath), `missing golden ${goldenPath} — run UPDATE_GOLDENS=1`).toBe(true);
  const golden = readFileSync(goldenPath, "utf8");
  expect(formatted).toBe(golden);
}

/** Per-anchor baseline ladder state, keyed by anchor id. */
function baselineStates(pristine: string): Map<string, AnchorState> {
  const states = new Map<string, AnchorState>();
  for (const a of classify(pristine, pristine).anchors) states.set(a.id, a.state);
  return states;
}

let sanitize: (html: string) => string;

beforeAll(() => {
  const { window } = new JSDOM("<!doctype html>");
  const dp = createSanitizer(window as unknown as WindowLike);
  sanitize = (html: string): string => dp.sanitize(html);
});

describe("formatter golden matrix — anchored conformance corpus survives formatting", () => {
  for (const stem of POSITIVE_CORPUS) {
    describe(stem, () => {
      const pristine = readCorpus(stem);
      const pristineParsed = parseDoc(pristine);
      const baseline = baselineStates(pristine);
      const hasReview = pristineParsed.reviewPresent;

      for (const formatter of FORMATTERS) {
        describe(formatter.id, () => {
          let formatted: string;

          beforeAll(async () => {
            formatted = await formatter.run(pristine);
          });

          // (a) markers present and well-formed; same marker set survives.
          it("keeps all pmk markers present and well-formed", () => {
            const after = parseDoc(formatted);
            expect(after.malformed).toEqual([]);
            expect([...after.spanOpens.keys()].sort()).toEqual(
              [...pristineParsed.spanOpens.keys()].sort(),
            );
            expect([...after.spanCloses.keys()].sort()).toEqual(
              [...pristineParsed.spanCloses.keys()].sort(),
            );
            expect([...after.blocks.keys()].sort()).toEqual(
              [...pristineParsed.blocks.keys()].sort(),
            );
            expect([...after.ranges.keys()].sort()).toEqual(
              [...pristineParsed.ranges.keys()].sort(),
            );
            expect([...after.entries.keys()].sort()).toEqual(
              [...pristineParsed.entries.keys()].sort(),
            );
          });

          // (b) zero new orphans/corruption — no anchor regresses below baseline.
          it("introduces no orphans or corruption (no anchor regresses below pristine)", () => {
            const result = classify(pristine, formatted);
            for (const a of result.anchors) {
              const base = baseline.get(a.id);
              expect(
                a.state,
                `anchor ${a.id} (${a.type}) was "${base}" in pristine, became "${a.state}" after ${formatter.id} on ${stem} [flags: ${a.flags.join(",")}]`,
              ).toBe(base);
            }
            // Doc-level: formatting must not invent malformed marker residue.
            expect(result.doc.malformed).toEqual([]);
          });

          // (c) review block intact and last in file (only for files that have one).
          it.runIf(hasReview)("keeps the review block intact and last in file", () => {
            const after = parseDoc(formatted);
            expect(after.reviewPresent).toBe(true);
            expect(after.reviewAtEof).toBe(true);
          });

          // (d) rendered + sanitized output has no visible pmk MARKER artifact.
          // The pmk: markers live in HTML comments, which DOMPurify strips, so no
          // marker token (pmk:s / pmk:b / pmk:r / pmk:c / pmk:review) and no HTML-
          // comment delimiter must surface in the sanitized DOM. (Legitimate prose
          // — e.g. a `data-pmk-offset` mention in fixture 02 — is NOT a marker and
          // is allowed; we therefore match marker grammar, not the bare "pmk".)
          it("renders with no visible pmk marker artifacts", () => {
            const { body } = stripFrontmatter(formatted);
            const html = createRenderer({}).render(body);
            const clean = sanitize(html);
            // No pmk: marker token survives, in any escaped or raw form.
            expect(clean).not.toMatch(/pmk:(s|b|r|c|review)\b/);
            expect(clean).not.toMatch(/\/pmk:(s|review)\b/);
            // No HTML-comment delimiter (escaped or raw) surfaces around a pmk marker.
            expect(clean).not.toMatch(/(?:<|&lt;)!--\s*\/?\s*pmk/i);
          });

          // (e) byte-for-byte golden.
          it("matches the committed golden byte-for-byte", () => {
            assertGolden(stem, formatter.id, formatted);
          });
        });
      }
    });
  }
});

describe("negative fixture 12 — parseDoc detects the documented malformations", () => {
  const stem = "12-negative-malformed";
  const text = readCorpus(stem);
  const parsed = parseDoc(text);

  it("flags pmk: residue that does not parse as a valid token (corruption)", () => {
    // The fixture is wall-to-wall invalid pmk: constructs (bad ID alphabet, wrong
    // length, unknown kind, stray closer, half range, mid-line block, bad review
    // header). None are valid markers, so every pmk: occurrence is residue.
    expect(parsed.malformed.length).toBeGreaterThan(0);
  });

  it("rejects every ID-grammar-invalid construct (no valid opener / range / entry)", () => {
    // Bad ID alphabet (9/8/1/0), wrong length, unknown kind, and bad review
    // headers never parse as tokens — their pmk: text falls into `malformed`
    // residue instead. No valid span opener, range pair, or entry exists.
    expect(parsed.spanOpens.size).toBe(0);
    expect(parsed.entries.size).toBe(0);
    // The lone range opener (valid id d6t4y6km) has no closer → never a pair.
    for (const r of parsed.ranges.values()) {
      expect(r.o !== undefined && r.c !== undefined).toBe(false);
    }
  });

  it("never treats the deliberate stray closer or mid-line block as intact", () => {
    // Two constructs are syntactically valid tokens by design, to exercise the
    // §4/§8 corruption paths rather than the §3 ID check:
    //   - stray closer  <!--/pmk:s mn4p6q2r--> : a closer with no opener
    //   - mid-line block <!--pmk:b a5s4d6fg-->  : a block not on its own line
    expect([...parsed.spanCloses.keys()]).toContain("mn4p6q2r");
    expect(parsed.spanOpens.has("mn4p6q2r")).toBe(false); // no opener → can't pair

    const midLineBlock = parsed.blocks.get("a5s4d6fg");
    expect(midLineBlock).toBeDefined();
    expect(midLineBlock?.ownLine).toBe(false); // not on its own line → corruption

    // And no construct in the fixture forms an intact span pair.
    for (const id of parsed.spanOpens.keys()) {
      expect(parsed.spanCloses.has(id)).toBe(false);
    }
  });

  it("does not require a review block (tolerates a doc with none)", () => {
    // The fixture deliberately carries no review block; a conforming parser must
    // tolerate malformed markers without one. reviewPresent is simply false.
    expect(parsed.reviewPresent).toBe(false);
  });

  it("catches each documented malformation class as residue", () => {
    const blob = parsed.malformed.join("\n");
    // invalid ID alphabet (9 / 8 / 1 / 0), wrong length, stray closer,
    // half range, mid-line block, unknown kind, bad review headers.
    expect(blob).toContain("pmk:s k7m2q9ax"); // 9 not in base32
    expect(blob).toContain("pmk:b f3w8r1zn"); // 8 and 1 excluded
    expect(blob).toContain("pmk:s abcdefghij"); // too long
    expect(blob).toContain("pmk:x q4w7e2rt"); // unknown kind
    expect(blob).toMatch(/pmk:reviewv1/); // malformed review header
  });
});
