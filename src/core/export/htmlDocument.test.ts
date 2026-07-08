/**
 * Unit tests for the standalone export document builder (R17, ADR 0007).
 * Pure string assembly — asserted on structure, escaping, and the security
 * posture (CSP meta, no scripts introduced by the wrapper). Exports are
 * always light-themed.
 */
import { describe, it, expect } from "vitest";
import { buildExportHtml, escapeHtml } from "./htmlDocument.js";

const BASE = {
  title: "doc.md",
  contentHtml: "<h1>Hello</h1>\n<p>World</p>",
  width: "full" as const,
  css: ["body { margin: 0; }", "#penmark-root { padding: 0; }"],
};

describe("escapeHtml", () => {
  it("escapes the five HTML metacharacters", () => {
    expect(escapeHtml(`<a href="x" title='y'>&`)).toBe(
      "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;",
    );
  });
});

describe("buildExportHtml", () => {
  it("produces a full document with doctype, charset, and the content in #penmark-root", () => {
    const html = buildExportHtml(BASE);
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain('<meta charset="UTF-8">');
    expect(html).toContain('<div id="penmark-root">');
    expect(html).toContain("<h1>Hello</h1>");
    expect(html).toContain("<title>doc.md</title>");
  });

  it("always pins the light theme and applies the width option as a body class", () => {
    const html = buildExportHtml({ ...BASE, width: "comfortable" });
    expect(html).toMatch(
      /<body class="theme-light pmk-content-comfortable pmk-export" data-theme="light">/,
    );
    expect(buildExportHtml(BASE)).toContain("pmk-content-full");
  });

  it("inlines every stylesheet in order", () => {
    const html = buildExportHtml(BASE);
    const first = html.indexOf("body { margin: 0; }");
    const second = html.indexOf("#penmark-root { padding: 0; }");
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
    expect(html).not.toContain("<link"); // fully self-contained
  });

  it("emits a defense-in-depth CSP meta that blocks scripts", () => {
    const html = buildExportHtml(BASE);
    expect(html).toContain('http-equiv="Content-Security-Policy"');
    expect(html).toContain("default-src 'none'");
    expect(html).not.toContain("script-src"); // nothing whitelists scripts
    expect(html).not.toContain("<script");
  });

  it("emits @page size and preset margins only when pageSetup is given", () => {
    expect(buildExportHtml({ ...BASE, pageSetup: { size: "a4", margin: "normal" } })).toContain(
      "@page { size: A4; margin: 18mm 16mm; }",
    );
    expect(buildExportHtml({ ...BASE, pageSetup: { size: "letter", margin: "narrow" } })).toContain(
      "@page { size: letter; margin: 12mm 12mm; }",
    );
    expect(buildExportHtml({ ...BASE, pageSetup: { size: "a4", margin: "wide" } })).toContain(
      "margin: 25mm 22mm",
    );
    // The CDP-printed PDF path controls page geometry itself — no @page.
    expect(buildExportHtml(BASE)).not.toContain("@page");
  });

  it("escapes the title and generator (never trusts file names)", () => {
    const html = buildExportHtml({
      ...BASE,
      title: `<script>alert(1)</script>.md`,
      generator: `Pen"mark <1>`,
    });
    expect(html).toContain("<title>&lt;script&gt;alert(1)&lt;/script&gt;.md</title>");
    expect(html).toContain('content="Pen&quot;mark &lt;1&gt;"');
    expect(html).not.toContain("<script>alert");
  });

  it("carries the typography variables as the root style attribute, escaped", () => {
    const html = buildExportHtml({
      ...BASE,
      rootStyle: '--pmk-font-family: Georgia, "Times New Roman", serif;',
    });
    expect(html).toContain(
      '<div id="penmark-root" style="--pmk-font-family: Georgia, &quot;Times New Roman&quot;, serif;">',
    );
  });

  it("places the frontmatter card before the root when provided", () => {
    const html = buildExportHtml({
      ...BASE,
      frontmatterHtml: '<details id="pmk-frontmatter-card" open><summary>meta</summary></details>',
    });
    const card = html.indexOf("pmk-frontmatter-card");
    const root = html.indexOf('id="penmark-root"');
    expect(card).toBeGreaterThan(-1);
    expect(card).toBeLessThan(root);
  });

  it("places the table of contents inside the root, before the content", () => {
    const html = buildExportHtml({
      ...BASE,
      tocHtml: '<nav class="pmk-toc"><ol><li><a href="#hello">Hello</a></li></ol></nav>',
    });
    const root = html.indexOf('id="penmark-root"');
    const toc = html.indexOf('class="pmk-toc"');
    const content = html.indexOf("<h1>Hello</h1>");
    expect(toc).toBeGreaterThan(root);
    expect(content).toBeGreaterThan(toc);
    // Omitted entirely when not requested.
    expect(buildExportHtml(BASE)).not.toContain("pmk-toc");
  });
});
