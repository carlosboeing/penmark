/**
 * Playwright harness tests for T5 — webview client.
 *
 * Loads the built webview bundle via the static harness, injects host messages
 * via window.__harness.injectMessage(), and asserts on DOM state and postMessage
 * payloads recorded by the harness stub.
 */
import { test, expect } from "@playwright/test";

type HarnessMessage = { v?: number; type: string; href?: string };
type Harness = { messages: HarnessMessage[]; injectMessage: (msg: unknown) => void };

test("injecting a render message populates the penmark-root element", async ({ page }) => {
  await page.goto("/");

  // Wait for the webview bundle to post 'ready'.
  await page.waitForFunction(() => {
    const h = (window as Window & { __harness?: Harness }).__harness;
    return h !== undefined && h.messages.length > 0;
  });

  // Inject a render message.
  await page.evaluate(() => {
    (window as Window & { __harness?: Harness }).__harness!.injectMessage({
      v: 1,
      type: "render",
      html: "<p>Hello from harness</p>",
      theme: "light",
      docName: "test.md",
    });
  });

  // Content must appear in #penmark-root.
  const root = page.locator("#penmark-root");
  await expect(root).toContainText("Hello from harness");
});

test("clicking an external link records an openLink postMessage payload", async ({ page }) => {
  await page.goto("/");

  // Wait for ready.
  await page.waitForFunction(() => {
    const h = (window as Window & { __harness?: Harness }).__harness;
    return h !== undefined && h.messages.length > 0;
  });

  // Inject a render message that includes an external link.
  await page.evaluate(() => {
    (window as Window & { __harness?: Harness }).__harness!.injectMessage({
      v: 1,
      type: "render",
      html: '<p><a href="https://example.com">External</a></p>',
      theme: "light",
      docName: "test.md",
    });
  });

  // Wait for the link to appear.
  const link = page.locator("#penmark-root a");
  await expect(link).toBeVisible();

  // Click the link — the delegated handler should postMessage and prevent navigation.
  await link.click();

  // The harness must have recorded an openLink message.
  const recorded = await page.evaluate(() => {
    const h = (window as Window & { __harness?: Harness }).__harness;
    return h?.messages ?? [];
  });

  const openLinkMsg = recorded.find((m) => m.type === "openLink");
  expect(openLinkMsg).toBeDefined();
  expect(openLinkMsg!.v).toBe(1);
  expect(openLinkMsg!.href).toBe("https://example.com/");
});
