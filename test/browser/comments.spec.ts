/**
 * Playwright flow + visual goldens for R11 — comment highlights, gutter dots,
 * and the resolve popover.
 *
 * Renders a document carrying host-injected highlight markup (<mark class="pmk-hl">
 * span, a [data-pmk-block] table) plus the matching comments, then:
 *   - captures a golden of the highlighted document (gutter dots + tints), and
 *   - opens the popover on the span and captures a golden of the open card,
 * in both themes. A functional check confirms Resolve posts resolveComment.
 *
 * Goldens are environment-bound (Chromium + OS + fonts): generate and verify
 * inside mcr.microsoft.com/playwright:v1.61.1-noble so local and CI render
 * pixel-identically (handover: never regenerate on the macOS host).
 */
import { test, expect } from "@playwright/test";

type Harness = { messages: unknown[]; injectMessage: (msg: unknown) => void };

const DOC_HTML = `
<h1>Checkout Service — High Level Design</h1>
<p data-pmk-offset="2:3">The checkout service uses <mark class="pmk-hl" data-pmk-id="span1234" data-pmk-state="intact">eventual consistency</mark> for the read path. Writes go through the primary store.</p>
<p data-pmk-offset="4:5">Latency budgets per dependency are summarized below.</p>
<table data-pmk-offset="6:9" data-pmk-id="blok1234" data-pmk-state="intact" data-pmk-block="">
<thead><tr><th>Dependency</th><th>p99 budget</th></tr></thead>
<tbody><tr><td>Payment gateway</td><td>800 ms</td></tr>
<tr><td>Inventory svc</td><td>120 ms</td></tr></tbody></table>
`;

const COMMENTS = [
  {
    id: "span1234",
    state: "intact",
    provenance: "human",
    author: "carlos",
    timestamp: "2026-06-11 11:02 +10:00",
    quote: "eventual consistency",
    body: "Why eventual consistency on the read path? Checkout needs read-your-writes.",
    extent: { startLine: 2, startCol: 25, endLine: 2, endCol: 45 },
  },
  {
    id: "blok1234",
    state: "intact",
    provenance: "agent",
    author: "claude-code",
    timestamp: "2026-06-11 11:10 +10:00",
    quote: "Dependency | p99 budget",
    body: "Table is missing the failure-mode column requested in review round 1.",
    extent: { startLine: 6, startCol: 0, endLine: 9, endCol: 0 },
  },
];

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
    ({ html, theme, comments }) => {
      (window as Window & { __harness?: Harness }).__harness!.injectMessage({
        v: 1,
        type: "render",
        html,
        theme,
        docName: "architecture-hld.md",
        comments,
        attention: 0,
      });
    },
    { html: DOC_HTML, theme, comments: COMMENTS },
  );
  await expect(page.locator("body")).toHaveAttribute("data-theme", theme);
  await expect(page.locator("mark.pmk-hl")).toBeVisible();
}

for (const theme of ["light", "dark"] as const) {
  test(`comment highlights golden — ${theme}`, async ({ page }) => {
    await renderDoc(page, theme);

    // Gutter dots are installed on commented blocks.
    expect(await page.locator(".pmk-gutter-dot").count()).toBeGreaterThanOrEqual(2);

    await expect(page).toHaveScreenshot(`comments-highlights-${theme}.png`, {
      fullPage: true,
      animations: "disabled",
    });
  });

  test(`comment popover golden — ${theme}`, async ({ page }) => {
    await renderDoc(page, theme);

    await page.locator("mark.pmk-hl").click();
    const popover = page.locator(".pmk-popover");
    await expect(popover).toBeVisible();
    await expect(popover).toContainText("carlos");
    await expect(popover).toContainText("read-your-writes");

    await expect(page).toHaveScreenshot(`comments-popover-${theme}.png`, {
      fullPage: true,
      animations: "disabled",
    });
  });
}

test("Resolve in the popover posts resolveComment with the comment id", async ({ page }) => {
  await renderDoc(page, "light");

  await page.locator("mark.pmk-hl").click();
  await page.locator(".pmk-popover-actions button.primary").click();

  const posted = await page.evaluate(() => {
    const h = (window as Window & { __harness?: Harness }).__harness!;
    return h.messages;
  });
  expect(posted).toContainEqual({ v: 1, type: "resolveComment", id: "span1234" });
  await expect(page.locator(".pmk-popover")).toHaveCount(0);
});

// --- R14: the add flow ------------------------------------------------------

/**
 * A commentable paragraph carrying data-pmk-coff (base char offset 0) so
 * selectionToSourceRange (R10) maps a selection to a body range, plus the
 * data-pmk-offset the scroll map expects.
 */
const ADD_DOC_HTML = `
<h1>Design notes</h1>
<p data-pmk-offset="2:3" data-pmk-coff="13">The renderer uses markdown-it under the hood for CommonMark compliance.</p>
`;

/** Render the add-flow doc and select "markdown-it" so the Add-comment button appears. */
async function renderAndSelect(
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
        docName: "design-notes.md",
        comments: [],
        attention: 0,
      });
    },
    { html: ADD_DOC_HTML, theme },
  );
  await expect(page.locator("body")).toHaveAttribute("data-theme", theme);
  await expect(page.locator("#penmark-root p")).toBeVisible();

  // Make a real selection (live client rects → preview overlay + Add button).
  await page.evaluate(() => {
    const text = document.querySelector("#penmark-root p")!.firstChild!;
    const content = text.textContent ?? "";
    const start = content.indexOf("markdown-it");
    const range = document.createRange();
    range.setStart(text, start);
    range.setEnd(text, start + "markdown-it".length);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  });
}

test("add flow: select → Add comment → submit posts addComment, host echo shows highlight", async ({
  page,
}) => {
  await renderAndSelect(page, "light");

  // The Add-comment button appears anchored to the selection.
  const addBtn = page.locator(".pmk-add-comment-btn");
  await expect(addBtn).toBeVisible();
  await addBtn.click();

  // The box opens with a focused textarea.
  const box = page.locator(".pmk-commentbox");
  await expect(box).toBeVisible();
  const ta = box.locator("textarea");
  await expect(ta).toBeFocused();

  // Type a body and submit.
  await ta.fill("Should this say CommonMark-it instead?");
  await box.locator("button.primary").click();

  // addComment posted with the selected text as quote and the typed body. The
  // range is body-relative (coff 13 + within-block offset of "markdown-it").
  const posted = await page.evaluate(
    () => (window as Window & { __harness?: Harness }).__harness!.messages,
  );
  const add = posted.find((m) => (m as { type?: string }).type === "addComment") as
    | { range: { start: number; end: number }; quote: string; body: string }
    | undefined;
  expect(add).toBeTruthy();
  expect(add!.quote).toBe("markdown-it");
  expect(add!.body).toBe("Should this say CommonMark-it instead?");
  expect(add!.range.end).toBeGreaterThan(add!.range.start);

  // The box closes after submit.
  await expect(box).toHaveCount(0);

  // Host echoes a render wrapping the quote in a highlight → the mark is visible.
  await page.evaluate(() => {
    (window as Window & { __harness?: Harness }).__harness!.injectMessage({
      v: 1,
      type: "render",
      html: '<h1>Design notes</h1><p data-pmk-offset="2:3" data-pmk-coff="13">The renderer uses <mark class="pmk-hl" data-pmk-id="newcmt01" data-pmk-state="intact">markdown-it</mark> under the hood for CommonMark compliance.</p>',
      theme: "light",
      docName: "design-notes.md",
      comments: [
        {
          id: "newcmt01",
          state: "intact",
          provenance: "human",
          author: "carlos",
          timestamp: "2026-06-14 13:00 +10:00",
          quote: "markdown-it",
          body: "Should this say CommonMark-it instead?",
          extent: { startLine: 2, startCol: 17, endLine: 2, endCol: 28 },
        },
      ],
      attention: 0,
    });
  });
  await expect(page.locator("mark.pmk-hl")).toBeVisible();
  expect(await page.locator(".pmk-gutter-dot").count()).toBeGreaterThanOrEqual(1);
});

test("add flow: empty body does not post and keeps the box open; Cancel discards", async ({
  page,
}) => {
  await renderAndSelect(page, "light");
  await page.locator(".pmk-add-comment-btn").click();

  const box = page.locator(".pmk-commentbox");
  await expect(box).toBeVisible();

  // Submitting an empty (whitespace) body is rejected — no message, box stays.
  await box.locator("textarea").fill("   ");
  await box.locator("button.primary").click();
  await expect(box).toBeVisible();
  let posted = await page.evaluate(
    () => (window as Window & { __harness?: Harness }).__harness!.messages,
  );
  expect(posted.some((m) => (m as { type?: string }).type === "addComment")).toBe(false);

  // Cancel discards and closes.
  await box.locator("button:not(.primary)").click();
  await expect(box).toHaveCount(0);
  posted = await page.evaluate(
    () => (window as Window & { __harness?: Harness }).__harness!.messages,
  );
  expect(posted.some((m) => (m as { type?: string }).type === "addComment")).toBe(false);
});

for (const theme of ["light", "dark"] as const) {
  test(`comment add-box golden — ${theme}`, async ({ page }) => {
    await renderAndSelect(page, theme);
    await page.locator(".pmk-add-comment-btn").click();
    await expect(page.locator(".pmk-commentbox")).toBeVisible();

    await expect(page).toHaveScreenshot(`comments-addbox-${theme}.png`, {
      fullPage: true,
      animations: "disabled",
    });
  });
}

// --- R15: drawer + needs-attention ------------------------------------------

const DRAWER_HTML = `
<h1>Checkout Service — High Level Design</h1>
<p data-pmk-offset="2:3" data-pmk-coff="40">The checkout service uses <mark class="pmk-hl" data-pmk-id="span1234" data-pmk-state="intact">eventual consistency</mark> for the read path.</p>
<p data-pmk-offset="4:5" data-pmk-coff="92">Latency budgets per dependency are summarized below.</p>
<table data-pmk-offset="6:9" data-pmk-id="blok1234" data-pmk-state="intact" data-pmk-block="">
<thead><tr><th>Dependency</th><th>p99 budget</th></tr></thead>
<tbody><tr><td>Payment gateway</td><td>800 ms</td></tr></tbody></table>
`;

const DRAWER_COMMENTS = [
  {
    id: "span1234",
    state: "intact",
    provenance: "human",
    author: "carlos",
    timestamp: "2026-06-11 11:02 +10:00",
    quote: "eventual consistency",
    body: "Why eventual consistency on the read path? Checkout needs read-your-writes.",
    extent: { startLine: 2, startCol: 25, endLine: 2, endCol: 45 },
  },
  {
    id: "blok1234",
    state: "intact",
    provenance: "agent",
    author: "claude-code",
    timestamp: "2026-06-11 11:10 +10:00",
    quote: "Dependency | p99 budget",
    body: "Table is missing the failure-mode column requested in review round 1.",
    extent: { startLine: 6, startCol: 0, endLine: 9, endCol: 0 },
  },
  {
    id: "orph0001",
    state: "orphan",
    provenance: "human",
    author: "carlos",
    timestamp: "2026-06-11 10:48 +10:00",
    quote: "three retries with backoff",
    body: "The anchored text was rewritten by the author. Re-anchor or delete.",
    extent: null,
  },
];

async function renderForDrawer(
  page: import("@playwright/test").Page,
  theme: "light" | "dark",
): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => {
    const h = (window as Window & { __harness?: Harness }).__harness;
    return h !== undefined && h.messages.length > 0;
  });
  await page.evaluate(
    ({ html, theme, comments }) => {
      (window as Window & { __harness?: Harness }).__harness!.injectMessage({
        v: 1,
        type: "render",
        html,
        theme,
        docName: "architecture-hld.md",
        comments,
        attention: 1,
      });
    },
    { html: DRAWER_HTML, theme, comments: DRAWER_COMMENTS },
  );
  await expect(page.locator("body")).toHaveAttribute("data-theme", theme);
}

test("the attention chip opens the drawer at the needs-attention section", async ({ page }) => {
  await renderForDrawer(page, "light");
  const chip = page.locator(".pmk-topbar-chip");
  await expect(chip).toBeVisible();
  await expect(chip).toContainText("1 orphaned");
  await chip.click();
  await expect(page.locator(".pmk-drawer")).toHaveAttribute("aria-hidden", "false");
  await expect(page.locator(".pmk-drawer-attention")).toBeVisible();
  await expect(page.locator(".pmk-drawer-attention")).toContainText("three retries with backoff");
});

test("jump-to in the drawer is named Open and scrolls to highlight", async ({
  page,
}) => {
  await renderForDrawer(page, "light");
  await page.locator(".pmk-topbar-comments").click();
  const openBtn = page
    .locator(".pmk-drawer-section.open .pmk-drawer-card", { hasText: "eventual consistency" })
    .locator(".pmk-drawer-action.jump");
  await expect(openBtn).toHaveText("Open");
  await openBtn.click();
  await expect(page.locator(".pmk-popover")).toBeVisible();
});

test("delete in needs-attention posts resolveComment (resolve = delete)", async ({ page }) => {
  await renderForDrawer(page, "light");
  await page.locator(".pmk-topbar-chip").click();
  await page.locator(".pmk-drawer-attention .pmk-drawer-action.delete").click();
  const posted = await page.evaluate(
    () => (window as Window & { __harness?: Harness }).__harness!.messages,
  );
  expect(posted).toContainEqual({ v: 1, type: "resolveComment", id: "orph0001" });
});

for (const theme of ["light", "dark"] as const) {
  test(`comments drawer golden — ${theme}`, async ({ page }) => {
    await renderForDrawer(page, theme);
    await page.locator(".pmk-topbar-comments").click();
    await expect(page.locator(".pmk-drawer")).toHaveAttribute("aria-hidden", "false");
    await expect(page.locator(".pmk-drawer-attention")).toBeVisible();

    await expect(page).toHaveScreenshot(`comments-drawer-${theme}.png`, {
      fullPage: true,
      animations: "disabled",
    });
  });
}
