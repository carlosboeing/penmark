/**
 * Playwright harness tests for T9 — mermaid lazy render + lightbox.
 *
 * Loads the built webview bundle via the static harness and injects host
 * `render` / `setTheme` messages. The harness applies a production-equivalent
 * nonce CSP (see test/harness/index.html) so mermaid stylesheet blocking is
 * exercised here — not just in the real webview.
 *
 * Covers design §5.4:
 *   - valid diagram renders an <svg> once scrolled into view (IntersectionObserver)
 *   - node rects receive themed fills under the nonce CSP (not SVG-default black)
 *   - an invalid diagram shows an error note + its source while a sibling valid
 *     diagram still renders (per-diagram failure containment)
 *   - Expand opens the <dialog>; a zoom action changes the svg transform; Esc closes
 *   - a setTheme switch re-renders the svg under the new theme
 *   - an unrelated edit (same mermaid source) preserves the svg node identity
 *   - light/dark visual goldens for a subgraph + rect + stadium repro diagram
 *
 * The .pmk-mermaid container carries data-pmk-source (HTML-escaped diagram
 * source) — exactly what the core fence rule + sanitizer emit/preserve.
 */
import { test, expect } from "@playwright/test";

type HarnessMessage = { v?: number; type: string };
type Harness = { messages: HarnessMessage[]; injectMessage: (msg: unknown) => void };

const VALID = "graph TD&#10;  A[Start] --&gt; B[End]";
// Repro for the CSP black-rect bug: subgraph cluster + rect + stadium nodes.
const REPRO =
  "graph TD&#10;  subgraph cluster0 [Cluster]&#10;    A[Rect node] --&gt; B([Stadium node])&#10;  end";
// Longer labels to exercise wrapping + vertical centering under nonce CSP.
const REPRO_WRAP =
  "graph TD&#10;  subgraph cluster0 [Cluster title]&#10;    A[A longer rectangular node label] --&gt; B([Stadium node with text])&#10;  end";
// Edge labels on connectors (-->|text|) — labelBkg + foreignObject sizing.
const EDGE_LABELS =
  "graph LR&#10;  A[Start node] --&gt;|edge label with longer text| B[End node]&#10;  C[Top] --&gt;|short| D[Bottom]";
const EDGE_LABEL_LONG =
  "graph LR&#10;  A[Left box here] --&gt;|This is a much longer edge label that should wrap onto multiple lines| B[Right box here]";
// A wide sequence diagram whose last participant has a long label — mermaid's
// useMaxWidth viewBox can fall a few px short of it, and SVG's default
// overflow:hidden then clips the label tail.
const WIDE_SEQUENCE =
  "sequenceDiagram&#10;" +
  "  participant Human as Human Orchestrator&#10;" +
  "  participant CC as Coding Session&#10;" +
  "  participant GH as GitHub (Issues, Board, PRs)&#10;" +
  "  participant Repo as Git Repo (branches, files)&#10;" +
  "  Human-&gt;&gt;CC: claude designer&#10;" +
  "  Human-&gt;&gt;Repo: merges design PR (approval gate)";
// An invalid diagram: bogus diagram type mermaid cannot parse.
const INVALID = "thisisnotavaliddiagramtype foo bar baz";

/** Inject a render message and wait for the webview to process it. */
async function injectRender(
  page: import("@playwright/test").Page,
  html: string,
  theme: "light" | "dark" = "light",
): Promise<void> {
  await page.evaluate(
    ({ html, theme }) => {
      (window as Window & { __harness?: Harness }).__harness!.injectMessage({
        v: 1,
        type: "render",
        html,
        theme,
        docName: "diagram.md",
      });
    },
    { html, theme },
  );
}

async function waitReady(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => {
    const h = (window as Window & { __harness?: Harness }).__harness;
    return h !== undefined && h.messages.length > 0;
  });
}

test("renders a valid mermaid diagram as an svg when scrolled into view", async ({ page }) => {
  await waitReady(page);
  await injectRender(page, `<div class="pmk-mermaid" data-pmk-source="${VALID}"></div>`);

  const svg = page.locator("#penmark-root .pmk-mermaid svg");
  await expect(svg).toBeVisible({ timeout: 15000 });
});

test("node rects have themed fills under the production-equivalent nonce CSP", async ({ page }) => {
  await waitReady(page);
  await injectRender(page, `<div class="pmk-mermaid" data-pmk-source="${REPRO}"></div>`);

  const container = page.locator("#penmark-root .pmk-mermaid").first();
  await expect(container.locator("svg")).toBeVisible({ timeout: 15000 });

  // A rect node inside the flowchart — without nonce-injected styles this stays
  // SVG-default black under style-src 'nonce-…'.
  const rectFill = await page.evaluate(() => {
    const rect = document.querySelector(
      "#penmark-root .pmk-mermaid svg .node rect",
    ) as SVGRectElement | null;
    if (!rect) return null;
    return getComputedStyle(rect).fill;
  });

  expect(rectFill).not.toBeNull();
  expect(rectFill).not.toBe("rgb(0, 0, 0)");
  expect(rectFill).not.toBe("black");
  expect(rectFill).not.toBe("none");
  expect(rectFill).not.toBe("transparent");
});

test("node labels are vertically centered under the nonce CSP", async ({ page }) => {
  await waitReady(page);
  await injectRender(page, `<div class="pmk-mermaid" data-pmk-source="${REPRO}"></div>`, "dark");

  const container = page.locator("#penmark-root .pmk-mermaid").first();
  await expect(container.locator("svg")).toBeVisible({ timeout: 15000 });

  const deltaY = await page.evaluate(() => {
    const node = document.querySelector(
      "#penmark-root .pmk-mermaid svg .node",
    ) as SVGGElement | null;
    if (!node) return null;
    const shape = node.querySelector(
      "rect, path, circle, ellipse, polygon",
    ) as SVGGraphicsElement | null;
    const label = node.querySelector(
      "foreignObject .nodeLabel, foreignObject p, foreignObject span",
    ) as Element | null;
    if (!shape || !label) return null;
    const shapeBox = shape.getBoundingClientRect();
    const labelBox = label.getBoundingClientRect();
    const shapeCenterY = shapeBox.top + shapeBox.height / 2;
    const labelCenterY = labelBox.top + labelBox.height / 2;
    return Math.abs(shapeCenterY - labelCenterY);
  });

  expect(deltaY).not.toBeNull();
  expect(deltaY!).toBeLessThan(8);
});

test("node labels stay centered within their boxes under the nonce CSP", async ({ page }) => {
  await waitReady(page);
  await injectRender(
    page,
    `<div class="pmk-mermaid" data-pmk-source="${REPRO_WRAP}"></div>`,
    "dark",
  );

  await expect(page.locator("#penmark-root .pmk-mermaid svg")).toBeVisible({ timeout: 15000 });

  // After re-hydration the labels use mermaid's NATIVE table-cell layout, and
  // the node box is sized to its measured label. The observable contract is:
  // the label is centered in the shape and does not overflow it.
  const fit = await page.evaluate(() => {
    return [...document.querySelectorAll("#penmark-root .pmk-mermaid svg .node")].map((node) => {
      const shape = node.querySelector(
        "rect, path, polygon, circle, ellipse",
      ) as SVGGraphicsElement;
      const label = node.querySelector(
        "foreignObject .nodeLabel, foreignObject span, foreignObject p",
      ) as Element;
      if (!shape || !label) return null;
      const s = shape.getBoundingClientRect();
      const l = label.getBoundingClientRect();
      return {
        deltaX: Math.abs(s.left + s.width / 2 - (l.left + l.width / 2)),
        deltaY: Math.abs(s.top + s.height / 2 - (l.top + l.height / 2)),
        withinX: l.left >= s.left - 1 && l.right <= s.right + 1,
      };
    });
  });

  expect(fit.filter(Boolean).length).toBeGreaterThan(0);
  for (const f of fit) {
    expect(f).not.toBeNull();
    expect(f!.deltaX).toBeLessThan(6);
    expect(f!.deltaY).toBeLessThan(8);
    expect(f!.withinX).toBe(true);
  }
});

test("narrow diagrams render at natural size, not upscaled, under the nonce CSP", async ({
  page,
}) => {
  await waitReady(page);
  // A small flowchart whose natural width is far below the panel width. Before
  // the fix, mermaid's blocked inline `max-width` let width="100%" stretch the
  // svg to fill the panel (uniform upscaling); re-hydration restores the cap.
  await injectRender(page, `<div class="pmk-mermaid" data-pmk-source="${VALID}"></div>`);
  await expect(page.locator("#penmark-root .pmk-mermaid svg")).toBeVisible({ timeout: 15000 });

  const m = await page.evaluate(() => {
    const svg = document.querySelector("#penmark-root .pmk-mermaid svg") as SVGSVGElement;
    const root = document.getElementById("penmark-root")!;
    return {
      viewBox: svg.viewBox.baseVal.width,
      client: svg.getBoundingClientRect().width,
      root: root.getBoundingClientRect().width,
    };
  });

  // Rendered close to its natural width (small tolerance) and well under the panel.
  expect(m.client).toBeLessThanOrEqual(m.viewBox + 4);
  expect(m.client).toBeLessThan(m.root * 0.75);
});

test("author style directive colors are applied under the nonce CSP", async ({ page }) => {
  await waitReady(page);
  // `style A fill:#…` becomes an inline style on the shape — blocked by the CSP
  // until re-hydration re-applies it. (GitHub honours these; we must too.)
  const STYLED =
    "flowchart LR&#10;  A[Orchestrator] --&gt; B[Worker]&#10;  style A fill:#8b5cf6,stroke:#6d28d9&#10;  style B fill:#22c55e";
  await injectRender(page, `<div class="pmk-mermaid" data-pmk-source="${STYLED}"></div>`);
  await expect(page.locator("#penmark-root .pmk-mermaid svg .node rect").first()).toBeVisible({
    timeout: 15000,
  });

  const fills = await page.evaluate(() =>
    [...document.querySelectorAll("#penmark-root .pmk-mermaid svg .node rect")].map(
      (r) => getComputedStyle(r as SVGRectElement).fill,
    ),
  );

  expect(fills).toContain("rgb(139, 92, 246)");
  expect(fills).toContain("rgb(34, 197, 94)");
});

test("edge labels are centered and sized to their text under the nonce CSP", async ({ page }) => {
  await waitReady(page);
  await injectRender(
    page,
    `<div class="pmk-mermaid" data-pmk-source="${EDGE_LABELS}"></div>`,
    "dark",
  );

  await expect(page.locator("#penmark-root .pmk-mermaid svg g.edgeLabel").first()).toBeVisible({
    timeout: 15000,
  });

  const labels = await page.evaluate(() => {
    return [...document.querySelectorAll("#penmark-root .pmk-mermaid svg g.edgeLabel")]
      .map((g) => {
        const fo = g.querySelector("foreignObject") as SVGForeignObjectElement | null;
        const text = fo?.querySelector(".edgeLabel, span, p") as HTMLElement | null;
        if (!fo || !text || !text.textContent?.trim()) return null;
        const foBox = fo.getBoundingClientRect();
        const textBox = text.getBoundingClientRect();
        return {
          text: text.textContent?.trim(),
          // The text is centered within its foreignObject (mermaid's native layout).
          deltaX: Math.abs(foBox.left + foBox.width / 2 - (textBox.left + textBox.width / 2)),
          deltaY: Math.abs(foBox.top + foBox.height / 2 - (textBox.top + textBox.height / 2)),
          visible: textBox.width > 0 && textBox.height > 0,
        };
      })
      .filter(Boolean);
  });

  expect(labels).toHaveLength(2);
  for (const label of labels) {
    expect(label!.visible).toBe(true);
    expect(label!.deltaX).toBeLessThan(6);
    expect(label!.deltaY).toBeLessThan(6);
  }
});

test("long edge labels wrap onto multiple lines under the nonce CSP", async ({ page }) => {
  await waitReady(page);
  await injectRender(
    page,
    `<div class="pmk-mermaid" data-pmk-source="${EDGE_LABEL_LONG}"></div>`,
    "dark",
  );

  await expect(page.locator("#penmark-root .pmk-mermaid svg g.edgeLabel")).toBeVisible({
    timeout: 15000,
  });

  // Mermaid wraps long edge labels at its default flowchart wrapping width; the
  // observable result is a label taller than a single line and bounded in width.
  const edge = await page.evaluate(() => {
    const fo = document.querySelector(
      "#penmark-root .pmk-mermaid svg g.edgeLabel foreignObject",
    ) as SVGForeignObjectElement | null;
    const text = fo?.querySelector(".edgeLabel, span, p") as HTMLElement | null;
    const p = fo?.querySelector("p") as HTMLElement | null;
    if (!fo || !text) return null;
    const box = text.getBoundingClientRect();
    const lineHeight = p ? Number.parseFloat(getComputedStyle(p).lineHeight) : 24;
    return { width: box.width, height: box.height, lineHeight };
  });

  expect(edge).not.toBeNull();
  expect(edge!.height).toBeGreaterThan(edge!.lineHeight * 1.5);
  expect(edge!.width).toBeLessThanOrEqual(260);
});

test("subgraph cluster title does not overlap its child nodes under the nonce CSP", async ({
  page,
}) => {
  await waitReady(page);
  // A multi-word cluster title. Before the font-pinning fix, mermaid measured
  // the title in the off-screen default serif and displayed it in the wider
  // sans-serif, so it wrapped onto a second line that overlapped the nodes.
  const CLUSTER =
    "flowchart TB&#10;  B[Anonymized brief]&#10;  subgraph panel [Structured review panel]&#10;    S1([Strategy analyst]) ~~~ S2([Business analyst])&#10;  end&#10;  B --&gt; panel";
  await injectRender(page, `<div class="pmk-mermaid" data-pmk-source="${CLUSTER}"></div>`);
  await expect(page.locator("#penmark-root .pmk-mermaid svg .cluster")).toBeVisible({
    timeout: 15000,
  });

  const probe = await page.evaluate(() => {
    const cluster = document.querySelector("#penmark-root .pmk-mermaid svg .cluster")!;
    const title = cluster.querySelector(
      "foreignObject .nodeLabel, foreignObject span, foreignObject p",
    ) as Element | null;
    const node = document.querySelector("#penmark-root .pmk-mermaid svg .node") as Element | null;
    if (!title || !node) return null;
    const t = title.getBoundingClientRect();
    const n = node.getBoundingClientRect();
    return { titleBottom: t.bottom, nodeTop: n.top, titleHeight: t.height };
  });

  expect(probe).not.toBeNull();
  // Single line (≈ one line-height, not the ~2x of a wrapped title)…
  expect(probe!.titleHeight).toBeLessThan(34);
  // …and it sits above the first child node (no overlap).
  expect(probe!.titleBottom).toBeLessThanOrEqual(probe!.nodeTop + 2);
});

test("wide sequence diagram does not clip its last participant under the nonce CSP", async ({
  page,
}) => {
  await waitReady(page);
  await injectRender(page, `<div class="pmk-mermaid" data-pmk-source="${WIDE_SEQUENCE}"></div>`);
  await expect(page.locator("#penmark-root .pmk-mermaid svg")).toBeVisible({ timeout: 15000 });

  const probe = await page.evaluate(() => {
    const svg = document.querySelector("#penmark-root .pmk-mermaid svg") as SVGSVGElement;
    const root = document.getElementById("penmark-root")!;
    const label = [...svg.querySelectorAll("text")].find((t) =>
      /Git Repo/.test(t.textContent ?? ""),
    );
    if (!label) return null;
    const lb = (label as SVGGraphicsElement).getBoundingClientRect();
    return {
      labelRight: lb.right,
      rootRight: root.getBoundingClientRect().right,
      pageOverflow: root.scrollWidth - Math.round(root.getBoundingClientRect().width),
    };
  });

  expect(probe).not.toBeNull();
  // The full last-participant label is visible within the panel (overflow:visible
  // on the svg releases mermaid's slightly-too-narrow viewBox)…
  expect(probe!.labelRight).toBeLessThanOrEqual(probe!.rootRight);
  // …and it does not introduce a horizontal scrollbar.
  expect(probe!.pageOverflow).toBeLessThanOrEqual(1);
});

test("sequence diagram actor labels are centered in their boxes under the nonce CSP", async ({
  page,
}) => {
  await waitReady(page);
  await injectRender(page, `<div class="pmk-mermaid" data-pmk-source="${WIDE_SEQUENCE}"></div>`);
  await expect(page.locator("#penmark-root .pmk-mermaid svg text.actor").first()).toBeVisible({
    timeout: 15000,
  });

  // Mermaid centers actor labels with `text-anchor: middle` set via .style()
  // (CSP-blocked); rehydration must preserve it or the text anchors at `start`
  // and spills right of centre.
  const labels = await page.evaluate(() => {
    return [...document.querySelectorAll("#penmark-root .pmk-mermaid svg text.actor")].map((t) => {
      const g = t.closest("g");
      const box = g?.querySelector("path, rect");
      if (!box) return null;
      const tb = t.getBoundingClientRect();
      const bb = box.getBoundingClientRect();
      return {
        anchor: getComputedStyle(t).textAnchor,
        deltaX: Math.abs(tb.left + tb.width / 2 - (bb.left + bb.width / 2)),
      };
    });
  });

  expect(labels.filter(Boolean).length).toBeGreaterThan(0);
  for (const l of labels) {
    expect(l).not.toBeNull();
    expect(l!.anchor).toBe("middle");
    expect(l!.deltaX).toBeLessThan(4);
  }
});

test("contains a failed diagram: error + source shown, sibling still renders", async ({ page }) => {
  await waitReady(page);
  await injectRender(
    page,
    `<div class="pmk-mermaid" data-pmk-source="${INVALID}"></div>` +
      `<div class="pmk-mermaid" data-pmk-source="${VALID}"></div>`,
  );

  const containers = page.locator("#penmark-root .pmk-mermaid");
  // The failed one shows the error note + source text.
  const failed = containers.nth(0);
  await expect(failed.locator(".pmk-mermaid-error-note")).toBeVisible({ timeout: 15000 });
  await expect(failed.locator(".pmk-mermaid-error-source")).toContainText(
    "thisisnotavaliddiagramtype",
  );
  // The sibling valid diagram still renders an svg — one bad diagram does not
  // break the page or its neighbours.
  await expect(containers.nth(1).locator("svg")).toBeVisible({ timeout: 15000 });
});

test("Expand opens an accessible focus-confined lightbox, zooms, and returns focus", async ({
  page,
}) => {
  await waitReady(page);
  await injectRender(page, `<div class="pmk-mermaid" data-pmk-source="${VALID}"></div>`);

  await expect(page.locator("#penmark-root .pmk-mermaid svg")).toBeVisible({ timeout: 15000 });

  // Expand button opens the dialog.
  const expand = page.getByRole("button", { name: "Expand diagram" });
  await expand.click();
  const dialog = page.getByRole("dialog", { name: "Expanded diagram" });
  await expect(dialog).toBeVisible();

  const close = dialog.getByRole("button", { name: "Close diagram" });
  const zoomOut = dialog.getByRole("button", { name: "Zoom out" });
  await expect(close).toBeFocused();
  await expect(dialog.getByRole("button", { name: "Zoom in" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Fit diagram to view" })).toBeVisible();

  await page.keyboard.press("Tab");
  await expect(zoomOut).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(close).toBeFocused();

  const dialogSvg = dialog.locator("svg");
  await expect(dialogSvg).toBeVisible();

  // Capture the viewport transform, zoom in, and assert it changed.
  const before = await dialog.locator("svg .svg-pan-zoom_viewport").getAttribute("transform");
  await page.evaluate(() => {
    const el = document.querySelector("dialog.pmk-mermaid-lightbox svg") as SVGElement | null;
    // Dispatch a wheel event to trigger svg-pan-zoom zoom.
    el?.dispatchEvent(
      new WheelEvent("wheel", { deltaY: -200, bubbles: true, clientX: 50, clientY: 50 }),
    );
  });
  await expect
    .poll(async () => dialog.locator("svg .svg-pan-zoom_viewport").getAttribute("transform"))
    .not.toBe(before);

  // Esc closes the dialog (native <dialog> behaviour).
  await page.evaluate(() => {
    (window as Window & { __underlyingEscapeCount?: number }).__underlyingEscapeCount = 0;
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        (window as Window & { __underlyingEscapeCount?: number }).__underlyingEscapeCount! += 1;
      }
    });
  });
  await dialog.evaluate((element) => {
    element.addEventListener(
      "cancel",
      (event) => {
        (
          window as Window & { __mermaidCancelDefaultPrevented?: boolean }
        ).__mermaidCancelDefaultPrevented = event.defaultPrevented;
      },
      { once: true },
    );
  });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(expand).toBeFocused();
  expect(
    await page.evaluate(
      () =>
        (window as Window & { __mermaidCancelDefaultPrevented?: boolean })
          .__mermaidCancelDefaultPrevented,
    ),
  ).toBe(false);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __underlyingEscapeCount?: number }).__underlyingEscapeCount,
      ),
    )
    .toBe(0);
});

test("setTheme re-renders the diagram under the new theme", async ({ page }) => {
  await waitReady(page);
  await injectRender(page, `<div class="pmk-mermaid" data-pmk-source="${VALID}"></div>`, "light");

  const svg = page.locator("#penmark-root .pmk-mermaid svg");
  await expect(svg).toBeVisible({ timeout: 15000 });
  const lightId = await svg.getAttribute("id");

  // Switch to dark — the diagram must re-render (mermaid render() mints a new id).
  await page.evaluate(() => {
    (window as Window & { __harness?: Harness }).__harness!.injectMessage({
      v: 1,
      type: "setTheme",
      theme: "dark",
    });
  });

  await expect
    .poll(async () => page.locator("#penmark-root .pmk-mermaid svg").getAttribute("id"), {
      timeout: 15000,
    })
    .not.toBe(lightId);
  await expect(page.locator("body")).toHaveAttribute("data-theme", "dark");
});

test("an unrelated edit preserves the rendered svg node identity", async ({ page }) => {
  await waitReady(page);
  const mermaidHtml = `<div class="pmk-mermaid" data-pmk-source="${VALID}"></div>`;
  // First render: a paragraph + the diagram.
  await injectRender(page, `<p>before</p>${mermaidHtml}`);
  await expect(page.locator("#penmark-root .pmk-mermaid svg")).toBeVisible({ timeout: 15000 });

  // Tag the current svg node so we can detect if morphdom replaced it.
  await page.evaluate(() => {
    const svg = document.querySelector("#penmark-root .pmk-mermaid svg");
    svg?.setAttribute("data-identity-probe", "kept");
  });

  // Re-render with an UNRELATED edit (paragraph text changes; diagram source is
  // identical). morphdom must keep the rendered svg in place (source-keyed skip).
  await injectRender(page, `<p>after edit</p>${mermaidHtml}`);
  // Target the top-level paragraph (mermaid svg node labels also use <p>).
  await expect(page.locator("#penmark-root > p").first()).toHaveText("after edit");

  // The probe attribute survives only if the svg node was NOT replaced.
  await expect(page.locator("#penmark-root .pmk-mermaid svg")).toHaveAttribute(
    "data-identity-probe",
    "kept",
  );
});

for (const theme of ["light", "dark"] as const) {
  test(`mermaid golden — ${theme} (subgraph + rect + stadium)`, async ({ page }) => {
    await waitReady(page);
    await injectRender(
      page,
      `<div class="pmk-mermaid" data-pmk-source="${REPRO_WRAP}"></div>`,
      theme,
    );

    await expect(page.locator("body")).toHaveAttribute("data-theme", theme);
    await expect(page.locator("#penmark-root .pmk-mermaid svg")).toBeVisible({
      timeout: 15000,
    });

    await expect(page.locator("#penmark-root .pmk-mermaid")).toHaveScreenshot(
      `mermaid-${theme}.png`,
      { animations: "disabled" },
    );
  });
}
