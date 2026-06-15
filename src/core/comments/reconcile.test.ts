import { describe, it, expect } from "vitest";
import { parseDoc } from "./parser.js";
import { reconcile, type ReconcileResult } from "./reconcile.js";

function run(text: string): ReconcileResult {
  return reconcile(text, parseDoc(text));
}

/** Build a minimal well-formed document body + a single-entry review block. */
function withReview(body: string, entry: string): string {
  return `${body}\n<!-- pmk:review v1 -->\n${entry}\n<!-- /pmk:review -->\n`;
}

function entry(id: string, quote: string, bodyText = "comment body"): string {
  return `<!--pmk:c ${id}\ncarlos (human) · 2026-06-12 09:02 +10:00\n> ${quote}\n\n${bodyText}\n-->`;
}

describe("reconcile — span intact", () => {
  it("opener before closer with content → intact, extent is the text between", () => {
    const text = withReview(
      "The <!--pmk:s aaaaaaaa-->quick brown<!--/pmk:s aaaaaaaa--> fox.",
      entry("aaaaaaaa", "quick brown"),
    );
    const r = run(text);
    const c = r.comments.find((x) => x.entry.id === "aaaaaaaa");
    expect(c?.state).toBe("intact");
    expect(text.slice(c!.extent!.start, c!.extent!.end)).toBe("quick brown");
    expect(c?.flags).toEqual([]);
    expect(r.needsAttention).toHaveLength(0);
    expect(r.attentionCount).toBe(0);
  });
});

describe("reconcile — empty span pair (§8.3 content-removed)", () => {
  it("adjacent markers inline → content-removed with zero-width extent", () => {
    const text = withReview(
      "The phrase <!--pmk:s aaaaaaaa--><!--/pmk:s aaaaaaaa--> is gone.",
      entry("aaaaaaaa", "removed phrase"),
    );
    const r = run(text);
    const c = r.comments.find((x) => x.entry.id === "aaaaaaaa");
    expect(c?.state).toBe("content-removed");
    expect(c?.extent?.start).toBe(c?.extent?.end);
    expect(r.needsAttention.map((x) => x.entry.id)).toContain("aaaaaaaa");
  });

  it("empty pair on its own line → content-removed", () => {
    const text = withReview(
      "Above.\n\n<!--pmk:s bbbbbbbb--><!--/pmk:s bbbbbbbb-->\n\nBelow.",
      entry("bbbbbbbb", "deleted sentence"),
    );
    const c = run(text).comments.find((x) => x.entry.id === "bbbbbbbb");
    expect(c?.state).toBe("content-removed");
  });
});

describe("reconcile — span closer destroyed (§8.2)", () => {
  it("quote still matches → degraded-recovered, nearest match wins", () => {
    const text = withReview(
      "Lead <!--pmk:s aaaaaaaa-->in. The target phrase appears here once.",
      entry("aaaaaaaa", "target phrase"),
    );
    const r = run(text);
    const c = r.comments.find((x) => x.entry.id === "aaaaaaaa");
    expect(c?.state).toBe("degraded-recovered");
    expect(c?.flags).toContain("closer-destroyed");
    expect(text.slice(c!.extent!.start, c!.extent!.end)).toBe("target phrase");
  });

  it("multiple matches → match nearest to the surviving opener (by line distance)", () => {
    // Quote "needle" appears on the opener's line and two lines below; the
    // nearest match (same line, right of the opener) must win.
    const text = withReview(
      "needle far above.\n\nHere <!--pmk:s aaaaaaaa-->is a needle close by.\n\nneedle far below.",
      entry("aaaaaaaa", "needle"),
    );
    const r = run(text);
    const c = r.comments.find((x) => x.entry.id === "aaaaaaaa");
    expect(c?.state).toBe("degraded-recovered");
    // The recovered match is the one on the opener's own line.
    const openerLineStart = text.lastIndexOf("\n", text.indexOf("<!--pmk:s aaaaaaaa-->")) + 1;
    const openerLineEnd = text.indexOf("\n", openerLineStart);
    expect(c!.extent!.start).toBeGreaterThanOrEqual(openerLineStart);
    expect(c!.extent!.start).toBeLessThan(openerLineEnd);
  });

  it("whitespace-normalized matching tolerates reflowed whitespace", () => {
    const text = withReview(
      "Open <!--pmk:s aaaaaaaa-->here. The   token\nverification   path matters.",
      entry("aaaaaaaa", "token verification path"),
    );
    const c = run(text).comments.find((x) => x.entry.id === "aaaaaaaa");
    expect(c?.state).toBe("degraded-recovered");
    expect(text.slice(c!.extent!.start, c!.extent!.end)).toBe("token\nverification   path");
  });

  it("quote no longer matches → orphan, closer-destroyed flagged, no extent", () => {
    const text = withReview(
      "Open <!--pmk:s aaaaaaaa-->here, but the quoted phrase is gone now.",
      entry("aaaaaaaa", "absent wording"),
    );
    const r = run(text);
    const c = r.comments.find((x) => x.entry.id === "aaaaaaaa");
    expect(c?.state).toBe("orphan");
    expect(c?.flags).toContain("closer-destroyed");
    expect(c?.extent).toBeUndefined();
    expect(r.needsAttention.map((x) => x.entry.id)).toContain("aaaaaaaa");
  });

  it("empty advisory quote with destroyed closer → orphan", () => {
    const text = withReview(
      "Open <!--pmk:s aaaaaaaa-->here.",
      "<!--pmk:c aaaaaaaa\ncarlos (human) · 2026-06-12 09:02 +10:00\n\nbody only, no quote\n-->",
    );
    const c = run(text).comments.find((x) => x.entry.id === "aaaaaaaa");
    expect(c?.state).toBe("orphan");
  });
});

describe("reconcile — span opener absent", () => {
  it("opener gone, no closer left → plain orphan", () => {
    const text = withReview("The text has no markers at all.", entry("aaaaaaaa", "missing"));
    const r = run(text);
    const c = r.comments.find((x) => x.entry.id === "aaaaaaaa");
    expect(c?.state).toBe("orphan");
    expect(c?.flags).toEqual([]);
    expect(c?.extent).toBeUndefined();
  });

  it("opener gone but a lone closer remains → orphan + stray-closer flag + strayClosers entry", () => {
    const text = withReview(
      "A lone closer survives <!--/pmk:s aaaaaaaa--> here.",
      entry("aaaaaaaa", "missing"),
    );
    const r = run(text);
    const c = r.comments.find((x) => x.entry.id === "aaaaaaaa");
    expect(c?.state).toBe("orphan");
    expect(c?.flags).toContain("stray-closer");
    expect(r.strayClosers.map((s) => s.id)).toContain("aaaaaaaa");
    const stray = r.strayClosers.find((s) => s.id === "aaaaaaaa");
    expect(text.slice(stray!.index, stray!.index + 4)).toBe("<!--");
  });
});

describe("reconcile — block states (§8.4)", () => {
  it("block marker on its own line → intact", () => {
    const text = withReview(
      "Intro.\n\n<!--pmk:b aaaaaaaa-->\n| a | b |\n|---|---|",
      entry("aaaaaaaa", "table"),
    );
    const c = run(text).comments.find((x) => x.entry.id === "aaaaaaaa");
    expect(c?.state).toBe("intact");
    expect(c?.anchor?.kind).toBe("block");
  });

  it("block marker not alone on its line → orphan + marker-not-own-line flag", () => {
    const text = withReview(
      "Intro text <!--pmk:b aaaaaaaa--> trailing on the same line.",
      entry("aaaaaaaa", "block"),
    );
    const r = run(text);
    const c = r.comments.find((x) => x.entry.id === "aaaaaaaa");
    expect(c?.state).toBe("orphan");
    expect(c?.flags).toContain("marker-not-own-line");
    expect(r.needsAttention.map((x) => x.entry.id)).toContain("aaaaaaaa");
  });

  it("block marker absent → plain orphan", () => {
    const text = withReview("No block marker anywhere here.", entry("aaaaaaaa", "block"));
    const c = run(text).comments.find((x) => x.entry.id === "aaaaaaaa");
    expect(c?.state).toBe("orphan");
    expect(c?.flags).toEqual([]);
  });
});

describe("reconcile — range states (§8.4)", () => {
  it("both sides, o before c → intact", () => {
    const text = withReview(
      "<!--pmk:r aaaaaaaa o-->\nFirst block.\n\nLast block.\n<!--pmk:r aaaaaaaa c-->",
      entry("aaaaaaaa", "the run"),
    );
    const c = run(text).comments.find((x) => x.entry.id === "aaaaaaaa");
    expect(c?.state).toBe("intact");
    expect(c?.anchor?.kind).toBe("range");
  });

  it("only the opener present (half-pair) → orphan + half-pair flag + stray", () => {
    const text = withReview(
      "<!--pmk:r aaaaaaaa o-->\nFirst block only, no closer.",
      entry("aaaaaaaa", "the run"),
    );
    const r = run(text);
    const c = r.comments.find((x) => x.entry.id === "aaaaaaaa");
    expect(c?.state).toBe("orphan");
    expect(c?.flags).toContain("half-pair");
    expect(r.strayClosers.map((s) => s.id)).toContain("aaaaaaaa");
  });

  it("only the closer present (half-pair) → orphan + half-pair flag", () => {
    const text = withReview(
      "Block run.\n<!--pmk:r aaaaaaaa c-->",
      entry("aaaaaaaa", "the run"),
    );
    const c = run(text).comments.find((x) => x.entry.id === "aaaaaaaa");
    expect(c?.state).toBe("orphan");
    expect(c?.flags).toContain("half-pair");
  });

  it("both sides absent → plain orphan", () => {
    const text = withReview("No range markers at all.", entry("aaaaaaaa", "the run"));
    const c = run(text).comments.find((x) => x.entry.id === "aaaaaaaa");
    expect(c?.state).toBe("orphan");
    expect(c?.flags).toEqual([]);
  });
});

describe("reconcile — review-block placement (§5.1, §8.5)", () => {
  it("review block at EOF → not misplaced", () => {
    const text = withReview("Body.", entry("aaaaaaaa", "q"));
    expect(run(text).reviewBlockMisplaced).toBe(false);
  });

  it("content after the closing delimiter → reviewBlockMisplaced", () => {
    const text =
      "Body <!--pmk:s aaaaaaaa-->q<!--/pmk:s aaaaaaaa-->.\n" +
      "<!-- pmk:review v1 -->\n" +
      entry("aaaaaaaa", "q") +
      "\n<!-- /pmk:review -->\n\nTrailing prose after the block.\n";
    const r = run(text);
    expect(r.reviewBlockMisplaced).toBe(true);
    expect(r.attentionCount).toBeGreaterThanOrEqual(1);
  });

  it("second review block → secondReviewBlock surfaced", () => {
    const text =
      "<!-- pmk:review v1 -->\n" +
      entry("aaaaaaaa", "q") +
      "\n<!-- /pmk:review -->\n\nMid body.\n\n" +
      "Body <!--pmk:s aaaaaaaa-->q<!--/pmk:s aaaaaaaa-->.\n" +
      "<!-- pmk:review v1 -->\n" +
      entry("aaaaaaaa", "q") +
      "\n<!-- /pmk:review -->\n";
    const r = run(text);
    expect(r.secondReviewBlock).toBe(true);
    expect(r.attentionCount).toBeGreaterThanOrEqual(1);
  });
});

describe("reconcile — degenerate inputs", () => {
  it("no review block → empty result, nothing needs attention", () => {
    const r = run("Just a plain document with no comments.\n");
    expect(r.comments).toHaveLength(0);
    expect(r.needsAttention).toHaveLength(0);
    expect(r.reviewBlockMisplaced).toBe(false);
    expect(r.secondReviewBlock).toBe(false);
    expect(r.attentionCount).toBe(0);
  });

  it("v2 reply entry is reconciled as a normal v1 entry (parentId ignored)", () => {
    const text = withReview(
      "The <!--pmk:s aaaaaaaa-->quoted<!--/pmk:s aaaaaaaa--> text.",
      "<!--pmk:c bbbbbbbb re aaaaaaaa\ncarlos (human) · 2026-06-12 09:02 +10:00\n> quoted\n\na reply body\n-->",
    );
    const r = run(text);
    // The reply entry has id bbbbbbbb but no anchor of its own → orphan,
    // threaded/reply semantics are NOT applied (v1 ignores parentId).
    const reply = r.comments.find((x) => x.entry.id === "bbbbbbbb");
    expect(reply?.entry.parentId).toBe("aaaaaaaa");
    expect(reply?.state).toBe("orphan");
  });

  it("attentionCount sums needs-attention plus corruption signals", () => {
    // One orphan entry + one stray closer (different id) → 2 attention signals.
    const text = withReview(
      "Stray <!--/pmk:s bbbbbbbb--> closer; commented span is gone.",
      entry("aaaaaaaa", "gone"),
    );
    const r = run(text);
    expect(r.needsAttention).toHaveLength(1); // aaaaaaaa orphan
    expect(r.strayClosers.map((s) => s.id)).toContain("bbbbbbbb");
    expect(r.attentionCount).toBe(r.needsAttention.length + r.strayClosers.length);
  });
});
