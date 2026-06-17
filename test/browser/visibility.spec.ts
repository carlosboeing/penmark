/**
 * Layout + paint visibility regressions for the preview webview.
 *
 * DOM population alone is insufficient — Antigravity reported "render applied"
 * with 100+ blocks while the pane stayed blank. These tests assert the root has
 * non-zero painted area and readable foreground/background contrast, including
 * when linked theme CSS fails to load (simulates strict webview CSP hosts).
 */
import { test, expect } from "@playwright/test";

type Harness = { messages: unknown[]; injectMessage: (msg: unknown) => void };

const SAMPLE_HTML = `
<h1>Visibility check</h1>
<p>Rendered markdown must be visible in the preview pane, not only present in the DOM.</p>
<ul><li>Alpha</li><li>Beta</li></ul>
`;

async function waitForHarnessReady(page: import("@playwright/test").Page): Promise<void> {
  await page.waitForFunction(() => {
    const h = (window as Window & { __harness?: Harness }).__harness;
    return h !== undefined && h.messages.length > 0;
  });
}

async function injectRender(
  page: import("@playwright/test").Page,
  theme: "light" | "dark" = "light",
): Promise<void> {
  await page.evaluate(
    ({ html, theme }) => {
      (window as Window & { __harness?: Harness }).__harness!.injectMessage({
        v: 1,
        type: "render",
        html,
        theme,
        docName: "visibility.md",
      });
    },
    { html: SAMPLE_HTML, theme },
  );
}

type PaintMetrics = {
  rootHeight: number;
  rootWidth: number;
  childCount: number;
  headingVisible: boolean;
  fgRgb: [number, number, number];
  bgRgb: [number, number, number];
  contrastDelta: number;
};

function parseRgb(color: string): [number, number, number] | null {
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

async function readPaintMetrics(page: import("@playwright/test").Page): Promise<PaintMetrics> {
  return page.evaluate(() => {
    const root = document.getElementById("penmark-root");
    const heading = root?.querySelector("h1");
    if (!root || !heading) {
      return {
        rootHeight: 0,
        rootWidth: 0,
        childCount: 0,
        headingVisible: false,
        fgRgb: [0, 0, 0] as [number, number, number],
        bgRgb: [255, 255, 255] as [number, number, number],
        contrastDelta: 0,
      };
    }

    const rootRect = root.getBoundingClientRect();
    const headingRect = heading.getBoundingClientRect();
    const headingStyle = getComputedStyle(heading);
    const bodyStyle = getComputedStyle(document.body);

    const fg = bodyStyle.color;
    const bg = bodyStyle.backgroundColor;
    const fgMatch = fg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    const bgMatch = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    const fgRgb: [number, number, number] = fgMatch
      ? [Number(fgMatch[1]), Number(fgMatch[2]), Number(fgMatch[3])]
      : [0, 0, 0];
    const bgRgb: [number, number, number] = bgMatch
      ? [Number(bgMatch[1]), Number(bgMatch[2]), Number(bgMatch[3])]
      : [255, 255, 255];
    const contrastDelta =
      Math.abs(fgRgb[0] - bgRgb[0]) + Math.abs(fgRgb[1] - bgRgb[1]) + Math.abs(fgRgb[2] - bgRgb[2]);

    const headingVisible =
      headingRect.width > 0 &&
      headingRect.height > 0 &&
      headingStyle.visibility !== "hidden" &&
      headingStyle.display !== "none" &&
      Number.parseFloat(headingStyle.opacity || "1") > 0.05;

    return {
      rootHeight: rootRect.height,
      rootWidth: rootRect.width,
      childCount: root.childElementCount,
      headingVisible,
      fgRgb,
      bgRgb,
      contrastDelta,
    };
  });
}

test("render strips inline style attributes before DOM insert (no CSP violations)", async ({
  page,
}) => {
  await page.goto("/");
  await waitForHarnessReady(page);

  await page.evaluate(() => {
    (window as Window & { __harness?: Harness }).__harness!.injectMessage({
      v: 1,
      type: "render",
      html: `
        <h1 style="color: white; background: white">Hidden if styles apply</h1>
        <p style="display:none">Also hidden if styles apply</p>
        <p>Visible body copy for the preview smoke test.</p>
      `,
      theme: "light",
      docName: "csp-style.md",
    });
  });

  await expect(page.locator("#penmark-root")).toContainText("Visible body copy");

  const styleAttrCount = await page.evaluate(() => {
    const root = document.getElementById("penmark-root");
    if (!root) return -1;
    return root.querySelectorAll("[style]").length;
  });
  expect(styleAttrCount).toBe(0);
  await expect(page.locator("#penmark-root h1")).toBeVisible();
  await expect(page.locator("#penmark-root h1")).toContainText("Hidden if styles apply");

  const metrics = await readPaintMetrics(page);
  expect(metrics.rootHeight).toBeGreaterThan(40);
  expect(metrics.headingVisible).toBe(true);
  expect(metrics.contrastDelta).toBeGreaterThan(100);
});

test("rendered markdown paints a visible #penmark-root region", async ({ page }) => {
  await page.goto("/");
  await waitForHarnessReady(page);
  await injectRender(page);

  await expect(page.locator("#penmark-root h1")).toContainText("Visibility check");

  const metrics = await readPaintMetrics(page);
  expect(metrics.childCount).toBeGreaterThan(0);
  expect(metrics.rootHeight).toBeGreaterThan(80);
  expect(metrics.rootWidth).toBeGreaterThan(200);
  expect(metrics.headingVisible).toBe(true);
  expect(metrics.contrastDelta).toBeGreaterThan(100);

  await expect(page.locator("#penmark-root h1")).toHaveScreenshot("visibility-heading.png");
});

test("content stays visible when linked theme CSS fails to load", async ({ page }) => {
  await page.route("**/*.css", (route) => route.abort());

  await page.goto("/");
  await waitForHarnessReady(page);
  await injectRender(page, "dark");

  await expect(page.locator("body")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("#penmark-root h1")).toContainText("Visibility check");

  const metrics = await readPaintMetrics(page);
  expect(metrics.rootHeight).toBeGreaterThan(80);
  expect(metrics.headingVisible).toBe(true);
  expect(metrics.contrastDelta).toBeGreaterThan(100);

  const fg = parseRgb(
    await page.evaluate(() => getComputedStyle(document.body).color),
  );
  const bg = parseRgb(
    await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
  );
  expect(fg).not.toBeNull();
  expect(bg).not.toBeNull();
  // Dark shell fallback: light text on dark background.
  expect(fg![0] + fg![1] + fg![2]).toBeGreaterThan(bg![0] + bg![1] + bg![2]);
});
