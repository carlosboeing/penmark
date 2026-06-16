/**
 * Playwright visual goldens for the frontmatter metadata card (UI/UX polish).
 */
import { test, expect } from "@playwright/test";

type Harness = { messages: unknown[]; injectMessage: (msg: unknown) => void };

const FRONTMATTER = {
  title: "Architecture HLD",
  status: "draft",
  author: "carlos",
  tags: ["design", "checkout", "hld"],
  date: "2026-06-17",
};

for (const theme of ["light", "dark"] as const) {
  test(`frontmatter card golden — ${theme}`, async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => {
      const h = (window as Window & { __harness?: Harness }).__harness;
      return h !== undefined && h.messages.length > 0;
    });
    await page.evaluate(
      ({ theme, frontmatter }) => {
        (window as Window & { __harness?: Harness }).__harness!.injectMessage({
          v: 1,
          type: "render",
          html: "<p>Body copy for reading-time estimation. ".repeat(40) + "</p>",
          theme,
          docName: "architecture-hld.md",
          comments: [],
          attention: 0,
          frontmatter,
        });
      },
      { theme, frontmatter: FRONTMATTER },
    );
    await expect(page.locator("#pmk-frontmatter-card")).toBeVisible();
    await expect(page.locator(".pmk-frontmatter-tag")).toHaveCount(3);
    await expect(page).toHaveScreenshot(`frontmatter-card-${theme}.png`, {
      fullPage: true,
      animations: "disabled",
    });
  });
}
