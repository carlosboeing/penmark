import { expect, test, type Page } from "@playwright/test";

type Harness = { messages: unknown[]; injectMessage: (msg: unknown) => void };

const LONG_CODE = `const adaptiveReviewLayout = "${"responsive-gutter-".repeat(14)}";`;

async function renderLayoutFixture(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => {
    const harness = (window as Window & { __harness?: Harness }).__harness;
    return harness !== undefined && harness.messages.length > 0;
  });
  await page.evaluate((code) => {
    (window as Window & { __harness?: Harness }).__harness!.injectMessage({
      v: 1,
      type: "render",
      html: `<h1>Adaptive review</h1><p>Document content.</p><table><tbody><tr><td>Available width</td></tr></tbody></table><pre><code>${code}</code></pre><p>Final document block.</p>`,
      theme: "light",
      docName: "architecture-review-with-a-deliberately-long-document-name-that-must-truncate.md",
      frontmatter: { title: "Adaptive review", status: "approved" },
    });
  }, LONG_CODE);
  await expect(page.locator("body")).toHaveAttribute("data-pmk-code-wrap", "true");
}

async function loadExportStyles(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = "/dist/media/export.css";
        link.nonce = "harness-test-nonce";
        link.onload = () => resolve();
        link.onerror = () => reject(new Error("export.css failed to load"));
        document.head.appendChild(link);
      }),
  );
}

test("wide layout caps responsive gutters and balances document block space", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await renderLayoutFixture(page);

  const layout = await page.locator("#penmark-root").evaluate((root) => {
    const styles = getComputedStyle(root);
    const first = root.firstElementChild!.getBoundingClientRect();
    const last = root.lastElementChild!.getBoundingClientRect();
    const bounds = root.getBoundingClientRect();
    return {
      inlineStart: styles.paddingInlineStart,
      inlineEnd: styles.paddingInlineEnd,
      blockStart: first.top - bounds.top,
      blockEnd: bounds.bottom - last.bottom,
    };
  });

  expect(layout).toEqual({
    inlineStart: "64px",
    inlineEnd: "64px",
    blockStart: 32,
    blockEnd: 32,
  });
});

for (const viewportWidth of [1280, 640]) {
  test(`frontmatter aligns with document content edges at ${viewportWidth}px`, async ({ page }) => {
    await page.setViewportSize({ width: viewportWidth, height: 900 });
    await renderLayoutFixture(page);

    const edges = await page.evaluate(() => {
      const root = document.getElementById("penmark-root")!;
      const card = document.getElementById("pmk-frontmatter-card")!;
      const rootBounds = root.getBoundingClientRect();
      const cardBounds = card.getBoundingClientRect();
      const styles = getComputedStyle(root);
      return {
        documentLeft: rootBounds.left + parseFloat(styles.paddingInlineStart),
        documentRight: rootBounds.right - parseFloat(styles.paddingInlineEnd),
        frontmatterLeft: cardBounds.left,
        frontmatterRight: cardBounds.right,
      };
    });

    expect(edges.frontmatterLeft).toBe(edges.documentLeft);
    expect(edges.frontmatterRight).toBe(edges.documentRight);
  });
}

test("content-width presets preserve their outer max-width caps and internal gutters", async ({
  page,
}) => {
  await page.setViewportSize({ width: 2000, height: 900 });
  await renderLayoutFixture(page);

  for (const [contentWidth, expectedWidth] of [
    ["comfortable", 860],
    ["wide", 1200],
    ["full", 1600],
  ] as const) {
    await page.evaluate((width) => {
      (window as Window & { __harness?: Harness }).__harness!.injectMessage({
        v: 1,
        type: "setContentWidth",
        contentWidth: width,
      });
    }, contentWidth);

    const geometry = await page.locator("#penmark-root").evaluate((root) => {
      const styles = getComputedStyle(root);
      return {
        outerWidth: root.getBoundingClientRect().width,
        gutterStart: styles.paddingInlineStart,
        gutterEnd: styles.paddingInlineEnd,
      };
    });
    expect(geometry).toEqual({
      outerWidth: expectedWidth,
      gutterStart: "64px",
      gutterEnd: "64px",
    });
  }

  const fullEdges = await page.evaluate(() => {
    const root = document.getElementById("penmark-root")!;
    const card = document.getElementById("pmk-frontmatter-card")!;
    const rootBounds = root.getBoundingClientRect();
    const cardBounds = card.getBoundingClientRect();
    const gutter = parseFloat(getComputedStyle(root).paddingInlineStart);
    return {
      document: [rootBounds.left + gutter, rootBounds.right - gutter],
      frontmatter: [cardBounds.left, cardBounds.right],
    };
  });
  expect(fullEdges.frontmatter).toEqual(fullEdges.document);
});

test("standalone export preserves full-cap frontmatter alignment", async ({ page }) => {
  await page.setViewportSize({ width: 2000, height: 900 });
  await renderLayoutFixture(page);
  await loadExportStyles(page);
  await page.locator("body").evaluate((body) => body.classList.add("pmk-export"));

  const edges = await page.evaluate(() => {
    const root = document.getElementById("penmark-root")!;
    const card = document.getElementById("pmk-frontmatter-card")!;
    const rootBounds = root.getBoundingClientRect();
    const cardBounds = card.getBoundingClientRect();
    const gutter = parseFloat(getComputedStyle(root).paddingInlineStart);
    return {
      document: [rootBounds.left + gutter, rootBounds.right - gutter],
      frontmatter: [cardBounds.left, cardBounds.right],
    };
  });
  expect(edges.frontmatter).toEqual(edges.document);
});

test("narrow layout uses 20px gutters and never overflows the page while wrapping", async ({
  page,
}) => {
  await page.setViewportSize({ width: 640, height: 900 });
  await renderLayoutFixture(page);

  const beforeResizeMessages = await page.evaluate(
    () => (window as Window & { __harness?: Harness }).__harness!.messages.length,
  );
  await page.setViewportSize({ width: 800, height: 900 });
  await page.setViewportSize({ width: 640, height: 900 });

  const layout = await page.locator("#penmark-root").evaluate((root) => {
    const styles = getComputedStyle(root);
    return {
      inlineStart: styles.paddingInlineStart,
      inlineEnd: styles.paddingInlineEnd,
      blockStart: styles.paddingBlockStart,
      blockEnd: styles.paddingBlockEnd,
      rootRight: root.getBoundingClientRect().right,
      viewportWidth: document.documentElement.clientWidth,
      pageScrollWidth: document.documentElement.scrollWidth,
      messageCount: (window as Window & { __harness?: Harness }).__harness!.messages.length,
    };
  });

  expect(layout.inlineStart).toBe("20px");
  expect(layout.inlineEnd).toBe("20px");
  expect(layout.blockStart).toBe("20px");
  expect(layout.blockEnd).toBe("20px");
  expect(layout.rootRight).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.pageScrollWidth).toBe(layout.viewportWidth);
  expect(layout.messageCount).toBe(beforeResizeMessages);
});

test("code wrapping toggles between visual wrapping and code-block-only scrolling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 640, height: 900 });
  await renderLayoutFixture(page);

  const code = page.locator("#penmark-root pre code");
  const pre = page.locator("#penmark-root pre");
  await expect(code).toHaveCSS("white-space", "pre-wrap");
  await expect(code).toHaveCSS("overflow-wrap", "anywhere");
  expect(await pre.evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(
    await pre.evaluate((element) => element.clientWidth),
  );

  await page.evaluate(() => {
    (window as Window & { __harness?: Harness }).__harness!.injectMessage({
      v: 1,
      type: "setCodeBlockWrap",
      codeBlockWrap: false,
    });
  });

  await expect(code).toHaveCSS("white-space", "pre");
  expect(await pre.evaluate((element) => element.scrollWidth)).toBeGreaterThan(
    await pre.evaluate((element) => element.clientWidth),
  );
  const overflow = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    pre: getComputedStyle(document.querySelector("#penmark-root pre")!).overflowX,
  }));
  expect(overflow).toEqual({ page: 0, pre: "auto" });
});

test("compact topbar keeps all task controls visible and non-overlapping at 620px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 620, height: 900 });
  await renderLayoutFixture(page);

  const topbar = page.locator("#penmark-topbar");
  await expect(topbar).toHaveCSS("height", "40px");
  await expect(topbar.locator(":scope > .pmk-topbar-document")).toBeVisible();
  await expect(topbar.locator(":scope > .pmk-topbar-preview")).toBeVisible();
  await expect(topbar.locator(":scope > .pmk-topbar-actions")).toBeVisible();

  const controls = topbar.locator(
    ".pmk-topbar-switcher, .pmk-topbar-settings, .pmk-topbar-export, .pmk-topbar-comments",
  );
  await expect(controls).toHaveCount(4);
  for (let index = 0; index < 4; index += 1) await expect(controls.nth(index)).toBeVisible();
  const optionalLabels = topbar.locator(".pmk-topbar-label");
  for (let index = 0; index < await optionalLabels.count(); index += 1) {
    await expect(optionalLabels.nth(index)).toBeHidden();
  }

  const geometry = await topbar.evaluate((element) => {
    const actions = Array.from(element.querySelectorAll<HTMLElement>(
      ".pmk-topbar-switcher, .pmk-topbar-settings, .pmk-topbar-export, .pmk-topbar-comments",
    )).map((control) => control.getBoundingClientRect());
    const doc = element.querySelector<HTMLElement>(".pmk-topbar-document")!.getBoundingClientRect();
    const docName = element.querySelector<HTMLElement>(".pmk-topbar-docname")!;
    const topbarBounds = element.getBoundingClientRect();
    return {
      topbarLeft: topbarBounds.left,
      topbarRight: topbarBounds.right,
      docRight: doc.right,
      firstControlLeft: actions[0]!.left,
      firstControlContained: actions[0]!.left >= topbarBounds.left,
      lastControlContained: actions.at(-1)!.right <= topbarBounds.right,
      docNameTruncated: docName.scrollWidth > docName.clientWidth,
      docNameOverflow: getComputedStyle(docName).textOverflow,
      orderedWithoutOverlap: actions.every((rect, index) => index === 0 || actions[index - 1]!.right <= rect.left),
      pageScrollWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    };
  });
  expect(geometry.docRight).toBeLessThanOrEqual(geometry.firstControlLeft);
  expect(geometry.firstControlContained).toBe(true);
  expect(geometry.lastControlContained).toBe(true);
  expect(geometry.docNameTruncated).toBe(true);
  expect(geometry.docNameOverflow).toBe("ellipsis");
  expect(geometry.orderedWithoutOverlap).toBe(true);
  expect(geometry.pageScrollWidth).toBe(geometry.viewportWidth);
});

// --- Adaptive review panels: geometry, mutual exclusion, focus, and
//     non-destructive open/close through the existing body-state hooks. ---

async function openCommentsPanel(page: Page): Promise<void> {
  await page.locator(".pmk-topbar-comments").click();
  await expect(page.locator(".pmk-drawer")).toHaveAttribute("aria-hidden", "false");
}

async function openSettingsPanel(page: Page): Promise<void> {
  await page.locator(".pmk-topbar-settings").click();
  await expect(page.locator(".pmk-settings-panel")).toHaveAttribute("aria-hidden", "false");
}

test("settings and comments panels are mutually exclusive and keyboard-focus complete", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await renderLayoutFixture(page);

  await openCommentsPanel(page);
  await expect(page.locator(".pmk-drawer-close")).toBeFocused();

  // Opening Settings closes Comments and moves focus into the Settings Close.
  await openSettingsPanel(page);
  await expect(page.locator(".pmk-drawer")).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator(".pmk-settings-close")).toBeFocused();

  // Opening Comments closes Settings.
  await openCommentsPanel(page);
  await expect(page.locator(".pmk-settings-panel")).toHaveAttribute("aria-hidden", "true");

  // Closing returns focus to the connected invoking topbar control.
  await page.locator(".pmk-drawer-close").click();
  await expect(page.locator(".pmk-topbar-comments")).toBeFocused();
});

test("wide comments panel is 342px and reserves document space while settings overlays", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await renderLayoutFixture(page);

  await openCommentsPanel(page);
  const comments = await page.evaluate(() => ({
    width: document.querySelector(".pmk-drawer")!.getBoundingClientRect().width,
    bodyPad: parseFloat(getComputedStyle(document.body).paddingRight),
  }));
  expect(Math.round(comments.width)).toBe(342);
  expect(comments.bodyPad).toBe(342);

  await openSettingsPanel(page);
  const settings = await page.evaluate(() => ({
    width: document.querySelector(".pmk-settings-panel")!.getBoundingClientRect().width,
    bodyPad: parseFloat(getComputedStyle(document.body).paddingRight),
  }));
  expect(Math.round(settings.width)).toBe(342);
  expect(settings.bodyPad).toBe(0);
});

test("at 900px both panels overlay without reserving document padding", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await renderLayoutFixture(page);

  await openCommentsPanel(page);
  expect(await page.evaluate(() => parseFloat(getComputedStyle(document.body).paddingRight))).toBe(0);

  await openSettingsPanel(page);
  expect(await page.evaluate(() => parseFloat(getComputedStyle(document.body).paddingRight))).toBe(0);
});

test("at 620px the open comments panel spans calc(100vw - 24px)", async ({ page }) => {
  await page.setViewportSize({ width: 620, height: 900 });
  await renderLayoutFixture(page);

  await openCommentsPanel(page);
  const geom = await page.evaluate(() => ({
    width: document.querySelector(".pmk-drawer")!.getBoundingClientRect().width,
    expected: document.documentElement.clientWidth - 24,
  }));
  expect(Math.abs(geom.width - geom.expected)).toBeLessThanOrEqual(1);
});

test("panels use no scrim and preserve the live root without re-rendering", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await renderLayoutFixture(page);

  const baselineMessages = await page.evaluate(() => {
    (window as unknown as { __rootRef?: Element }).__rootRef =
      document.getElementById("penmark-root")!;
    return (window as Window & { __harness?: Harness }).__harness!.messages.length;
  });

  await openCommentsPanel(page);
  await openSettingsPanel(page);
  await page.locator(".pmk-settings-close").click();

  const state = await page.evaluate(() => {
    const root = document.getElementById("penmark-root")!;
    return {
      sameRoot: (window as unknown as { __rootRef?: Element }).__rootRef === root,
      connected: root.isConnected,
      visibleHeight: root.getBoundingClientRect().height,
      display: getComputedStyle(root).display,
      scrimPresent: document.querySelector(".pmk-scrim") !== null,
      openDialogs: document.querySelectorAll("dialog[open]").length,
      scrollLocked:
        getComputedStyle(document.documentElement).overflowY === "hidden" ||
        getComputedStyle(document.body).overflowY === "hidden",
      messages: (window as Window & { __harness?: Harness }).__harness!.messages.length,
    };
  });

  expect(state.sameRoot).toBe(true);
  expect(state.connected).toBe(true);
  expect(state.visibleHeight).toBeGreaterThan(0);
  expect(state.display).not.toBe("none");
  expect(state.scrimPresent).toBe(false);
  expect(state.openDialogs).toBe(0);
  expect(state.scrollLocked).toBe(false);
  expect(state.messages).toBe(baselineMessages);
});

test("reduced motion zeroes Penmark panel and control transitions", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 900 });
  await renderLayoutFixture(page);
  await openSettingsPanel(page);

  const zeroed = await page.evaluate(() => {
    const allZero = (sel: string): boolean => {
      const el = document.querySelector(sel);
      if (!el) return false;
      return getComputedStyle(el)
        .transitionDuration.split(",")
        .every((d) => parseFloat(d) === 0);
    };
    return { panel: allZero(".pmk-settings-panel"), control: allZero(".pmk-topbar-settings") };
  });
  expect(zeroed.panel).toBe(true);
  expect(zeroed.control).toBe(true);
});

// --- Representative regression matrix (Task 3) -------------------------------
// Three environment-bound screenshot states covering the adaptive review
// surface: wide settings, mid-width comments under reduced motion, and narrow
// comments. Content and comments are fully deterministic (fixed timestamps, no
// open caret, frozen animations) so the goldens render pixel-stably. Generate
// and verify ONLY inside mcr.microsoft.com/playwright:v1.61.1-noble (linux/amd64
// — the image CI uses), never on the host, or the fonts will not match. Each
// assertion starts at maxDiffPixelRatio: 0; widen only to the smallest
// reproduced cross-platform tolerance and record the measured reason here.

const REVIEW_DOC_HTML = `
<h1>Adaptive review</h1>
<p data-pmk-offset="2:2">The surface keeps <mark class="pmk-hl" data-pmk-id="span0001" data-pmk-state="intact">a persistent root</mark> so panels never re-render the document.</p>
<p>Reading metadata stays compact beside the document title.</p>
<table data-pmk-offset="6:9" data-pmk-id="blok0001" data-pmk-state="intact" data-pmk-block="">
<thead><tr><th>Surface</th><th>Reserved width</th></tr></thead>
<tbody><tr><td>Comments</td><td>342 px</td></tr>
<tr><td>Settings</td><td>342 px</td></tr></tbody></table>
<pre><code>${LONG_CODE}</code></pre>
<p>Final document block.</p>`;

const REVIEW_COMMENTS = [
  {
    id: "span0001",
    state: "intact",
    provenance: "human",
    author: "carlos",
    timestamp: "2026-07-22 09:00 +10:00",
    quote: "a persistent root",
    body: "Confirm the root node identity survives every panel toggle.",
    extent: { startLine: 2, startCol: 18, endLine: 2, endCol: 35 },
  },
  {
    id: "blok0001",
    state: "intact",
    provenance: "agent",
    author: "claude-code",
    timestamp: "2026-07-22 09:05 +10:00",
    quote: "Surface | Reserved width",
    body: "Both side panels share the 342 px reserved-space rule above 1050 px.",
    extent: { startLine: 6, startCol: 0, endLine: 9, endCol: 0 },
  },
];

async function renderReviewFixture(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => {
    const harness = (window as Window & { __harness?: Harness }).__harness;
    return harness !== undefined && harness.messages.length > 0;
  });
  await page.evaluate(
    ({ html, comments }) => {
      (window as Window & { __harness?: Harness }).__harness!.injectMessage({
        v: 1,
        type: "render",
        html,
        theme: "light",
        docName: "adaptive-review-surface.md",
        frontmatter: { title: "Adaptive review", status: "approved" },
        comments,
        attention: 0,
      });
    },
    { html: REVIEW_DOC_HTML, comments: REVIEW_COMMENTS },
  );
  await expect(page.locator("body")).toHaveAttribute("data-pmk-code-wrap", "true");
  await expect(page.locator("mark.pmk-hl")).toBeVisible();
}

type OpenSurface = "settings" | "comments";

// Shared pre-screenshot invariants: exactly one topbar, at most one open side
// panel (the intended one), a visible non-zero live root, no scrim, the named
// task controls present, the expected document content, and — because wrapping
// is on — no horizontal page scroll region.
async function assertReviewInvariants(page: Page, open: OpenSurface): Promise<void> {
  await expect(page.locator("#penmark-topbar")).toHaveCount(1);
  for (const control of [
    ".pmk-topbar-switcher",
    ".pmk-topbar-settings",
    ".pmk-topbar-export",
    ".pmk-topbar-comments",
  ]) {
    await expect(page.locator(`#penmark-topbar ${control}`)).toBeVisible();
  }
  await expect(page.locator("#penmark-root h1")).toHaveText("Adaptive review");

  const state = await page.evaluate(() => {
    const root = document.getElementById("penmark-root");
    const drawer = document.querySelector(".pmk-drawer");
    const settings = document.querySelector(".pmk-settings-panel");
    const isOpen = (el: Element | null): boolean =>
      el !== null && el.getAttribute("aria-hidden") === "false";
    return {
      rootVisible:
        root !== null &&
        root.getBoundingClientRect().height > 0 &&
        getComputedStyle(root).display !== "none",
      openPanels: [drawer, settings].filter(isOpen).length,
      drawerOpen: isOpen(drawer),
      settingsOpen: isOpen(settings),
      scrim: document.querySelector(".pmk-scrim") !== null,
      pageScrollWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    };
  });

  expect(state.rootVisible).toBe(true);
  expect(state.openPanels).toBeLessThanOrEqual(1);
  expect(state.drawerOpen).toBe(open === "comments");
  expect(state.settingsOpen).toBe(open === "settings");
  expect(state.scrim).toBe(false);
  expect(state.pageScrollWidth).toBe(state.viewportWidth);
}

test("golden: light settings panel at wide width", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await renderReviewFixture(page);
  await openSettingsPanel(page);
  await assertReviewInvariants(page, "settings");
  await expect(page).toHaveScreenshot("adaptive-light-settings-wide.png", {
    maxDiffPixelRatio: 0,
  });
});

test("golden: comments panel under reduced motion at mid width", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 900, height: 700 });
  await renderReviewFixture(page);
  await openCommentsPanel(page);
  await assertReviewInvariants(page, "comments");
  await expect(page).toHaveScreenshot("adaptive-comments-reduced-motion.png", {
    maxDiffPixelRatio: 0,
  });
});

test("golden: comments panel at narrow width", async ({ page }) => {
  await page.setViewportSize({ width: 620, height: 900 });
  await renderReviewFixture(page);
  await openCommentsPanel(page);
  await assertReviewInvariants(page, "comments");
  await expect(page).toHaveScreenshot("adaptive-comments-narrow.png", {
    maxDiffPixelRatio: 0,
  });
});
