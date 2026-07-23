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

test("comment navigation and highlights respect reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await renderDoc(page, "light");

  // Comment highlight transitions collapse to zero under reduced motion.
  const highlightZero = await page.evaluate(() => {
    const el = document.querySelector(".pmk-hl");
    return el
      ? getComputedStyle(el)
          .transitionDuration.split(",")
          .every((d) => parseFloat(d) === 0)
      : null;
  });
  expect(highlightZero).toBe(true);

  // Spy on comment-jump scrolling: reduced motion jumps instantly ("auto").
  await page.evaluate(() => {
    (window as unknown as { __scroll: unknown[] }).__scroll = [];
    Element.prototype.scrollIntoView = function (arg?: unknown): void {
      (window as unknown as { __scroll: unknown[] }).__scroll.push(arg);
    };
  });
  await page.locator("body").press("n");
  const reduced = await page.evaluate(
    () => (window as unknown as { __scroll: Array<Record<string, unknown>> }).__scroll.at(-1),
  );
  expect(reduced).toMatchObject({ behavior: "auto" });

  // Normal motion keeps the smooth comment jump.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.locator("body").press("n");
  const normal = await page.evaluate(
    () => (window as unknown as { __scroll: Array<Record<string, unknown>> }).__scroll.at(-1),
  );
  expect(normal).toMatchObject({ behavior: "smooth" });
});

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

test("comment anchors are keyboard complete and restore focus when the popover closes", async ({
  page,
}) => {
  await renderDoc(page, "light");
  const anchor = page.locator("mark.pmk-hl");

  await expect(anchor).toHaveAttribute("role", "button");
  await expect(anchor).toHaveAttribute("aria-label", "Open comment by carlos");
  await anchor.focus();
  await expect(anchor).toBeFocused();
  expect(
    await anchor.evaluate((el) => {
      const style = getComputedStyle(el);
      const probe = document.createElement("span");
      probe.style.color = "var(--pmk-ui-focus)";
      document.body.appendChild(probe);
      const focusColor = getComputedStyle(probe).color;
      probe.remove();
      return {
        usesFocusToken: style.outlineColor === focusColor,
        width: style.outlineWidth,
      };
    }),
  ).toEqual({ usesFocusToken: true, width: "2px" });

  await anchor.press("Space");
  const popover = page.locator(".pmk-popover");
  await expect(popover).toBeVisible();
  await expect(popover.getByRole("button", { name: "Edit" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(popover).toHaveCount(0);
  await expect(anchor).toBeFocused();
});

test("structural, range, and linked highlights retain semantics with native comment actions", async ({
  page,
}) => {
  await renderDoc(page, "light");
  const table = page.locator('table[data-pmk-id="blok1234"]');
  await expect(table).not.toHaveAttribute("role", "button");
  const tableAction = page.locator('[data-pmk-comment-action="blok1234"]');
  await expect(tableAction).toHaveAttribute("aria-label", "Open comment by claude-code");
  await tableAction.focus();
  await expect(table).toHaveClass(/pmk-hl-keyboard-focus/);
  await tableAction.press("Enter");
  await expect(page.locator(".pmk-popover")).toBeVisible();
  await page.keyboard.press("Escape");
  await tableAction.click();
  await expect(page.locator(".pmk-popover")).toBeVisible();
  await page.keyboard.press("Escape");

  const comments = [
    { ...COMMENTS[0], id: "link1234", quote: "linked text" },
    { ...COMMENTS[0], id: "table999", quote: "Structural table" },
    { ...COMMENTS[1], id: "range123", quote: "Range content" },
  ];
  await page.evaluate((comments) => {
    (window as Window & { __harness?: Harness }).__harness!.injectMessage({
      v: 1,
      type: "render",
      html: '<p><mark class="pmk-hl" data-pmk-id="link1234" data-pmk-state="intact"><a href="#target">linked text</a><button type="button">Nested control</button></mark></p><table data-pmk-id="table999" data-pmk-state="intact" data-pmk-block=""><tbody><tr><td>Structural table</td></tr></tbody></table><div class="pmk-hl-range" data-pmk-id="range123" data-pmk-state="intact"><p>Range content</p><p>Second range line</p></div>',
      theme: "light",
      docName: "semantics.md",
      comments,
      attention: 0,
    });
  }, comments);
  const linked = page.locator('mark[data-pmk-id="link1234"]');
  await expect(linked).not.toHaveAttribute("role", "button");
  await expect(linked.getByRole("link", { name: "linked text" })).toBeVisible();
  const nestedControl = linked.getByRole("button", { name: "Nested control" });
  await nestedControl.press("Space");
  await expect(page.locator(".pmk-popover")).toHaveCount(0);
  const range = page.locator('#penmark-root [data-pmk-id="range123"]');
  await expect(range).not.toHaveAttribute("role", "button");
  const structuralGeometry = await page.evaluate(() =>
    ["table999", "range123"].map((id) => {
      const anchor = Array.from(
        document.querySelectorAll<HTMLElement>("#penmark-root [data-pmk-id]"),
      ).find((element) => element.dataset.pmkId === id)!;
      const action = Array.from(
        document.querySelectorAll<HTMLElement>("#penmark-root [data-pmk-comment-action]"),
      ).find((element) => element.dataset.pmkCommentAction === id)!;
      return {
        anchorTop: anchor.getBoundingClientRect().top,
        actionTop: action.getBoundingClientRect().top,
      };
    }),
  );
  expect(
    Math.abs(structuralGeometry[0]!.anchorTop - structuralGeometry[0]!.actionTop),
  ).toBeLessThan(24);
  expect(
    Math.abs(structuralGeometry[1]!.anchorTop - structuralGeometry[1]!.actionTop),
  ).toBeLessThan(24);
  expect(structuralGeometry[1]!.actionTop - structuralGeometry[0]!.actionTop).toBeGreaterThan(20);
  await page.locator('#penmark-root [data-pmk-comment-action="range123"]').press("Space");
  await expect(page.locator(".pmk-popover")).toContainText("failure-mode column");
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

test("add flow: submit preserves intentional body whitespace", async ({ page }) => {
  await renderAndSelect(page, "light");
  await page.locator(".pmk-add-comment-btn").click();

  const body = "  Keep my spacing  \n";
  const box = page.locator(".pmk-commentbox");
  await box.locator("textarea").fill(body);
  await box.locator("button.primary").click();

  const comments = await page.evaluate(() =>
    (window as Window & { __harness?: Harness }).__harness!.messages.filter(
      (message) => (message as { type?: string }).type === "addComment",
    ),
  );
  expect(comments).toEqual([expect.objectContaining({ body })]);
});

test("add flow: empty body does not post and keeps the box open; Cancel discards", async ({
  page,
}) => {
  await renderAndSelect(page, "light");
  const addButton = page.locator(".pmk-add-comment-btn");
  await expect(page.getByRole("button", { name: "Add comment" })).toBeVisible();
  await addButton.click();

  const box = page.locator(".pmk-commentbox");
  await expect(box).toBeVisible();

  // Submitting an empty (whitespace) body is rejected — no message, box stays.
  await box.locator("textarea").fill("   ");
  await box.locator("button.primary").click();
  await expect(box).toBeVisible();
  await expect(box.locator("textarea")).toBeFocused();
  await expect(box.locator("textarea")).toHaveAttribute("aria-invalid", "true");
  await expect(box.getByRole("status")).toHaveText("Enter a comment before submitting.");
  let posted = await page.evaluate(
    () => (window as Window & { __harness?: Harness }).__harness!.messages,
  );
  expect(posted.some((m) => (m as { type?: string }).type === "addComment")).toBe(false);

  // Cancel discards and closes.
  await box.locator("button:not(.primary)").click();
  await expect(box).toHaveCount(0);
  await expect(addButton).toBeFocused();
  posted = await page.evaluate(
    () => (window as Window & { __harness?: Harness }).__harness!.messages,
  );
  expect(posted.some((m) => (m as { type?: string }).type === "addComment")).toBe(false);
});

test("add flow: Escape closes and returns focus to Add comment", async ({ page }) => {
  await renderAndSelect(page, "light");
  const addButton = page.locator(".pmk-add-comment-btn");
  await addButton.click();
  const textarea = page.locator(".pmk-commentbox-input");
  await expect(textarea).toBeFocused();

  await textarea.press("Escape");

  await expect(page.locator(".pmk-commentbox")).toHaveCount(0);
  await expect(addButton).toBeFocused();
});

test("add flow: validation clears only after input becomes non-whitespace", async ({ page }) => {
  await renderAndSelect(page, "light");
  await page.locator(".pmk-add-comment-btn").click();

  const box = page.locator(".pmk-commentbox");
  const ta = box.locator("textarea");
  const status = box.locator(".pmk-commentbox-error");
  await expect(status).toHaveAttribute("role", "status");
  await ta.fill("   ");
  await box.locator("button.primary").click();
  await expect(status).toBeVisible();

  await ta.fill("\t ");
  await expect(ta).toHaveAttribute("aria-invalid", "true");
  await expect(status).toBeVisible();
  await expect(status).toHaveText("Enter a comment before submitting.");

  await ta.fill("ready");
  await expect(ta).not.toHaveAttribute("aria-invalid", "true");
  await expect(ta).not.toHaveAttribute("aria-describedby", /.+/);
  await expect(status).toBeHidden();
  await expect(status).toHaveText("");
});

test("add flow: narrow viewport wraps actions without clipping the shortcut", async ({ page }) => {
  await page.setViewportSize({ width: 260, height: 500 });
  await renderAndSelect(page, "light");
  await page.locator(".pmk-add-comment-btn").click();

  const box = page.locator(".pmk-commentbox");
  const shortcut = box.locator(".pmk-commentbox-shortcut");
  const cancel = box.getByRole("button", { name: "Cancel", exact: true });
  const comment = box.getByRole("button", { name: "Comment", exact: true });
  await expect(shortcut).toBeVisible();
  await expect(cancel).toBeVisible();
  await expect(comment).toBeVisible();

  const [boxRect, shortcutRect, cancelRect, commentRect] = await Promise.all([
    box.boundingBox(),
    shortcut.boundingBox(),
    cancel.boundingBox(),
    comment.boundingBox(),
  ]);
  expect(boxRect).not.toBeNull();
  expect(shortcutRect).not.toBeNull();
  expect(cancelRect).not.toBeNull();
  expect(commentRect).not.toBeNull();
  expect(shortcutRect!.y + shortcutRect!.height).toBeLessThanOrEqual(cancelRect!.y);
  expect(commentRect!.x + commentRect!.width).toBeLessThanOrEqual(
    boxRect!.x + boxRect!.width,
  );
});

for (const shortcut of ["Meta+Enter", "Control+Enter"] as const) {
  test(`add flow: ${shortcut} submits exactly one comment and closes the box`, async ({ page }) => {
    await renderAndSelect(page, "light");
    await page.locator(".pmk-add-comment-btn").click();

    const box = page.locator(".pmk-commentbox");
    const ta = box.locator("textarea");
    await ta.fill("Submitted from the keyboard");
    await ta.press(shortcut);

    await expect(box).toHaveCount(0);
    const comments = await page.evaluate(() =>
      (window as Window & { __harness?: Harness }).__harness!.messages.filter(
        (message) => (message as { type?: string }).type === "addComment",
      ),
    );
    expect(comments).toEqual([
      expect.objectContaining({
        v: 1,
        type: "addComment",
        quote: "markdown-it",
        body: "Submitted from the keyboard",
      }),
    ]);
  });
}

test("add flow: bare Enter remains textarea input", async ({ page }) => {
  await renderAndSelect(page, "light");
  await page.locator(".pmk-add-comment-btn").click();

  const box = page.locator(".pmk-commentbox");
  const ta = box.locator("textarea");
  await ta.fill("first line");
  await ta.press("Enter");
  await ta.type("second line");

  await expect(box).toBeVisible();
  await expect(ta).toHaveValue("first line\nsecond line");
  await expect(box.getByRole("button", { name: "Comment", exact: true })).toBeVisible();
  const posted = await page.evaluate(
    () => (window as Window & { __harness?: Harness }).__harness!.messages,
  );
  expect(posted.some((message) => (message as { type?: string }).type === "addComment")).toBe(
    false,
  );
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
  await expect(page.locator(".pmk-drawer-attention .pmk-drawer-card")).toContainText(
    "Needs attention",
  );
  await expect(page.locator(".pmk-drawer-close")).toBeFocused();
});

test("Escape closes only the topmost comment surface", async ({ page }) => {
  await renderForDrawer(page, "light");
  await page.locator(".pmk-topbar-comments").click();
  const drawer = page.locator(".pmk-drawer");
  await drawer.locator(".pmk-drawer-action.jump").first().click();
  await expect(page.locator(".pmk-popover")).toBeVisible();

  await page.keyboard.press("Escape");

  await expect(page.locator(".pmk-popover")).toHaveCount(0);
  await expect(drawer).toHaveAttribute("aria-hidden", "false");
});

test("topbar panel Close and Escape return focus to replacement controls", async ({ page }) => {
  await renderForDrawer(page, "light");

  const settings = page.locator('[data-pmk-topbar-control="settings"]');
  await settings.click();
  await page.locator(".pmk-settings-close").click();
  await expect(settings).toBeFocused();
  await settings.click();
  await page.keyboard.press("Escape");
  await expect(settings).toBeFocused();

  const comments = page.locator('[data-pmk-topbar-control="comments"]');
  await comments.click();
  await expect(page.locator(".pmk-drawer-close")).toBeFocused();
  await page.locator(".pmk-drawer-close").click();
  await expect(comments).toBeFocused();
  await comments.click();
  await page.keyboard.press("Escape");
  await expect(comments).toBeFocused();
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
