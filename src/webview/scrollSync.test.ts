/**
 * Unit tests for scrollSync.ts — the line↔scrollTop mapping math.
 *
 * Runs in the vitest "webview" project (jsdom environment). The math functions
 * are pure (they take synthetic BlockGeometry[]), so these tests feed geometry
 * directly without needing a real layout engine.
 */
import { describe, it, expect } from "vitest";
import {
  lineToScrollTop,
  scrollTopToLine,
  readBlocks,
  type BlockGeometry,
} from "./scrollSync.js";

// A two-block document:
//   block A: source lines [10, 20), laid out at offsetTop 100, height 200
//   block B: source lines [30, 40), laid out at offsetTop 400, height 100
const BLOCKS: BlockGeometry[] = [
  { startLine: 10, endLine: 20, offsetTop: 100, offsetHeight: 200 },
  { startLine: 30, endLine: 40, offsetTop: 400, offsetHeight: 100 },
];

describe("lineToScrollTop", () => {
  it("interpolates a line inside a block", () => {
    // Line 15 is halfway through block A's source span [10,20). Block A spans
    // scrollTop [100, 300) (offsetTop 100, height 200), so halfway ≈ 200.
    expect(lineToScrollTop(15, BLOCKS)).toBeCloseTo(200, 5);
  });

  it("returns a block's top for its start line", () => {
    expect(lineToScrollTop(10, BLOCKS)).toBeCloseTo(100, 5);
    expect(lineToScrollTop(30, BLOCKS)).toBeCloseTo(400, 5);
  });

  it("snaps a line in a gap between blocks to the next block's top", () => {
    // Line 25 falls in the gap between block A (ends at line 20) and block B
    // (starts at line 30) — it snaps to block B's offsetTop (400).
    expect(lineToScrollTop(25, BLOCKS)).toBeCloseTo(400, 5);
  });

  it("clamps below the first block to 0", () => {
    expect(lineToScrollTop(0, BLOCKS)).toBe(0);
    expect(lineToScrollTop(5, BLOCKS)).toBe(0);
  });

  it("clamps above the last block to the last block bottom", () => {
    // Last block bottom = offsetTop 400 + height 100 = 500.
    expect(lineToScrollTop(999, BLOCKS)).toBeCloseTo(500, 5);
  });

  it("returns 0 for empty geometry", () => {
    expect(lineToScrollTop(42, [])).toBe(0);
  });
});

describe("scrollTopToLine", () => {
  it("interpolates a scrollTop inside a block", () => {
    // scrollTop 200 is halfway through block A's [100,300) extent → line ≈ 15.
    expect(scrollTopToLine(200, BLOCKS)).toBeCloseTo(15, 5);
  });

  it("returns a block's start line at its top", () => {
    expect(scrollTopToLine(100, BLOCKS)).toBeCloseTo(10, 5);
    expect(scrollTopToLine(400, BLOCKS)).toBeCloseTo(30, 5);
  });

  it("clamps below the first block to its start line", () => {
    expect(scrollTopToLine(0, BLOCKS)).toBe(10);
    expect(scrollTopToLine(50, BLOCKS)).toBe(10);
  });

  it("clamps above the last block to its end line", () => {
    expect(scrollTopToLine(9999, BLOCKS)).toBe(40);
  });

  it("returns 0 for empty geometry", () => {
    expect(scrollTopToLine(123, [])).toBe(0);
  });
});

describe("round-trip line→scrollTop→line", () => {
  it("is stable within one line for lines inside blocks", () => {
    for (const line of [10, 12, 15, 18, 19, 30, 35, 39]) {
      const st = lineToScrollTop(line, BLOCKS);
      const back = scrollTopToLine(st, BLOCKS);
      expect(Math.abs(back - line)).toBeLessThanOrEqual(1);
    }
  });
});

describe("readBlocks", () => {
  it("extracts geometry from [data-pmk-offset] elements in document order", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<p data-pmk-offset="10:20">A</p>' +
      '<p data-pmk-offset="30:40">B</p>' +
      "<p>no offset</p>";

    // jsdom does not lay out, so offsetTop/offsetHeight are 0 — stub them.
    const els = root.querySelectorAll<HTMLElement>("[data-pmk-offset]");
    Object.defineProperty(els[0], "offsetTop", { value: 100, configurable: true });
    Object.defineProperty(els[0], "offsetHeight", { value: 200, configurable: true });
    Object.defineProperty(els[1], "offsetTop", { value: 400, configurable: true });
    Object.defineProperty(els[1], "offsetHeight", { value: 100, configurable: true });

    const blocks = readBlocks(root);
    expect(blocks).toEqual([
      { startLine: 10, endLine: 20, offsetTop: 100, offsetHeight: 200 },
      { startLine: 30, endLine: 40, offsetTop: 400, offsetHeight: 100 },
    ]);
  });

  it("skips elements with a malformed offset attribute", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<p data-pmk-offset="bad">A</p><p data-pmk-offset="5:9">B</p>';
    const blocks = readBlocks(root);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.startLine).toBe(5);
  });
});
