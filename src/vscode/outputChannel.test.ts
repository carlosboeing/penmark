import { describe, it, expect, beforeEach } from "vitest";
import * as vscode from "vscode";
import { penmarkOutput, logReconcileCorruption } from "./outputChannel.js";
import type { ReconcileResult } from "../core/comments/reconcile.js";

const seam = vscode as unknown as {
  window: { _outputLines: string[]; _resetMessages: () => void };
};

beforeEach(() => seam.window._resetMessages());

function result(over: Partial<ReconcileResult>): ReconcileResult {
  return {
    comments: [],
    needsAttention: [],
    strayClosers: [],
    reviewBlockMisplaced: false,
    secondReviewBlock: false,
    attentionCount: 0,
    ...over,
  };
}

describe("logReconcileCorruption (§9)", () => {
  it("writes nothing for a clean document", () => {
    expect(logReconcileCorruption("a.md", result({}))).toBe(0);
    expect(seam.window._outputLines).toHaveLength(0);
  });

  it("writes one line for a second review block", () => {
    expect(logReconcileCorruption("a.md", result({ secondReviewBlock: true }))).toBe(1);
    expect(seam.window._outputLines).toHaveLength(1);
    expect(seam.window._outputLines[0]).toContain("a.md");
    expect(seam.window._outputLines[0]).toMatch(/review block/i);
  });

  it("writes one line per corruption signal", () => {
    const n = logReconcileCorruption(
      "doc.md",
      result({ secondReviewBlock: true, reviewBlockMisplaced: true }),
    );
    expect(n).toBe(2);
    expect(seam.window._outputLines).toHaveLength(2);
  });
});

describe("penmarkOutput", () => {
  it("returns a stable (lazily created, reused) channel instance", () => {
    expect(penmarkOutput()).toBe(penmarkOutput());
  });
});
