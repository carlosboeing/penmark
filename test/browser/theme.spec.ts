/**
 * Playwright visual-regression goldens for T6 — GitHub light/dark themes.
 *
 * Renders one representative document (headings, links, inline + block code,
 * list, blockquote, table) into the harness and captures a full-page golden in
 * each theme. These are the design-§7 screenshot regressions: a change to the
 * token CSS or base structure that alters the rendered look will fail here.
 *
 * Goldens are environment-bound (Chromium + OS + fonts). They are generated and
 * verified inside mcr.microsoft.com/playwright:v1.60.0-noble so local runs and
 * the CI browser job render pixel-identically. See .github/workflows/ci.yml.
 */
import { test, expect } from "@playwright/test";

type Harness = { messages: unknown[]; injectMessage: (msg: unknown) => void };

// A compact document that exercises every themed token group.
const SHOWCASE_HTML = `
<h1>Penmark</h1>
<p>A markdown preview with <a href="https://example.com">inline links</a> and
<code>inline code</code> styled from GitHub tokens.</p>
<h2>Lists</h2>
<ul><li>First item</li><li>Second item</li></ul>
<blockquote><p>A blockquote with muted foreground and a left border.</p></blockquote>
<h2>Code</h2>
<pre><code>function greet(name) {
  return "hi " + name;
}</code></pre>
<h2>Table</h2>
<table><thead><tr><th>Theme</th><th>Mode</th></tr></thead>
<tbody><tr><td>light</td><td>override</td></tr>
<tr><td>dark</td><td>override</td></tr>
<tr><td>auto</td><td>follow IDE</td></tr></tbody></table>
`;

async function renderShowcase(
  page: import("@playwright/test").Page,
  theme: "light" | "dark",
): Promise<void> {
  await page.evaluate(
    ({ html, theme }) => {
      (window as Window & { __harness?: Harness }).__harness!.injectMessage({
        v: 1,
        type: "render",
        html,
        theme,
        docName: "showcase.md",
      });
    },
    { html: SHOWCASE_HTML, theme },
  );
}

for (const theme of ["light", "dark"] as const) {
  test(`theme golden — ${theme}`, async ({ page }) => {
    await page.goto("/");

    // Wait for the webview bundle to attach and post 'ready'.
    await page.waitForFunction(() => {
      const h = (window as Window & { __harness?: Harness }).__harness;
      return h !== undefined && h.messages.length > 0;
    });

    await renderShowcase(page, theme);

    // The render handler applies the theme class to <body>; wait for it.
    await expect(page.locator("body")).toHaveAttribute("data-theme", theme);
    await expect(page.locator("#penmark-root")).toContainText("Penmark");
    await expect(page.locator("#penmark-topbar")).toContainText("showcase.md");

    await expect(page).toHaveScreenshot(`theme-${theme}.png`, {
      fullPage: true,
      animations: "disabled",
    });
  });
}
