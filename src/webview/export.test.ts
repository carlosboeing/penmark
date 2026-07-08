/**
 * jsdom tests for the export capture (R17, ADR 0007): the serialized snapshot
 * must be the preview content MINUS preview-only chrome and review markup,
 * with mermaid output intact, always light-themed, and the live DOM restored.
 */
import { describe, it, expect, vi } from "vitest";
import { buildTocHtml, captureExport, cleanExportDom } from "./export.js";

const NO_OPTS = { includeFrontmatter: false, includeToc: false };

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

describe("buildTocHtml", () => {
  it("builds a nested list from h1–h3 ids, skipping deeper levels", () => {
    const root = makeRoot(
      `<h1 id="top">Top</h1>` +
        `<h2 id="one">One</h2>` +
        `<h3 id="one-a">One A</h3>` +
        `<h2 id="two">Two <em>styled</em></h2>` +
        `<h4 id="deep">Too deep</h4>`,
    );
    const toc = buildTocHtml(root)!;
    const nav = document.createElement("div");
    nav.innerHTML = toc;
    const links = [...nav.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(links).toEqual(["#top", "#one", "#one-a", "#two"]);
    // Nesting: One A sits in a list nested under One's item.
    expect(nav.querySelector('a[href="#one-a"]')?.closest("ol")?.parentElement?.tagName).toBe("LI");
    // Link text is the heading's plain text (no inline markup).
    expect(nav.querySelector('a[href="#two"]')?.textContent).toBe("Two styled");
    expect(toc).not.toContain("#deep");
    expect(toc).toContain('class="pmk-toc"');
  });

  it("returns undefined for a document without headings", () => {
    expect(buildTocHtml(makeRoot("<p>prose only</p>"))).toBeUndefined();
  });
});

describe("captureExport", () => {
  it("serializes a cleaned CLONE without mutating the live preview", async () => {
    const root = makeRoot(
      `<p><mark class="pmk-hl" data-pmk-id="abcdefgh" data-pmk-state="intact">hi</mark></p>` +
        `<pre><button class="pmk-copy-btn">Copy</button><code>x</code></pre>`,
    );
    const before = root.innerHTML;

    const result = await captureExport(
      root,
      "light",
      NO_OPTS,
      vi.fn(async () => {}),
    );

    expect(result.html).not.toContain("pmk-copy-btn");
    expect(result.html).not.toContain("pmk-hl");
    expect(result.html).toContain("<code>x</code>");
    // Live preview untouched — highlights and buttons still installed.
    expect(root.innerHTML).toBe(before);
  });

  it("force-renders diagrams on LIGHT and restores the preview theme after", async () => {
    const ensureAll = vi.fn(async () => {});
    const ensureLazy = vi.fn(async () => {});
    const prose = makeRoot("<p>prose</p>");
    await captureExport(prose, "dark", NO_OPTS, ensureAll, ensureLazy);
    expect(ensureAll).not.toHaveBeenCalled();
    expect(ensureLazy).not.toHaveBeenCalled();
    prose.remove();

    const withDiagram = makeRoot('<div class="pmk-mermaid" data-pmk-source="graph TD"></div>');
    await captureExport(withDiagram, "dark", NO_OPTS, ensureAll, ensureLazy);
    // Snapshot renders light...
    expect(ensureAll).toHaveBeenCalledWith(withDiagram, "light");
    // ...and the dark preview is restored afterwards.
    expect(ensureLazy).toHaveBeenCalledWith(withDiagram, "dark");
  });

  it("does not restore when the preview is already light", async () => {
    const ensureLazy = vi.fn(async () => {});
    const root = makeRoot('<div class="pmk-mermaid" data-pmk-source="graph TD"></div>');
    await captureExport(
      root,
      "light",
      NO_OPTS,
      vi.fn(async () => {}),
      ensureLazy,
    );
    expect(ensureLazy).not.toHaveBeenCalled();
  });

  it("excludes the frontmatter card by default, includes it forced open on request", async () => {
    const card = document.createElement("details");
    card.id = "pmk-frontmatter-card";
    card.className = "pmk-frontmatter-card";
    card.innerHTML = "<summary>Design doc · draft</summary>";
    document.body.appendChild(card);

    const root = makeRoot("<p>content</p>");
    root.setAttribute("style", "--pmk-text-size-base: 18px;");

    const excluded = await captureExport(
      root,
      "light",
      NO_OPTS,
      vi.fn(async () => {}),
    );
    expect(excluded.frontmatterHtml).toBeUndefined();

    const included = await captureExport(
      root,
      "light",
      { includeFrontmatter: true, includeToc: false },
      vi.fn(async () => {}),
    );
    expect(included.frontmatterHtml).toContain("pmk-frontmatter-card");
    expect(included.frontmatterHtml).toContain("open");
    // The LIVE card keeps its collapsed state.
    expect(card.hasAttribute("open")).toBe(false);
    expect(included.rootStyle).toBe("--pmk-text-size-base: 18px;");

    card.remove();
  });

  it("generates the TOC from the CLEANED clone only when requested", async () => {
    const root = makeRoot(
      `<h1 id="a">A</h1><h2 id="b">B <span class="pmk-gutter-dot"></span></h2>`,
    );
    const off = await captureExport(
      root,
      "light",
      NO_OPTS,
      vi.fn(async () => {}),
    );
    expect(off.tocHtml).toBeUndefined();

    const on = await captureExport(
      root,
      "light",
      { includeFrontmatter: false, includeToc: true },
      vi.fn(async () => {}),
    );
    expect(on.tocHtml).toContain('href="#a"');
    // Built from the clone AFTER cleaning — chrome never leaks into TOC text.
    expect(on.tocHtml).not.toContain("pmk-gutter-dot");
  });
});
