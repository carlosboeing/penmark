/**
 * T12 — Layer-3 performance gate (v0.1 exit criteria, design §8).
 *
 * Runs the real webview bundle in the static harness (Playwright/Chromium) and
 * measures the browser half of the performance budgets:
 *
 *   (1) first render < 300 ms — paint-complete for a 1k-line doc.
 *   (2) 10k-line + 200-anchor doc stays interactive:
 *         (a) initial paint-complete within budget,
 *         (b) no long task > 200 ms during a scripted scroll,
 *         (c) an edit (second render with a small change) morphs in < 500 ms.
 *   (3) re-render keeps scroll position (scrollTop preserved within ±2 px).
 *   (4) re-render causes no diagram flicker — a rendered mermaid svg keeps its
 *       node identity across an unrelated edit (the T9 source-keyed morph skip).
 *
 * All budgets carry PERF_MULTIPLIER headroom (1.0 local, 1.5 CI — see ci.yml).
 * "Paint-complete" is measured as the wall time of the synchronous render
 * handler (sanitize → morphdom into #penmark-root); mermaid is async and not on
 * this path. Any red here is a v0.1 RELEASE BLOCKER — fix the pipeline, not the
 * budget (see the T12 task brief).
 *
 * The fixtures are built in-page from the deterministic generator
 * (test/fixtures/perf/gen.mjs) and rendered to HTML the way the host would, so
 * the webview receives a realistic `render` payload.
 */
import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import MarkdownIt from "markdown-it";

// Read the committed, deterministic fixtures (written by test/fixtures/perf/gen.mjs).
// Playwright's CJS test loader cannot require() the ESM generator directly, and the
// fixtures are byte-stable, so reading the on-disk copies is equivalent and simpler.
const FIXTURES = resolve(__dirname, "../fixtures/perf");
const gen1kDoc = (): string => readFileSync(resolve(FIXTURES, "doc-1k.md"), "utf8");
const gen10kDoc = (): string => readFileSync(resolve(FIXTURES, "doc-10k.md"), "utf8");

type Harness = { messages: { type: string }[]; injectMessage: (msg: unknown) => void };

/** 1.0 locally, 1.5 in CI — multiplies every time budget (design §8). */
const PERF_MULTIPLIER = Number(process.env.PERF_MULTIPLIER ?? "1");
const PAINT_BUDGET_MS = 300 * PERF_MULTIPLIER; // design §8 first-render
const LONGTASK_BUDGET_MS = 200 * PERF_MULTIPLIER; // "stays interactive"
const EDIT_MORPH_BUDGET_MS = 500 * PERF_MULTIPLIER; // edit → morph

// Render markdown to HTML in the test process exactly as the host would (the
// same markdown-it core + html:true). Keeping this minimal (no plugins) is
// fine — the webview only cares about block volume + node identity here, and
// the host-side render cost is gated separately in the layer-1 bench.
const md = new MarkdownIt({ html: true, linkify: true });
function toHtml(src: string): string {
  return md.render(src);
}

async function waitReady(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => {
    const h = (window as Window & { __harness?: Harness }).__harness;
    return h !== undefined && h.messages.length > 0;
  });
}

/**
 * Inject a `render` message and return the synchronous render-handler wall time
 * in ms (paint-complete). The harness dispatches the MessageEvent synchronously
 * and the webview's render handler (sanitize + morphdom) runs to completion
 * before dispatchEvent returns — so wrapping the inject in performance.now()
 * brackets the full paint.
 */
async function injectRenderTimed(
  page: Page,
  html: string,
  theme: "light" | "dark" = "light",
): Promise<number> {
  return page.evaluate(
    ({ html, theme }) => {
      const t0 = performance.now();
      (window as Window & { __harness?: Harness }).__harness!.injectMessage({
        v: 1,
        type: "render",
        html,
        theme,
        docName: "perf.md",
      });
      return performance.now() - t0;
    },
    { html, theme },
  );
}

test("first render: a 1k-line doc paints in under budget", async ({ page }) => {
  await waitReady(page);
  const html = toHtml(gen1kDoc());

  // Warm the bundle with a trivial render first so we measure steady-state paint
  // (module init / first-morphdom costs are not part of "first render" budget).
  await injectRenderTimed(page, "<p>warmup</p>");
  const paint = await injectRenderTimed(page, html);

  console.log(`[perf:layer3] paint-complete 1k=${paint.toFixed(1)}ms budget=${PAINT_BUDGET_MS}ms`);
  await expect(page.locator("#penmark-root")).toContainText("Section 1");
  expect(paint).toBeLessThan(PAINT_BUDGET_MS);
});

test("10k-line + 200-anchor doc: paints, scrolls without long tasks, edits fast", async ({
  page,
}) => {
  await waitReady(page);
  const html = toHtml(gen10kDoc());

  await injectRenderTimed(page, "<p>warmup</p>");

  // (a) initial paint-complete within budget.
  const paint = await injectRenderTimed(page, html);
  await expect(page.locator("#penmark-root")).toContainText("anchored span 0");
  console.log(`[perf:layer3] paint-complete 10k=${paint.toFixed(1)}ms budget=${PAINT_BUDGET_MS}ms`);
  expect(paint).toBeLessThan(PAINT_BUDGET_MS);

  // (b) scripted scroll: observe long tasks (PerformanceObserver longtask) over
  // a sequence of programmatic scrolls down the document. Any task the main
  // thread can't yield from for > LONGTASK_BUDGET_MS makes the UI feel stuck.
  const maxLongTask = await page.evaluate(async () => {
    const se = (document.scrollingElement ?? document.documentElement) as HTMLElement;
    let max = 0;
    const obs = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) max = Math.max(max, e.duration);
    });
    obs.observe({ entryTypes: ["longtask"] });

    // Scroll through the document in steps, yielding a frame between each so the
    // browser does its scroll/paint work (which is what a real drag triggers).
    const maxScroll = se.scrollHeight - se.clientHeight;
    const steps = 20;
    for (let i = 1; i <= steps; i++) {
      se.scrollTop = (maxScroll * i) / steps;
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
    // Let the observer flush any trailing longtask entries.
    await new Promise((r) => setTimeout(r, 100));
    obs.disconnect();
    return max;
  });

  console.log(
    `[perf:layer3] max longtask during scroll=${maxLongTask.toFixed(1)}ms budget=${LONGTASK_BUDGET_MS}ms`,
  );
  expect(maxLongTask).toBeLessThan(LONGTASK_BUDGET_MS);

  // (c) edit → morph: re-render with a one-word change (simulating a debounced
  // re-render after an edit) and time the morphdom reconcile. The whole 10k-line
  // tree is diffed; an edit must settle in < EDIT_MORPH_BUDGET_MS.
  const edited = toHtml(gen10kDoc().replace("anchored span 0", "anchored span ZERO"));
  const morph = await injectRenderTimed(page, edited);
  await expect(page.locator("#penmark-root")).toContainText("anchored span ZERO");
  console.log(
    `[perf:layer3] edit→morph 10k=${morph.toFixed(1)}ms budget=${EDIT_MORPH_BUDGET_MS}ms`,
  );
  expect(morph).toBeLessThan(EDIT_MORPH_BUDGET_MS);
});

test("re-render preserves scroll position within ±2 px", async ({ page }) => {
  await waitReady(page);
  const html = toHtml(gen10kDoc());
  await injectRenderTimed(page, html);

  // Scroll the page to a fixed offset, then re-render with a small unrelated
  // edit. #penmark-root has no overflow of its own, so the scrolling element is
  // the document — the container morphdom must not disturb. We require a real
  // non-zero scroll (the doc is 10k lines, so the content overflows by far).
  const before = await page.evaluate(() => {
    const se = document.scrollingElement ?? document.documentElement;
    se.scrollTop = 4000;
    return se.scrollTop;
  });
  expect(before).toBeGreaterThan(0);

  const edited = toHtml(gen10kDoc().replace("anchored span 5", "anchored span FIVE"));
  await injectRenderTimed(page, edited);

  const after = await page.evaluate(
    () => (document.scrollingElement ?? document.documentElement).scrollTop,
  );
  console.log(`[perf:layer3] scrollTop before=${before} after=${after}`);
  expect(Math.abs(after - before)).toBeLessThanOrEqual(2);
});

test("re-render preserves a rendered mermaid svg node identity (no flicker)", async ({ page }) => {
  await waitReady(page);
  const VALID = "graph TD&#10;  A[Start] --&gt; B[End]";
  const mermaidHtml = `<div class="pmk-mermaid" data-pmk-source="${VALID}"></div>`;

  await injectRenderTimed(page, `<p>before</p>${mermaidHtml}`);
  await expect(page.locator("#penmark-root .pmk-mermaid svg")).toBeVisible({ timeout: 15000 });

  // Tag the rendered svg so we can detect a morphdom replacement.
  await page.evaluate(() => {
    document
      .querySelector("#penmark-root .pmk-mermaid svg")
      ?.setAttribute("data-identity-probe", "kept");
  });

  // Re-render with an unrelated edit; the source-keyed morph skip must keep the
  // svg in place (design §8: "no diagram flicker").
  await injectRenderTimed(page, `<p>after edit</p>${mermaidHtml}`);
  await expect(page.locator("#penmark-root > p").first()).toHaveText("after edit");
  await expect(page.locator("#penmark-root .pmk-mermaid svg")).toHaveAttribute(
    "data-identity-probe",
    "kept",
  );
});
