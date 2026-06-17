/**
 * T12 — Layer-1 first-render performance gate (v0.1 exit criteria, design §8).
 *
 * Budget: "first render < 300 ms for a 1k-line doc" — measured here over the
 * full host render pipeline:
 *
 *     stripFrontmatter(source)            (frontmatter.ts)
 *       → createRenderer({highlight}).render(body)   (markdown.ts + hljs)
 *       → sanitize(html)                  (sanitize.ts, via a JSDOM window)
 *
 * This is the host's share of "first render". The layer-3 Playwright spec
 * (test/perf/large-doc.spec.ts) covers the webview paint-complete half of the
 * same budget.
 *
 * Methodology — robust, not flaky:
 *   - one untimed warm-up render (JIT, module init, slugger setup),
 *   - then RUNS timed iterations, asserting on the MEDIAN (immune to a single
 *     GC/scheduler hiccup spiking one sample),
 *   - the budget carries PERF_MULTIPLIER headroom (1.0 local, 1.5 CI).
 *
 * Any red here is a v0.1 RELEASE BLOCKER. The fix is the pipeline, never a
 * loosened budget — see the T12 task brief.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { JSDOM } from "jsdom";
import type { WindowLike } from "dompurify";
import { createRenderer } from "../../src/core/render/markdown.js";
import { createSanitizer } from "../../src/core/render/sanitize.js";
import { stripFrontmatter } from "../../src/core/render/frontmatter.js";
import { highlight } from "../../src/hljs.js";
import { gen1kDoc } from "../fixtures/perf/gen.mjs";

/** 1.0 locally, 1.5 in CI — multiplies every time budget (design §8). */
const PERF_MULTIPLIER = Number(process.env.PERF_MULTIPLIER ?? "1");

/** Design §8: first render < 300 ms for a 1k-line doc. */
const FIRST_RENDER_BUDGET_MS = 300 * PERF_MULTIPLIER;

/** Timed iterations; the assertion is on the median. */
const RUNS = 7;

let sanitize: (html: string) => string;

beforeAll(() => {
  const { window } = new JSDOM("<!doctype html>");
  const dp = createSanitizer(window as unknown as WindowLike);
  sanitize = (html: string): string => dp.sanitize(html);
});

/** Run the full host pipeline once and return the sanitized HTML. */
function renderOnce(source: string): string {
  const { body } = stripFrontmatter(source);
  const html = createRenderer({ highlight }).render(body);
  return sanitize(html);
}

/** Median of a numeric array (sorts a copy). */
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

describe("layer-1 first-render budget — 1k-line doc (design §8)", () => {
  const doc = gen1kDoc();

  it(`renders + sanitizes a 1k-line doc in under ${FIRST_RENDER_BUDGET_MS} ms (median of ${RUNS})`, () => {
    // Warm up (untimed): primes JIT, markdown-it, and hljs on cold CI runners.
    for (let w = 0; w < 3; w++) {
      const warm = renderOnce(doc);
      if (w === 0) expect(warm.length).toBeGreaterThan(0);
    }

    const samples: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const t0 = performance.now();
      renderOnce(doc);
      samples.push(performance.now() - t0);
    }

    const med = median(samples);
    // Surface the number even on a green run.
    console.log(
      `[perf:layer1] first-render 1k median=${med.toFixed(1)}ms ` +
        `min=${Math.min(...samples).toFixed(1)}ms max=${Math.max(...samples).toFixed(1)}ms ` +
        `budget=${FIRST_RENDER_BUDGET_MS}ms (x${PERF_MULTIPLIER})`,
    );

    expect(med).toBeLessThan(FIRST_RENDER_BUDGET_MS);
  });
});
