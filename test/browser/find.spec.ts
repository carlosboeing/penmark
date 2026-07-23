import { test, expect, type Page } from "@playwright/test";

type Harness = { messages: unknown[]; injectMessage: (msg: unknown) => void };

async function renderDoc(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => (window as Window & { __harness?: Harness }).__harness !== undefined);
  await page.evaluate(() => {
    (window as Window & { __harness?: Harness }).__harness!.injectMessage({
      v: 1,
      type: "render",
      html: "<p>Needle one.</p><p>needle two.</p><p>Needle three.</p>",
      theme: "light",
      docName: "find.md",
    });
  });
  await expect(page.locator("#penmark-root")).toContainText("Needle one.");
}

test("topbar Search highlights, cycles, and clears rendered matches", async ({ page }) => {
  await renderDoc(page);

  const search = page.locator(".pmk-topbar-find");
  await search.click();
  const input = page.locator(".pmk-find-input");
  await expect(input).toBeFocused();
  await input.fill("needle");
  await expect(page.locator("mark.pmk-search-hit")).toHaveCount(3);
  await expect(page.locator("mark.pmk-search-hit-current")).toHaveCount(1);

  await input.press("Enter");
  await expect(page.locator(".pmk-find-count")).toHaveText("2 / 3");
  await input.press("Escape");
  await expect(page.locator(".pmk-find-surface")).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator("mark.pmk-search-hit")).toHaveCount(0);
  await expect(search).toBeFocused();
});

test("openFind host message opens the in-preview search surface", async ({ page }) => {
  await renderDoc(page);
  await page.evaluate(() => {
    (window as Window & { __harness?: Harness }).__harness!.injectMessage({ v: 1, type: "openFind" });
  });
  await expect(page.locator(".pmk-find-surface")).toHaveAttribute("aria-hidden", "false");
  await expect(page.locator(".pmk-find-input")).toBeFocused();
});
