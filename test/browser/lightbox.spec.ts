import { test, expect } from "@playwright/test";

type Harness = { messages: unknown[]; injectMessage: (msg: unknown) => void };

const SVG_DATA =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='180'%3E%3Crect width='320' height='180' fill='%230969da'/%3E%3Ctext x='160' y='98' text-anchor='middle' font-family='Arial' font-size='28' fill='white'%3EPenmark%3C/text%3E%3C/svg%3E";

async function renderImageDoc(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => {
    const h = (window as Window & { __harness?: Harness }).__harness;
    return h !== undefined && h.messages.length > 0;
  });
  await page.evaluate((src) => {
    (window as Window & { __harness?: Harness }).__harness!.injectMessage({
      v: 1,
      type: "render",
      html: `<h1>Image review</h1><p><img src="${src}" alt="Penmark blue preview"></p>`,
      theme: "light",
      docName: "image-review.md",
      comments: [],
      attention: 0,
    });
  }, SVG_DATA);
  await expect(page.locator("#penmark-root img")).toBeVisible();
}

test("image lightbox exposes zoom controls and fit reset", async ({ page }) => {
  await renderImageDoc(page);

  await page.locator("#penmark-root img").click();
  const dialog = page.locator("#pmk-image-lightbox");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Zoom in" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Zoom out" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Fit image to view" })).toBeVisible();

  await dialog.getByRole("button", { name: "Zoom in" }).click();
  await expect(dialog.locator("img")).toHaveCSS("transform", /matrix\(1\.2/);

  await dialog.getByRole("button", { name: "Fit image to view" }).click();
  await expect(dialog.locator("img")).toHaveCSS("transform", "none");

  await dialog.getByRole("button", { name: "Close image" }).click();
  await expect(dialog).not.toBeVisible();
});

test("image lightbox golden", async ({ page }) => {
  await renderImageDoc(page);

  await page.locator("#penmark-root img").click();
  await expect(page.locator("#pmk-image-lightbox")).toBeVisible();

  await expect(page).toHaveScreenshot("image-lightbox.png", {
    fullPage: true,
    animations: "disabled",
  });
});
