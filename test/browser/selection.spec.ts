/**
 * Playwright harness test for R10 — selection snap-preview.
 *
 * Renders a paragraph carrying data-pmk-coff, makes a real text selection in a
 * real browser (so getClientRects returns live rects), and asserts the transient
 * .pmk-hl-preview overlay appears over the selection — and clears when the
 * selection collapses. DOM assertions only (no screenshot golden), so it runs on
 * any host without font drift.
 */
import { test, expect } from "@playwright/test";

type Harness = { messages: unknown[]; injectMessage: (msg: unknown) => void };

async function renderDoc(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => {
    const h = (window as Window & { __harness?: Harness }).__harness;
    return h !== undefined && h.messages.length > 0;
  });
  await page.evaluate(() => {
    (window as Window & { __harness?: Harness }).__harness!.injectMessage({
      v: 1,
      type: "render",
      html: '<p data-pmk-offset="0:1" data-pmk-coff="0">The renderer uses markdown-it under the hood.</p>',
      theme: "light",
      docName: "test.md",
    });
  });
  await expect(page.locator("#penmark-root p")).toBeVisible();
}

test("a text selection shows a .pmk-hl-preview overlay, cleared on collapse", async ({ page }) => {
  await renderDoc(page);

  // Select "markdown-it" inside the paragraph (a real Range → real client rects).
  await page.evaluate(() => {
    const text = document.querySelector("#penmark-root p")!.firstChild!;
    const content = text.textContent ?? "";
    const start = content.indexOf("markdown-it");
    const range = document.createRange();
    range.setStart(text, start);
    range.setEnd(text, start + "markdown-it".length);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  });

  // The preview layer gains at least one highlight box over the selection.
  const boxes = page.locator("#penmark-selection-preview .pmk-hl-preview");
  await expect(boxes.first()).toBeVisible();
  expect(await boxes.count()).toBeGreaterThan(0);

  // Collapsing the selection clears the preview.
  await page.evaluate(() => window.getSelection()!.removeAllRanges());
  await expect(page.locator("#penmark-selection-preview .pmk-hl-preview")).toHaveCount(0);
});
