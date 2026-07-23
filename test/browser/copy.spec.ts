/**
 * Playwright harness test for T8 — code-copy buttons.
 *
 * Loads the built webview bundle via the static harness, injects a render
 * message containing a code block, clicks the copy button, and asserts the
 * harness recorded a copyCode message whose text equals the fixture code
 * exactly (newlines preserved). Behavioral — no screenshot golden.
 */
import { test, expect } from "@playwright/test";

type HarnessMessage = { v?: number; type: string; text?: string };
type Harness = { messages: HarnessMessage[]; injectMessage: (msg: unknown) => void };

const FIXTURE_CODE = `function add(a, b) {\n  return "${"visually-wrapped-text-".repeat(12)}";\n}`;

test("clicking the copy button records a copyCode payload equal to the code text", async ({
  page,
}) => {
  await page.setViewportSize({ width: 480, height: 700 });
  await page.goto("/");

  // Wait for the webview bundle to post 'ready'.
  await page.waitForFunction(() => {
    const h = (window as Window & { __harness?: Harness }).__harness;
    return h !== undefined && h.messages.length > 0;
  });

  // Inject a render message containing a <pre><code> block.
  await page.evaluate((code) => {
    (window as Window & { __harness?: Harness }).__harness!.injectMessage({
      v: 1,
      type: "render",
      html: `<pre><code>${code}</code></pre>`,
      theme: "light",
      docName: "test.md",
    });
  }, FIXTURE_CODE);

  // The copy button must be installed after the render.
  const btn = page.locator("#penmark-root .pmk-copy-btn");
  await expect(btn).toHaveCount(1);
  await expect(page.locator("#penmark-root pre code")).toHaveCSS("white-space", "pre-wrap");

  // Visual wrapping must not mutate the DOM text or insert newlines into a selection.
  const selectedText = await page.locator("#penmark-root pre code").evaluate((code) => {
    const range = document.createRange();
    range.selectNodeContents(code);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    return selection.toString();
  });
  expect(selectedText).toBe(FIXTURE_CODE);

  // Click it (force — the button is opacity:0 until pre:hover, but present + clickable).
  await btn.click({ force: true });

  // The harness must have recorded a copyCode message with the exact code text.
  const recorded = await page.evaluate(() => {
    const h = (window as Window & { __harness?: Harness }).__harness;
    return h?.messages ?? [];
  });

  const copyMsg = recorded.find((m) => m.type === "copyCode");
  expect(copyMsg).toBeDefined();
  expect(copyMsg!.v).toBe(1);
  expect(copyMsg!.text).toBe(FIXTURE_CODE);
});
