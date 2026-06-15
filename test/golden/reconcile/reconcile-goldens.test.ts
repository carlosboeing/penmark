/**
 * R16 — reconcile golden suite (BLOCKING acceptance gate, design §11).
 *
 * Pins the FULL ReconcileResult for the §8 degradation/desync scenarios as
 * committed JSON goldens, over the trusted conformance corpus. This is stronger
 * than reconcile.conformance.test.ts (which checks individual states/counts):
 * any drift in the recovered extent, the anchor kind, the needs-attention set,
 * or the corruption signals fails the gate. Together with merge-goldens.test.ts
 * this suite is release-blocking for v0.5.0.
 *
 * Regenerate goldens with UPDATE_GOLDENS=1 (then review the diff before commit).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { summarize, matchGolden } from "./summarize.js";

const CONFORMANCE = resolve(__dirname, "../../../spec/conformance");
const SCENARIO_DIR = resolve(__dirname, "scenarios");
const GOLDENS = resolve(__dirname, "__goldens__");

function fixture(name: string): string {
  return readFileSync(resolve(CONFORMANCE, name), "utf8");
}
function scenario(name: string): string {
  return readFileSync(resolve(SCENARIO_DIR, name), "utf8");
}

/** name → conformance fixture, chosen to cover every §8 state + corruption signal. */
const SCENARIOS: Record<string, string> = {
  "intact-spans": "01-plain-prose-spans.md",
  "block-anchors": "03-block-anchors.md",
  "range-pair": "04-range-pair.md",
  "content-removed": "13-empty-span.md",
  "degraded-and-orphan": "14-degraded-states.md",
  "malformed-corruption": "12-negative-malformed.md",
};

describe("reconcile goldens — full ReconcileResult over the §8 corpus", () => {
  for (const [name, file] of Object.entries(SCENARIOS)) {
    it(`${name} (${file}) matches its golden`, () => {
      matchGolden(GOLDENS, name, summarize(fixture(file)));
    });
  }

  it("bad-cut (stray closer + range half-pair, intact neighbor) matches its golden", () => {
    matchGolden(GOLDENS, "bad-cut", summarize(scenario("bad-cut.md")));
  });
});

// Explicit §8-state assertions so the suite documents which states it covers,
// independent of the opaque snapshot.
describe("reconcile goldens — §8 state coverage is exercised", () => {
  it("degraded-recovered: a destroyed closer recovers via advisory quote", () => {
    const s = summarize(fixture("14-degraded-states.md"));
    const c = s.comments.find((x) => x.id === "t4m7k2qx");
    expect(c?.state).toBe("degraded-recovered");
    expect(c?.flags).toContain("closer-destroyed");
    expect(c?.extent?.text).toBe("the token verification path");
  });

  it("orphan: the ladder is exhausted when the quote is gone", () => {
    const s = summarize(fixture("14-degraded-states.md"));
    const c = s.comments.find((x) => x.id === "r5n3p6sw");
    expect(c?.state).toBe("orphan");
    expect(c?.extent).toBeNull();
    expect(s.needsAttention).toContain("r5n3p6sw");
  });

  it("content-removed: an empty span pair keeps a zero-width extent", () => {
    const s = summarize(fixture("13-empty-span.md"));
    const removed = s.comments.filter((c) => c.state === "content-removed");
    expect(removed.length).toBeGreaterThanOrEqual(1);
    for (const c of removed) expect(c.extent?.start).toBe(c.extent?.end);
    expect(s.attentionCount).toBe(s.needsAttention.length);
  });

  it("intact: a clean baseline has no needs-attention and no corruption", () => {
    const s = summarize(fixture("01-plain-prose-spans.md"));
    expect(s.comments.every((c) => c.state === "intact")).toBe(true);
    expect(s.needsAttention).toEqual([]);
    expect(s.secondReviewBlock).toBe(false);
    expect(s.reviewBlockMisplaced).toBe(false);
  });

  it("stray closer / half-pair after a bad cut are flagged; the intact neighbor survives", () => {
    const s = summarize(scenario("bad-cut.md"));
    // The clean span keeps a live highlight.
    expect(s.comments.find((c) => c.id === "aaaaaaaa")?.state).toBe("intact");
    // The lone closer surfaces as a stray closer.
    expect(s.strayClosers.some((x) => x.id === "cccccccc")).toBe(true);
    // The range opener with no closer is an orphan flagged half-pair.
    const half = s.comments.find((c) => c.id === "dddddddd");
    expect(half?.state).toBe("orphan");
    expect(half?.flags).toContain("half-pair");
    expect(s.needsAttention).toEqual(expect.arrayContaining(["cccccccc", "dddddddd"]));
  });
});
