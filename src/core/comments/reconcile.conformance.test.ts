import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { parseDoc } from "./parser.js";
import { reconcile } from "./reconcile.js";
import type { CommentState } from "./types.js";

// src/core/comments is 3 levels under repo root.
const CONFORMANCE = resolve(__dirname, "../../../spec/conformance");

function fixture(name: string): string {
  return readFileSync(resolve(CONFORMANCE, name), "utf8");
}

function run(name: string): ReturnType<typeof reconcile> {
  const text = fixture(name);
  return reconcile(text, parseDoc(text));
}

function stateOf(name: string, id: string): CommentState | undefined {
  return run(name).comments.find((c) => c.entry.id === id)?.state;
}

// Baselines 01–11: every comment is intact (no degradation, no corruption).
const INTACT_BASELINES = [
  "01-plain-prose-spans.md",
  "02-inline-formatting-spans.md",
  "03-block-anchors.md",
  "04-range-pair.md",
  "05-review-block-escapes.md",
  "06-hard-wrapped.md",
  "07-long-lines.md",
  "08-nested-lists.md",
  "09-unicode.md",
  "10-dense-anchors.md",
  "11-lint-dirty.md",
];

describe("reconcile conformance — intact baselines 01–11", () => {
  for (const file of INTACT_BASELINES) {
    it(`${file}: every comment is intact, nothing needs attention`, () => {
      const r = run(file);
      // Every entry is classified, all intact.
      const doc = parseDoc(fixture(file));
      expect(r.comments).toHaveLength(doc.entries.length);
      for (const c of r.comments) {
        expect(c.state).toBe("intact");
        expect(c.flags).toEqual([]);
      }
      expect(r.needsAttention).toHaveLength(0);
      expect(r.strayClosers).toHaveLength(0);
      expect(r.reviewBlockMisplaced).toBe(false);
      expect(r.secondReviewBlock).toBe(false);
      expect(r.attentionCount).toBe(0);
    });
  }
});

describe("reconcile conformance — 13 empty span (content-removed)", () => {
  it("both empty span pairs classify as content-removed", () => {
    expect(stateOf("13-empty-span.md", "s3d2f5gh")).toBe("content-removed");
    expect(stateOf("13-empty-span.md", "w3n6d2pz")).toBe("content-removed");
  });

  it("content-removed comments land in needs-attention and drive the chip", () => {
    const r = run("13-empty-span.md");
    expect(r.needsAttention).toHaveLength(2);
    expect(r.attentionCount).toBe(2);
  });

  it("content-removed keeps a zero-width extent (location is known exactly)", () => {
    const r = run("13-empty-span.md");
    const c = r.comments.find((x) => x.entry.id === "s3d2f5gh");
    expect(c?.extent).toBeDefined();
    expect(c?.extent?.start).toBe(c?.extent?.end);
  });
});

describe("reconcile conformance — 14 degraded states (§8.2 ladder)", () => {
  it("t4m7k2qx recovers via advisory quote match → degraded-recovered", () => {
    const r = run("14-degraded-states.md");
    const c = r.comments.find((x) => x.entry.id === "t4m7k2qx");
    expect(c?.state).toBe("degraded-recovered");
    expect(c?.flags).toContain("closer-destroyed");
    // Extent points at the recovered text in the body.
    const text = fixture("14-degraded-states.md");
    expect(c?.extent).toBeDefined();
    expect(text.slice(c!.extent!.start, c!.extent!.end)).toBe("the token verification path");
  });

  it("r5n3p6sw is unrecoverable (quote gone) → orphan, no extent", () => {
    const r = run("14-degraded-states.md");
    const c = r.comments.find((x) => x.entry.id === "r5n3p6sw");
    expect(c?.state).toBe("orphan");
    expect(c?.flags).toContain("closer-destroyed");
    expect(c?.extent).toBeUndefined();
  });

  it("only the orphan is in needs-attention; degraded-recovered is a live highlight", () => {
    const r = run("14-degraded-states.md");
    expect(r.needsAttention.map((c) => c.entry.id)).toEqual(["r5n3p6sw"]);
  });
});
