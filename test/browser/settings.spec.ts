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

/**
 * Render a document that carries a frontmatter card, at a chosen content width.
 * The body pmk-content-* class is normally set by the shell (html.ts); in the
 * harness the setContentWidth message is the equivalent lever.
 */
async function renderDocWithFrontmatter(
  page: import("@playwright/test").Page,
  contentWidth: "comfortable" | "wide" | "full",
): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => {
    const h = (window as Window & { __harness?: Harness }).__harness;
    return h !== undefined && h.messages.length > 0;
  });
  await page.evaluate(
    ({ html, contentWidth }) => {
      const harness = (window as Window & { __harness?: Harness }).__harness!;
      harness.injectMessage({
        v: 1,
        type: "render",
        html,
        theme: "light",
        docName: "frontmatter.md",
        comments: [],
        attention: 0,
        frontmatter: {
          title: "Bug bash",
          status: "draft",
          authors: ["Carlos Boeing", "claude-opus-5"],
        },
      });
      harness.injectMessage({ v: 1, type: "setContentWidth", contentWidth });
    },
    { html: DOC_HTML, contentWidth },
  );
  await expect(page.locator(".pmk-frontmatter-card")).toBeVisible();
  await expect(page.locator("body")).toHaveClass(new RegExp(`pmk-content-${contentWidth}`));
}

// The viewport must be wide enough for the cap to bind — below 1600px at the
// "full" setting the card's width binds first and the bug is invisible, which
// is why no existing golden catches it.
for (const width of ["comfortable", "wide", "full"] as const) {
  test(`frontmatter card matches the document column at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width: 1900, height: 900 });
    await renderDocWithFrontmatter(page, width);

    const card = await page.locator(".pmk-frontmatter-card").boundingBox();
    const root = await page.locator("#penmark-root p").first().boundingBox();

    expect(Math.abs(card!.x - root!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(card!.width - root!.width)).toBeLessThanOrEqual(1);
  });
}

test("frontmatter card renders block-sequence list values", async ({ page }) => {
  await renderDocWithFrontmatter(page, "full");
  const card = page.locator(".pmk-frontmatter-card");
  await expect(card).toContainText("Carlos Boeing");
  await expect(card).toContainText("claude-opus-5");
});

test("open-all button is withheld when the shell marks the host unsupported", async ({ page }) => {
  // The shell stamps this attribute from the host's product identity, so it is
  // present before the webview boots. The harness serves a generic shell, so it
  // has to be added before the first render builds the settings panel.
  await page.goto("/");
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () =>
      document.body.setAttribute("data-pmk-settings-ui", "false"),
    );
  });
  await page.reload();
  await renderDoc(page, "light");
  await page.locator(".pmk-topbar-settings").click();

  await expect(page.locator(".pmk-settings-panel")).toHaveAttribute("aria-hidden", "false");
  await expect(page.locator(".pmk-settings-open-all")).toHaveCount(0);
});
