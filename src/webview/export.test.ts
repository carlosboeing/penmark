/**
 * jsdom tests for the export capture (R17, ADR 0007): the serialized snapshot
 * must be the preview content MINUS preview-only chrome and review markup,
 * with mermaid output intact and the live DOM untouched.
 */
import { describe, it, expect, vi } from "vitest";
import { captureExport, cleanExportDom } from "./export.js";

function makeRoot(html: string): HTMLElement {
  const root = document.createElement("div");
  root.id = "penmark-root";
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

describe("cleanExportDom", () => {
  it("strips copy buttons, expand buttons, and gutter dots", () => {
    const root = makeRoot(
      `<pre><button class="pmk-copy-btn">Copy</button><code>x</code></pre>` +
        `<div class="pmk-mermaid"><svg></svg><button class="pmk-mermaid-expand">Expand</button></div>` +
        `<p class="pmk-anchor"><span class="pmk-gutter-dot"></span>text</p>`,
    );
    cleanExportDom(root);
    expect(root.querySelector(".pmk-copy-btn")).toBeNull();
    expect(root.querySelector(".pmk-mermaid-expand")).toBeNull();
    expect(root.querySelector(".pmk-gutter-dot")).toBeNull();
    expect(root.querySelector("svg")).not.toBeNull();
    expect(root.textContent).toContain("text");
  });

  it("unwraps comment span highlights and range wrappers, keeping content", () => {
    const root = makeRoot(
      `<p>before <mark class="pmk-hl" data-pmk-id="abcdefgh" data-pmk-state="intact">quoted <em>rich</em></mark> after</p>` +
        `<div class="pmk-hl-range" data-pmk-id="ijklmnop" data-pmk-state="intact"><p>block one</p><p>block two</p></div>`,
    );
    cleanExportDom(root);
    expect(root.querySelector("mark")).toBeNull();
    expect(root.querySelector(".pmk-hl-range")).toBeNull();
    expect(root.innerHTML).toContain("quoted <em>rich</em>");
    expect(root.querySelectorAll("p").length).toBe(3);
    expect(root.textContent).toContain("before quoted rich after");
  });

  it("removes machine data-pmk-* attributes and the pmk-anchor helper class", () => {
    const root = makeRoot(
      `<h2 data-pmk-offset="3" id="section">Section</h2>` +
        `<table class="pmk-anchor" data-pmk-id="abcdefgh" data-pmk-state="intact" data-pmk-block=""><tbody><tr><td data-pmk-coff="10">cell</td></tr></tbody></table>` +
        `<li data-pmk-line="4"><input type="checkbox" checked disabled> done</li>` +
        `<div class="pmk-mermaid" data-pmk-source="graph TD" data-pmk-rendered-source="graph TD"><svg data-x="1"></svg></div>`,
    );
    cleanExportDom(root);
    expect(root.innerHTML).not.toContain("data-pmk-");
    // Content-bearing attributes survive: heading anchors, checkbox state.
    expect(root.querySelector("h2#section")).not.toBeNull();
    expect(root.querySelector("input[checked]")).not.toBeNull();
    expect(root.querySelector("table")?.hasAttribute("class")).toBe(false);
    // Mermaid SVG (and its own attributes) survive.
    expect(root.querySelector(".pmk-mermaid svg")).not.toBeNull();
  });

  it("preserves mermaid inline styles and embedded stylesheet", () => {
    const root = makeRoot(
      `<div class="pmk-mermaid" data-pmk-source="graph TD">` +
        `<svg id="d1" style="max-width: 300px;"><style>#d1 .node rect { fill: #eee; }</style>` +
        `<g class="node"><rect style="fill: rgb(139, 92, 246);"></rect></g></svg></div>`,
    );
    cleanExportDom(root);
    expect(root.querySelector("svg")?.getAttribute("style")).toBe("max-width: 300px;");
    expect(root.querySelector("rect")?.getAttribute("style")).toContain("139, 92, 246");
    expect(root.querySelector("svg style")?.textContent).toContain("fill: #eee");
  });
});

describe("captureExport", () => {
  it("serializes a cleaned CLONE without mutating the live preview", async () => {
    const root = makeRoot(
      `<p><mark class="pmk-hl" data-pmk-id="abcdefgh" data-pmk-state="intact">hi</mark></p>` +
        `<pre><button class="pmk-copy-btn">Copy</button><code>x</code></pre>`,
    );
    const before = root.innerHTML;

    const result = await captureExport(root, "light", vi.fn(async () => {}));

    expect(result.html).not.toContain("pmk-copy-btn");
    expect(result.html).not.toContain("pmk-hl");
    expect(result.html).toContain("<code>x</code>");
    // Live preview untouched — highlights and buttons still installed.
    expect(root.innerHTML).toBe(before);
  });

  it("forces mermaid render-all only when diagrams exist", async () => {
    const ensureAll = vi.fn(async () => {});
    const prose = makeRoot("<p>prose</p>");
    await captureExport(prose, "light", ensureAll);
    expect(ensureAll).not.toHaveBeenCalled();

    prose.remove();
    const withDiagram = makeRoot('<div class="pmk-mermaid" data-pmk-source="graph TD"></div>');
    await captureExport(withDiagram, "dark", ensureAll);
    expect(ensureAll).toHaveBeenCalledWith(withDiagram, "dark");
  });

  it("includes the frontmatter card forced open, and the root inline style", async () => {
    const card = document.createElement("details");
    card.id = "pmk-frontmatter-card";
    card.className = "pmk-frontmatter-card";
    card.innerHTML = "<summary>Design doc · draft</summary>";
    document.body.appendChild(card);

    const root = makeRoot("<p>content</p>");
    root.setAttribute("style", "--pmk-text-size-base: 18px;");

    const result = await captureExport(root, "light", vi.fn(async () => {}));

    expect(result.frontmatterHtml).toContain("pmk-frontmatter-card");
    expect(result.frontmatterHtml).toContain("open");
    // The LIVE card keeps its collapsed state.
    expect(card.hasAttribute("open")).toBe(false);
    expect(result.rootStyle).toBe("--pmk-text-size-base: 18px;");

    card.remove();
  });

  it("omits frontmatterHtml when the document has no frontmatter card", async () => {
    const root = makeRoot("<p>plain</p>");
    const result = await captureExport(root, "light", vi.fn(async () => {}));
    expect(result.frontmatterHtml).toBeUndefined();
    expect(result.rootStyle).toBe("");
  });
});
