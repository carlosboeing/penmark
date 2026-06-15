/**
 * Shared helpers for the R16 blocking acceptance suites (design §11).
 *
 * `summarize` parses + reconciles a document and projects the full
 * {@link ReconcileResult} into a canonical, human-readable shape: every
 * acceptance-relevant fact (per-comment state/flags/quote, the recovered extent
 * text, anchor kind, the needs-attention set, stray closers, and the corruption
 * signals) with deterministic field order. Offsets are included (deterministic
 * for a fixed input) alongside the sliced extent text so a golden is both a
 * regression pin and a legible record of where each comment anchored.
 *
 * `matchGolden` compares the serialized summary to a committed JSON golden,
 * regenerating it when UPDATE_GOLDENS=1. A missing golden fails loudly.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect } from "vitest";
import { parseDoc } from "../../../src/core/comments/parser.js";
import { reconcile } from "../../../src/core/comments/reconcile.js";

export interface CommentSummary {
  id: string;
  author: string;
  provenance: string;
  timestamp: string;
  quote: string;
  state: string;
  flags: string[];
  anchorKind: string | null;
  extent: { start: number; end: number; text: string } | null;
}

export interface ReconcileSummary {
  comments: CommentSummary[];
  needsAttention: string[];
  strayClosers: { id: string; index: number }[];
  reviewBlockMisplaced: boolean;
  secondReviewBlock: boolean;
  attentionCount: number;
}

/** Parse + reconcile `text` and project the result into a canonical summary. */
export function summarize(text: string): ReconcileSummary {
  const result = reconcile(text, parseDoc(text));
  return {
    comments: result.comments.map((c) => ({
      id: c.entry.id,
      author: c.entry.author,
      provenance: c.entry.provenance,
      timestamp: c.entry.timestamp,
      quote: c.entry.quote,
      state: c.state,
      flags: c.flags,
      anchorKind: c.anchor?.kind ?? null,
      extent: c.extent
        ? { start: c.extent.start, end: c.extent.end, text: text.slice(c.extent.start, c.extent.end) }
        : null,
    })),
    needsAttention: result.needsAttention.map((c) => c.entry.id),
    strayClosers: result.strayClosers,
    reviewBlockMisplaced: result.reviewBlockMisplaced,
    secondReviewBlock: result.secondReviewBlock,
    attentionCount: result.attentionCount,
  };
}

const UPDATE = process.env.UPDATE_GOLDENS === "1";

/** Assert `actual` matches the committed golden `goldenDir/name.json`. */
export function matchGolden(goldenDir: string, name: string, actual: unknown): void {
  const serialized = JSON.stringify(actual, null, 2) + "\n";
  const file = resolve(goldenDir, `${name}.json`);
  if (UPDATE) {
    mkdirSync(goldenDir, { recursive: true });
    writeFileSync(file, serialized);
  }
  const expected = existsSync(file)
    ? readFileSync(file, "utf8")
    : "<<missing golden — run with UPDATE_GOLDENS=1 to generate>>";
  expect(serialized).toBe(expected);
}
