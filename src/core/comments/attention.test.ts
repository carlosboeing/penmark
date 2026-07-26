/**
 * Attention accounting for unreadable review data (§8.5, §9).
 *
 * A comment whose entry the parser cannot read is not a comment that renders
 * badly — it is a comment that vanishes. It produces no highlight, no drawer
 * row, and (before this) no attention signal either, so the only evidence the
 * user got was that their review notes were gone. Anything that costs review
 * data must raise the count.
 */

import { describe, it, expect } from "vitest";
import { parseDoc } from "./parser.js";
import { reconcile } from "./reconcile.js";

const BODY =
  "Some prose with a <!--pmk:s z3z3z3z3-->commented phrase<!--/pmk:s z3z3z3z3--> in it.\n";

const wellFormedEntry =
  "<!--pmk:c z3z3z3z3\n" +
  "tester (human) · 2026-07-26 20:39 +10:00\n" +
  "> commented phrase\n" +
  "\n" +
  "the note itself\n" +
  "-->";

function docWith(entry: string): string {
  return `${BODY}\n<!-- pmk:review v1 -->\n${entry}\n<!-- /pmk:review -->\n`;
}

function attention(text: string): number {
  return reconcile(text, parseDoc(text)).attentionCount;
}

describe("attentionCount surfaces unreadable review data", () => {
  it("is zero for a clean document", () => {
    const text = docWith(wellFormedEntry);
    expect(parseDoc(text).entries).toHaveLength(1);
    expect(attention(text)).toBe(0);
  });

  it("counts an entry whose grammar the parser rejects", () => {
    // Meta line missing its provenance tag: the entry cannot be read at all.
    const broken = wellFormedEntry.replace(" (human)", "");
    const text = docWith(broken);

    expect(parseDoc(text).entries, "entry is genuinely lost").toHaveLength(0);
    expect(attention(text), "the loss is reported").toBeGreaterThan(0);
  });

  it("counts a review header the parser cannot recognise", () => {
    const text = docWith(wellFormedEntry).replace(
      "<!-- pmk:review v1 -->",
      "<!-- pmk:review v0 -->",
    );

    expect(parseDoc(text).entries, "whole block is lost").toHaveLength(0);
    expect(attention(text), "the loss is reported").toBeGreaterThan(0);
  });

  it("counts a review block with no closing delimiter", () => {
    const text = docWith(wellFormedEntry).replace("<!-- /pmk:review -->\n", "");
    expect(attention(text)).toBeGreaterThan(0);
  });

  it("does not double-count a stray closer, which already has its own signal", () => {
    // A lone closer is reported once via strayClosers, not again as corruption.
    const text = `Prose with a stray <!--/pmk:s z3z3z3z3--> closer.\n`;
    const result = reconcile(text, parseDoc(text));
    expect(result.strayClosers).toHaveLength(1);
    expect(result.attentionCount).toBe(1);
  });
});
