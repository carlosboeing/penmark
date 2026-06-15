import { test, expect } from "@playwright/test";

// sentinel: harness boots, webview bundle attaches, and a 'ready' postMessage is recorded.
test("harness boots and webview posts ready", async ({ page }) => {
  // Collect postMessage calls recorded by the harness stub before navigation.
  const messages: unknown[] = [];

  await page.goto("/");

  // Wait for the webview script to execute and post the ready message.
  await page.waitForFunction(() => {
    const h = (
      window as Window & {
        __harness?: { messages: unknown[] };
      }
    ).__harness;
    return h !== undefined && h.messages.length > 0;
  });

  const recorded = await page.evaluate(() => {
    const h = (
      window as Window & {
        __harness?: { messages: unknown[] };
      }
    ).__harness;
    return h?.messages ?? [];
  });

  // Capture for assertion clarity
  messages.push(...(recorded as unknown[]));

  expect(messages.length).toBeGreaterThan(0);
  expect(messages[0]).toEqual({ v: 1, type: "ready" });
});
