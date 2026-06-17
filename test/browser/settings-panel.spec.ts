/**
 * Playwright visual goldens for the in-preview settings panel (UI/UX polish).
 */
import { test, expect } from "@playwright/test";

type Harness = { messages: unknown[]; injectMessage: (msg: unknown) => void };

const TYPOGRAPHY = {
  preset: "github" as const,
  textSize: "medium" as const,
  fontFamily: "sans-serif",
  headingFontFamily: "sans-serif",
  lineHeight: 1.5,
  contentWidth: "full" as const,
};

async function renderWithSettings(
  page: import("@playwright/test").Page,
  theme: "light" | "dark",
): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => {
    const h = (window as Window & { __harness?: Harness }).__harness;
    return h !== undefined && h.messages.length > 0;
  });
  await page.evaluate(
    ({ theme, typography }) => {
      (window as Window & { __harness?: Harness }).__harness!.injectMessage({
        v: 1,
        type: "render",
        html: "<h1>Settings panel test</h1><p>Preview typography and layout controls.</p>",
        theme,
        docName: "settings-test.md",
        comments: [],
        attention: 0,
        typography,
        highlightIntensity: "medium",
      });
    },
    { theme, typography: TYPOGRAPHY },
  );
  await expect(page.locator("body")).toHaveAttribute("data-theme", theme);
}

for (const theme of ["light", "dark"] as const) {
  test(`settings panel golden — ${theme}`, async ({ page }) => {
    await renderWithSettings(page, theme);
    await page.getByRole("button", { name: "Preview settings" }).click();
    await expect(page.locator("#pmk-settings-panel")).toHaveAttribute("data-open");
    await expect(page).toHaveScreenshot(`settings-panel-${theme}.png`, {
      fullPage: true,
      animations: "disabled",
    });
  });
}

test("settings panel posts updateSetting on text size change", async ({ page }) => {
  await renderWithSettings(page, "light");
  await page.getByRole("button", { name: "Preview settings" }).click();
  await page.locator(".pmk-settings-body select").nth(2).selectOption("large");

  const recorded = await page.evaluate(() => {
    const h = (window as Window & { __harness?: Harness }).__harness;
    return h?.messages ?? [];
  });

  const updates = recorded.filter(
    (m) => (m as { type?: string }).type === "updateSetting",
  ) as { type: string; key?: string; value?: string }[];
  const textSizeUpdate = updates.find((m) => m.key === "textSize");
  expect(textSizeUpdate).toBeDefined();
  expect(textSizeUpdate?.value).toBe("large");
});
