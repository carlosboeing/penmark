import { test, expect } from "@playwright/test";

type Harness = { messages: unknown[]; injectMessage: (msg: unknown) => void };

const DOC_HTML = `
<h1>Review plan</h1>
<p data-pmk-offset="2:3">Penmark keeps markdown review comments beside the rendered prose.</p>
<blockquote><p>Use this preview to tune typography and review highlights.</p></blockquote>
`;

async function renderDoc(
  page: import("@playwright/test").Page,
  theme: "light" | "dark",
): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => {
    const h = (window as Window & { __harness?: Harness }).__harness;
    return h !== undefined && h.messages.length > 0;
  });
  await page.evaluate(
    ({ html, theme }) => {
      (window as Window & { __harness?: Harness }).__harness!.injectMessage({
        v: 1,
        type: "render",
        html,
        theme,
        docName: "review-plan.md",
        comments: [],
        attention: 0,
        settings: {
          theme,
          preset: "github",
          textSize: "medium",
          contentWidth: "full",
          highlightIntensity: "medium",
          lineHeight: 0,
        },
      });
    },
    { html: DOC_HTML, theme },
  );
  await expect(page.locator("body")).toHaveAttribute("data-theme", theme);
}

for (const theme of ["light", "dark"] as const) {
  test(`settings panel golden — ${theme}`, async ({ page }) => {
    await renderDoc(page, theme);

    await page.locator(".pmk-topbar-settings").click();
    await expect(page.locator(".pmk-settings-panel")).toHaveAttribute("aria-hidden", "false");
    await expect(page.locator(".pmk-settings-panel")).toContainText("Preview settings");

    await expect(page).toHaveScreenshot(`settings-panel-${theme}.png`, {
      fullPage: true,
      animations: "disabled",
    });
  });
}

test("settings panel posts updates and applies immediate preview feedback", async ({ page }) => {
  await renderDoc(page, "light");
  await page.locator(".pmk-topbar-settings").click();

  await page.locator('[data-pmk-setting="contentWidth"][data-value="comfortable"]').click();
  await page.locator('[data-pmk-setting="comments.highlightIntensity"][data-value="strong"]').click();

  await expect(page.locator("body")).toHaveClass(/pmk-content-comfortable/);
  await expect(page.locator("body")).toHaveClass(/pmk-hl-strong/);

  const posted = await page.evaluate(
    () => (window as Window & { __harness?: Harness }).__harness!.messages,
  );
  expect(posted).toContainEqual({
    v: 1,
    type: "updateSetting",
    key: "contentWidth",
    value: "comfortable",
  });
  expect(posted).toContainEqual({
    v: 1,
    type: "updateSetting",
    key: "comments.highlightIntensity",
    value: "strong",
  });
});

test("open-all settings button is styled, not a raw browser button", async ({ page }) => {
  await renderDoc(page, "light");
  await page.locator(".pmk-topbar-settings").click();

  const button = page.locator(".pmk-settings-open-all");
  await expect(button).toBeVisible();

  const radius = await button.evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
  expect(radius).not.toBe("0px");
});

test("text size changes body text, not only headings", async ({ page }) => {
  await renderDoc(page, "light");
  const paragraph = page.locator("#penmark-root p").first();
  const before = await paragraph.evaluate((el) => getComputedStyle(el).fontSize);

  await page.evaluate(() => {
    (window as Window & { __harness?: Harness }).__harness!.injectMessage({
      v: 1,
      type: "setTypography",
      typography: {
        preset: "github",
        textSize: "x-large",
        fontFamily: "Georgia, serif",
        headingFontFamily: "Georgia, serif",
        lineHeight: 1.5,
        contentWidth: "full",
      },
    });
  });

  const after = await paragraph.evaluate((el) => getComputedStyle(el).fontSize);
  expect(after).not.toBe(before);
  expect(after).toBe("20px");
});

test("document font does not leak into the chrome", async ({ page }) => {
  await renderDoc(page, "light");
  await page.evaluate(() => {
    (window as Window & { __harness?: Harness }).__harness!.injectMessage({
      v: 1,
      type: "setTypography",
      typography: {
        preset: "reading",
        textSize: "large",
        fontFamily: 'Georgia, "Times New Roman", serif',
        headingFontFamily: "system-ui, sans-serif",
        lineHeight: 1.7,
        contentWidth: "comfortable",
      },
    });
  });

  const body = await page
    .locator("#penmark-root p")
    .first()
    .evaluate((el) => getComputedStyle(el).fontFamily);
  const chrome = await page
    .locator("#penmark-topbar")
    .evaluate((el) => getComputedStyle(el).fontFamily);

  expect(body).toContain("Georgia");
  expect(chrome).not.toContain("Georgia");
});
