/**
 * Playwright tests for export fidelity and the export dialog (R17, ADR 0007).
 *
 * The claim under test: an exported document renders IDENTICALLY to the
 * (light) preview. Instead of environment-bound pixel goldens, the spec
 * renders the showcase fixture in the harness webview, drives the REAL export
 * capture message flow, assembles the standalone document with the REAL core
 * builder and shipped CSS, then loads preview and export side by side in the
 * SAME browser and compares computed styles, element geometry, and the
 * mermaid SVG. (Same-browser comparison is environment-independent.)
 *
 * Exports are always light: a dark preview must produce the same light
 * document and be restored to dark afterwards.
 *
 * The PDF test drives the production CDP print path (src/vscode/pdfCdp.ts)
 * with Playwright's own Chromium and validates the resulting PDF; the CLI
 * fallback (src/vscode/pdf.ts) gets its own smoke.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test, expect, chromium, type Page } from "@playwright/test";
import { buildExportHtml, type PageSetup } from "../../src/core/export/htmlDocument.js";
import type { ExportOptions } from "../../src/core/protocol/messages.js";
import { parseFrontmatterFields, stripFrontmatter } from "../../src/core/render/frontmatter.js";
import { createRenderer } from "../../src/core/render/markdown.js";
import { highlight } from "../../src/hljs.js";
import { printHtmlToPdf } from "../../src/vscode/pdf.js";
import { printHtmlToPdfViaCdp } from "../../src/vscode/pdfCdp.js";

type HarnessMessage = { v?: number; type: string; requestId?: string } & Record<string, unknown>;
type Harness = { messages: HarnessMessage[]; injectMessage: (msg: unknown) => void };

// Playwright transpiles specs to CJS, so __dirname is available (and
// import.meta is NOT — see test/perf/large-doc.spec.ts for the same pattern).
const repoRoot = path.resolve(__dirname, "../..");
const artifactsDir = path.join(repoRoot, "test-results", "export-artifacts");

const DIALOG_DEFAULTS: ExportOptions = {
  includeFrontmatter: false,
  includeToc: false,
  width: "full",
  pdfPageSize: "a4",
  pdfMargin: "normal",
  pdfHeaderFooter: true,
};

/** The showcase fixture rendered through the real core pipeline (host-equivalent). */
function renderShowcaseHtml(): { html: string; frontmatter: Record<string, unknown> } {
  const source = fs.readFileSync(path.join(repoRoot, "test/fixtures/export/showcase.md"), "utf8");
  const { body, frontmatter } = stripFrontmatter(source);
  const md = createRenderer({ mermaid: true, highlight });
  return { html: md.render(body), frontmatter: parseFrontmatterFields(frontmatter) };
}

/** The stylesheet set the export command inlines (always light), from dist. */
function exportCss(): string[] {
  return ["theme-light.css", "penmark.css", "export.css"].map((f) =>
    fs.readFileSync(path.join(repoRoot, "dist", "media", f), "utf8"),
  );
}

async function waitReady(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => {
    const h = (window as Window & { __harness?: Harness }).__harness;
    return h !== undefined && h.messages.length > 0;
  });
}

async function injectShowcase(page: Page, theme: "light" | "dark"): Promise<void> {
  const { html, frontmatter } = renderShowcaseHtml();
  await page.evaluate(
    ({ html, theme, frontmatter }) => {
      (window as Window & { __harness?: Harness }).__harness!.injectMessage({
        v: 1,
        type: "render",
        html,
        theme,
        docName: "showcase.md",
        comments: [],
        attention: 0,
        frontmatter,
      });
    },
    { html, theme, frontmatter },
  );
}

/** Render the showcase into the harness webview and wait for the diagram. */
async function renderShowcase(page: Page, theme: "light" | "dark"): Promise<void> {
  await injectShowcase(page, theme);
  // The diagram sits below the fold; the preview renders it lazily on
  // scroll-in (IntersectionObserver), so bring it into view first. The export
  // capture itself must NOT depend on this — renderMermaidAll force-renders —
  // which the "captures below-the-fold diagrams" test proves separately.
  await page.locator("#penmark-root .pmk-mermaid").scrollIntoViewIfNeeded();
  await expect(page.locator("#penmark-root .pmk-mermaid svg")).toBeVisible({ timeout: 15000 });
  await page.evaluate(() => {
    document.getElementById("penmark-root")!.scrollTop = 0;
  });
}

/** Drive the real exportCapture/exportCaptured message round-trip. */
async function captureFromHarness(
  page: Page,
  requestId: string,
  capture: { includeFrontmatter: boolean; includeToc: boolean } = {
    includeFrontmatter: false,
    includeToc: false,
  },
): Promise<HarnessMessage> {
  await page.evaluate(
    ({ requestId, capture }) => {
      (window as Window & { __harness?: Harness }).__harness!.injectMessage({
        v: 1,
        type: "exportCapture",
        requestId,
        includeFrontmatter: capture.includeFrontmatter,
        includeToc: capture.includeToc,
      });
    },
    { requestId, capture },
  );
  const handle = await page.waitForFunction(
    (id) => {
      const h = (window as Window & { __harness?: Harness }).__harness;
      return h?.messages.find((m) => m.type === "exportCaptured" && m.requestId === id) ?? false;
    },
    requestId,
    { timeout: 20000 },
  );
  return (await handle.jsonValue()) as HarnessMessage;
}

/** Build the standalone document exactly as the export command does. */
function buildExportFile(
  captured: HarnessMessage,
  name: string,
  opts: { width?: ExportOptions["width"]; pageSetup?: PageSetup } = {},
): string {
  const html = buildExportHtml({
    title: "showcase.md",
    contentHtml: captured["html"] as string,
    frontmatterHtml: captured["frontmatterHtml"] as string | undefined,
    tocHtml: captured["tocHtml"] as string | undefined,
    width: opts.width ?? "full",
    rootStyle: (captured["rootStyle"] as string) || undefined,
    css: exportCss(),
    pageSetup: opts.pageSetup,
    generator: "Penmark test",
  });
  fs.mkdirSync(artifactsDir, { recursive: true });
  const file = path.join(artifactsDir, `${name}.html`);
  fs.writeFileSync(file, html, "utf8");
  return file;
}

async function openExportedPage(page: Page, file: string): Promise<Page> {
  const exportPage = await page.context().newPage();
  await exportPage.goto(`/test-results/export-artifacts/${path.basename(file)}`);
  return exportPage;
}

/** Computed-style probes compared preview ↔ export. */
const STYLE_PROBES: { selector: string; props: string[] }[] = [
  {
    selector: "body",
    props: ["background-color", "color", "font-family", "font-size", "line-height"],
  },
  {
    selector: "#penmark-root h1",
    props: [
      "font-size",
      "font-family",
      "font-weight",
      "color",
      "border-bottom-color",
      "margin-top",
      "margin-bottom",
      "padding-bottom",
      "line-height",
    ],
  },
  { selector: "#penmark-root h2", props: ["font-size", "font-weight", "color", "margin-top"] },
  {
    selector: "#penmark-root > p",
    props: ["font-size", "font-family", "line-height", "color", "margin-bottom"],
  },
  { selector: "#penmark-root a", props: ["color", "text-decoration-line"] },
  {
    selector: "#penmark-root p code",
    props: ["font-family", "font-size", "background-color", "border-top-color", "color"],
  },
  {
    selector: "#penmark-root pre",
    props: ["background-color", "border-radius", "padding-top", "font-size", "line-height"],
  },
  { selector: "#penmark-root .hljs-keyword", props: ["color"] },
  { selector: "#penmark-root .hljs-string", props: ["color"] },
  {
    selector: "#penmark-root th",
    props: ["background-color", "font-weight", "border-top-color", "padding-left"],
  },
  { selector: "#penmark-root td", props: ["border-top-color", "padding-left", "font-size"] },
  {
    selector: "#penmark-root blockquote",
    props: ["border-left-color", "border-left-width", "background-color", "color"],
  },
  { selector: "#penmark-root li", props: ["font-size", "line-height", "color"] },
  { selector: "#penmark-root hr", props: ["background-color", "height"] },
  { selector: "#penmark-root .footnotes", props: ["color", "border-top-color", "font-size"] },
];

/** Geometry probes: identical layout means identical rendered boxes. */
const GEOMETRY_PROBES = [
  "#penmark-root h1",
  "#penmark-root > p",
  "#penmark-root table",
  "#penmark-root pre",
  "#penmark-root blockquote",
  "#penmark-root .pmk-mermaid svg",
];

async function collectStyles(page: Page): Promise<Record<string, Record<string, string> | null>> {
  return page.evaluate((probes) => {
    const out: Record<string, Record<string, string> | null> = {};
    for (const probe of probes) {
      const el = document.querySelector(probe.selector);
      if (!el) {
        out[probe.selector] = null;
        continue;
      }
      const cs = getComputedStyle(el);
      const values: Record<string, string> = {};
      for (const prop of probe.props) values[prop] = cs.getPropertyValue(prop);
      out[probe.selector] = values;
    }
    return out;
  }, STYLE_PROBES);
}

async function collectGeometry(
  page: Page,
): Promise<Record<string, { w: number; h: number } | null>> {
  return page.evaluate((selectors) => {
    const out: Record<string, { w: number; h: number } | null> = {};
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      out[sel] = el
        ? {
            w: Math.round(el.getBoundingClientRect().width),
            h: Math.round(el.getBoundingClientRect().height),
          }
        : null;
    }
    return out;
  }, GEOMETRY_PROBES);
}

test("export matches the light preview (styles, geometry, mermaid)", async ({ page }) => {
  await waitReady(page);
  await renderShowcase(page, "light");

  const captured = await captureFromHarness(page, "fidelity-light");
  expect(captured["ok"]).toBe(true);
  const file = buildExportFile(captured, "export-light");

  const exportPage = await openExportedPage(page, file);
  await expect(exportPage.locator("#penmark-root .pmk-mermaid svg")).toBeVisible();

  // 1. Every probed element exists in both and computes IDENTICAL styles.
  const previewStyles = await collectStyles(page);
  const exportStyles = await collectStyles(exportPage);
  for (const probe of STYLE_PROBES) {
    expect(previewStyles[probe.selector], `${probe.selector} missing in preview`).not.toBeNull();
    expect
      .soft(exportStyles[probe.selector], `${probe.selector} styles`)
      .toEqual(previewStyles[probe.selector]);
  }

  // 2. Identical layout: rendered box sizes match within a pixel.
  const previewGeo = await collectGeometry(page);
  const exportGeo = await collectGeometry(exportPage);
  for (const sel of GEOMETRY_PROBES) {
    expect(previewGeo[sel], `${sel} missing in preview`).not.toBeNull();
    expect(exportGeo[sel], `${sel} missing in export`).not.toBeNull();
    expect(Math.abs(exportGeo[sel]!.w - previewGeo[sel]!.w), `${sel} width`).toBeLessThanOrEqual(1);
    expect(Math.abs(exportGeo[sel]!.h - previewGeo[sel]!.h), `${sel} height`).toBeLessThanOrEqual(
      1,
    );
  }

  // 3. The mermaid SVG is the preview's own render, styling intact.
  const svgProbe = (p: Page): Promise<{ viewBox: string | null; fill: string | null } | null> =>
    p.evaluate(() => {
      const svg = document.querySelector("#penmark-root .pmk-mermaid svg");
      const rect = svg?.querySelector(".node rect");
      return svg
        ? {
            viewBox: svg.getAttribute("viewBox"),
            fill: rect ? getComputedStyle(rect).fill : null,
          }
        : null;
    });
  expect(await svgProbe(exportPage)).toEqual(await svgProbe(page));

  // The author's `style D fill:#22c55e` directive survives into the export.
  const authoredFill = await exportPage.evaluate(() =>
    [
      ...document.querySelectorAll(
        "#penmark-root .pmk-mermaid svg .node rect, #penmark-root .pmk-mermaid svg .node path",
      ),
    ].map((el) => getComputedStyle(el).fill),
  );
  expect(authoredFill).toContain("rgb(34, 197, 94)");

  await exportPage.close();
});

test("a dark preview exports the SAME light document and is restored to dark", async ({ page }) => {
  await waitReady(page);
  await renderShowcase(page, "dark");

  const unauthoredFill = (p: Page): Promise<string | null> =>
    p.evaluate(() => {
      // Node A ("Markdown source") carries no author style directive.
      const rect = document.querySelector("#penmark-root .pmk-mermaid svg .node rect");
      return rect ? getComputedStyle(rect).fill : null;
    });
  const darkFill = await unauthoredFill(page);
  expect(darkFill).not.toBeNull();

  const captured = await captureFromHarness(page, "dark-source");
  expect(captured["ok"]).toBe(true);
  const file = buildExportFile(captured, "export-from-dark");
  const exportPage = await openExportedPage(page, file);

  // The export is light: white page, light-theme diagram fills.
  await expect(exportPage.locator("body")).toHaveAttribute("data-theme", "light");
  const bodyBg = await exportPage.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bodyBg).toBe("rgb(255, 255, 255)");
  const exportFill = await unauthoredFill(exportPage);
  expect(exportFill).not.toBeNull();
  expect(exportFill).not.toBe(darkFill);

  // The live preview goes back to dark diagrams after the capture.
  await expect.poll(() => unauthoredFill(page), { timeout: 15000 }).toBe(darkFill);
  await expect(page.locator("body")).toHaveAttribute("data-theme", "dark");

  await exportPage.close();
});

test("topbar Export button opens the dialog; confirm posts exportRequest", async ({ page }) => {
  await waitReady(page);
  await renderShowcase(page, "light");

  await page.locator(".pmk-topbar-export").click();
  const dialog = page.locator("dialog.pmk-export-dialog");
  await expect(dialog).toBeVisible();

  // Choose PDF, toggle the TOC on, pick letter + wide margins. ("Wide" exists
  // in both the Width and Margins groups — scope by fieldset legend.)
  const group = (name: string) =>
    dialog.locator("fieldset", { has: page.locator("legend", { hasText: name }) });
  await dialog.locator('button[data-value="pdf"]').click();
  await dialog.locator("label", { hasText: "Table of contents" }).locator("input").check();
  await group("Page size").locator('button[data-value="letter"]').click();
  await group("Margins").locator('button[data-value="wide"]').click();
  await dialog.getByRole("button", { name: "Export PDF" }).click();
  await expect(dialog).toBeHidden();

  const request = await page.evaluate(() => {
    const h = (window as Window & { __harness?: Harness }).__harness;
    return h?.messages.find((m) => m.type === "exportRequest") ?? null;
  });
  expect(request).toMatchObject({
    v: 1,
    type: "exportRequest",
    kind: "pdf",
    options: {
      includeFrontmatter: false,
      includeToc: true,
      pdfPageSize: "letter",
      pdfMargin: "wide",
      pdfHeaderFooter: true,
    },
  });
});

test("exportShowOptions opens the dialog with host defaults (palette path)", async ({ page }) => {
  await waitReady(page);
  await renderShowcase(page, "light");

  await page.evaluate((defaults) => {
    (window as Window & { __harness?: Harness }).__harness!.injectMessage({
      v: 1,
      type: "exportShowOptions",
      kind: "pdf",
      defaults,
    });
  }, DIALOG_DEFAULTS);

  const dialog = page.locator("dialog.pmk-export-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Export PDF" })).toBeVisible();
  // A retried exportShowOptions must not clobber the open dialog's state.
  await dialog.locator('button[data-value="letter"]').click();
  await page.evaluate((defaults) => {
    (window as Window & { __harness?: Harness }).__harness!.injectMessage({
      v: 1,
      type: "exportShowOptions",
      kind: "pdf",
      defaults,
    });
  }, DIALOG_DEFAULTS);
  await expect(dialog.locator('button[data-value="letter"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("canceling an exportShowOptions dialog suppresses retried reopen attempts", async ({
  page,
}) => {
  await waitReady(page);
  await renderShowcase(page, "light");

  const dialog = page.locator("dialog.pmk-export-dialog");
  for (let i = 0; i < 4; i++) {
    await page.evaluate((defaults) => {
      (window as Window & { __harness?: Harness }).__harness!.injectMessage({
        v: 1,
        type: "exportShowOptions",
        kind: "html",
        defaults,
        requestId: "cancel-retry",
      });
    }, DIALOG_DEFAULTS);
    if (i === 0) {
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(dialog).toBeHidden();
    }
    await page.waitForTimeout(100);
  }

  await expect(dialog).toBeHidden();
});

test("exported file is self-contained, script-free, and honors content options", async ({
  page,
}) => {
  await waitReady(page);
  await renderShowcase(page, "light");

  // Defaults: frontmatter and TOC excluded.
  const bare = await captureFromHarness(page, "clean-default");
  expect(bare["ok"]).toBe(true);
  expect(bare["frontmatterHtml"]).toBeUndefined();
  expect(bare["tocHtml"]).toBeUndefined();

  // Opt in to both.
  const full = await captureFromHarness(page, "clean-full", {
    includeFrontmatter: true,
    includeToc: true,
  });
  expect(full["ok"]).toBe(true);
  const file = buildExportFile(full, "export-full", {
    pageSetup: { size: "a4", margin: "normal" },
  });
  const html = fs.readFileSync(file, "utf8");

  // Self-contained and inert.
  expect(html).not.toContain("<script");
  expect(html).not.toContain("<link");
  expect(html).toContain('http-equiv="Content-Security-Policy"');
  expect(html).toContain("@page { size: A4; margin: 18mm 16mm; }");

  // Preview-only chrome and machine attributes are gone from the CONTENT.
  const content = full["html"] as string;
  expect(content).not.toContain("pmk-copy-btn");
  expect(content).not.toContain("pmk-mermaid-expand");
  expect(content).not.toContain("pmk-gutter-dot");
  expect(content).not.toContain("data-pmk-");
  expect(content).not.toContain("<script");

  // Requested structures present, TOC links resolve to real heading ids.
  expect(html).toContain("pmk-frontmatter-card");
  expect(html).toContain('class="pmk-toc"');
  expect(html).toContain('class="footnotes"');
  expect(html).toContain('type="checkbox"');
  expect(html).toContain("data:image/png;base64");

  const exportPage = await openExportedPage(page, file);
  const tocResolves = await exportPage.evaluate(() =>
    [...document.querySelectorAll(".pmk-toc a")].every((a) => {
      const id = (a.getAttribute("href") ?? "").slice(1);
      return id !== "" && document.getElementById(id) !== null;
    }),
  );
  expect(tocResolves).toBe(true);
  const tocCount = await exportPage.locator(".pmk-toc a").count();
  expect(tocCount).toBeGreaterThanOrEqual(5);
  await exportPage.close();
});

test("capture force-renders below-the-fold diagrams the lazy preview has not reached", async ({
  page,
}) => {
  await waitReady(page);
  // Inject WITHOUT scrolling: the diagram stays below the fold, so the
  // preview's IntersectionObserver never renders it...
  await injectShowcase(page, "light");
  await expect(page.locator("#penmark-root .pmk-mermaid")).toBeAttached();
  expect(await page.locator("#penmark-root .pmk-mermaid svg").count()).toBe(0);

  // ...but the export capture must include it fully rendered anyway.
  const captured = await captureFromHarness(page, "below-fold-1");
  expect(captured["ok"]).toBe(true);
  expect(captured["html"] as string).toContain("<svg");
  expect(captured["html"] as string).not.toContain("data-pmk-source");
});

test("PDF prints through the production CDP path with header/footer", async ({ page }) => {
  test.setTimeout(120_000);
  await waitReady(page);
  await renderShowcase(page, "light");
  const captured = await captureFromHarness(page, "pdf-cdp");
  expect(captured["ok"]).toBe(true);
  // The PDF path omits @page — CDP controls the page geometry.
  const htmlFile = buildExportFile(captured, "export-pdf-src");

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "penmark-pdf-smoke-"));
  const pdfFile = path.join(outDir, "showcase.pdf");
  try {
    // Playwright's Chromium stands in for the user's local browser; args,
    // CDP plumbing, and validation are the production code in pdfCdp.ts.
    // --no-sandbox: the CI browser job runs as root inside the container.
    await printHtmlToPdfViaCdp(
      chromium.executablePath(),
      htmlFile,
      pdfFile,
      { pageSize: "a4", margin: "normal", headerFooter: true, title: "showcase.md" },
      { extraArgs: ["--no-sandbox"], timeoutMs: 90_000 },
    );

    const pdf = fs.readFileSync(pdfFile);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(10_000);
    // At least one page object — Chromium writes page dictionaries in clear.
    expect(pdf.toString("latin1")).toMatch(/\/Type\s*\/Page[^s]/);
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

test("PDF CLI fallback still prints a valid document", async ({ page }) => {
  test.setTimeout(120_000);
  await waitReady(page);
  await renderShowcase(page, "light");
  const captured = await captureFromHarness(page, "pdf-cli");
  expect(captured["ok"]).toBe(true);
  const htmlFile = buildExportFile(captured, "export-pdf-cli-src", {
    pageSetup: { size: "a4", margin: "normal" },
  });

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "penmark-pdf-cli-"));
  const pdfFile = path.join(outDir, "showcase.pdf");
  try {
    await printHtmlToPdf(chromium.executablePath(), htmlFile, pdfFile, {
      extraArgs: ["--no-sandbox"],
      timeoutMs: 90_000,
    });
    const pdf = fs.readFileSync(pdfFile);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(10_000);
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});
