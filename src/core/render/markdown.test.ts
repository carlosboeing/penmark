import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { createRenderer, tokenizeBlockOffsets } from "./markdown.js";
import { stripFrontmatter } from "./frontmatter.js";

const FIXTURES = resolve(__dirname, "../../../test/fixtures/render");
const SNAPSHOTS = resolve(__dirname, "../../../test/fixtures/render/snapshots");

function fixture(name: string): string {
  return readFileSync(resolve(FIXTURES, name), "utf8");
}

function render(name: string): string {
  const md = fixture(name);
  const { body } = stripFrontmatter(md);
  return createRenderer({}).render(body);
}

describe("createRenderer — GFM feature set", () => {
  it("renders tables", async () => {
    const html = render("tables.md");
    await expect(html).toMatchFileSnapshot(resolve(SNAPSHOTS, "tables.html"));
  });

  it("renders strikethrough", async () => {
    const html = render("strikethrough.md");
    await expect(html).toMatchFileSnapshot(resolve(SNAPSHOTS, "strikethrough.html"));
  });

  it("renders task lists", async () => {
    const html = render("task-lists.md");
    await expect(html).toMatchFileSnapshot(resolve(SNAPSHOTS, "task-lists.html"));
  });

  it("renders footnotes", async () => {
    const html = render("footnotes.md");
    await expect(html).toMatchFileSnapshot(resolve(SNAPSHOTS, "footnotes.html"));
  });

  it("renders heading anchors with GitHub-compatible slugs", async () => {
    const html = render("heading-anchors.md");
    await expect(html).toMatchFileSnapshot(resolve(SNAPSHOTS, "heading-anchors.html"));
    // GitHub-style slugs: lowercase, spaces to hyphens
    expect(html).toContain('id="hello-world"');
    expect(html).toContain('id="another-heading"');
    // Duplicate headings get numeric suffix
    expect(html).toContain('id="duplicate-heading-1"');
  });

  it("produces stable slugs when one renderer renders the same document twice", () => {
    // The preview reuses a single renderer across re-renders (every edit/save).
    // The slugger must reset per render or anchors accumulate -1/-2 suffixes.
    const { body } = stripFrontmatter(fixture("heading-anchors.md"));
    const renderer = createRenderer({});
    const first = renderer.render(body);
    const second = renderer.render(body);
    expect(second).toBe(first);
    expect(second).toContain('id="hello-world"');
    expect(second).not.toContain('id="hello-world-1"');
  });

  it("renders autolinks", async () => {
    const html = render("autolinks.md");
    await expect(html).toMatchFileSnapshot(resolve(SNAPSHOTS, "autolinks.html"));
    expect(html).toContain('href="https://example.com"');
  });

  it("renders fenced code blocks without highlight", async () => {
    const html = render("fenced-code.md");
    await expect(html).toMatchFileSnapshot(resolve(SNAPSHOTS, "fenced-code.html"));
    expect(html).toContain("<code");
    expect(html).toContain("function greet");
  });

  it("renders images with default src passthrough", async () => {
    const html = render("images.md");
    await expect(html).toMatchFileSnapshot(resolve(SNAPSHOTS, "images.html"));
    expect(html).toContain('src="./assets/image.png"');
    expect(html).toContain('src="https://example.com/photo.jpg"');
  });

  it("rewrites image src via resolveImage hook", () => {
    const md = fixture("images.md");
    const { body } = stripFrontmatter(md);
    const renderer = createRenderer({
      resolveImage: (src) => `vscode-resource:${src}`,
    });
    const html = renderer.render(body);
    expect(html).toContain('src="vscode-resource:./assets/image.png"');
    expect(html).toContain('src="vscode-resource:https://example.com/photo.jpg"');
  });

  it("renders blockquotes", async () => {
    const html = render("blockquotes.md");
    await expect(html).toMatchFileSnapshot(resolve(SNAPSHOTS, "blockquotes.html"));
    expect(html).toContain("<blockquote>");
  });
});

describe("createRenderer — pmk HTML comment markers", () => {
  it("passes pmk comments through as HTML comments (not escaped text)", () => {
    const md = fixture("anchored-doc.md");
    const { body } = stripFrontmatter(md);
    const html = createRenderer({}).render(body);

    // Markers must appear inside HTML comment syntax, not as escaped/visible text
    expect(html).not.toContain("&lt;!-- pmk:");
    expect(html).not.toContain("&lt;!--pmk:");
    // The escaped form that would appear if html:true were off
    expect(html).not.toContain("&lt;!--pmk:s");
    expect(html).not.toContain("&lt;!--pmk:b");
    expect(html).not.toContain("&lt;!--pmk:r");
    expect(html).not.toContain("&lt;!--pmk:c");
    expect(html).not.toContain("&lt;!-- pmk:review");
    expect(html).not.toContain("&lt;!-- /pmk:review");
    expect(html).not.toContain("&lt;!--/pmk:s");
  });

  it("renders anchored-doc without visible pmk text", async () => {
    const md = fixture("anchored-doc.md");
    const { body } = stripFrontmatter(md);
    const html = createRenderer({}).render(body);
    await expect(html).toMatchFileSnapshot(resolve(SNAPSHOTS, "anchored-doc.html"));
  });
});

describe("createRenderer — a span marker at a line start must not start an HTML block", () => {
  const O = "<!--pmk:s aaaaaaaa-->";
  const C = "<!--/pmk:s aaaaaaaa-->";
  const render = (src: string) => createRenderer({}).render(src);

  // CommonMark HTML block type 2: a line beginning with `<!--` is raw HTML until
  // `-->`, so every inline construct on that line stays literal. Inline-safety
  // snapping routinely pushes a span opener to the start of a block's content
  // line (selecting a bullet that opens with bold snaps left onto the `**`), so
  // the renderer must keep those lines on the inline path.
  const inlineBreakers: Array<[name: string, src: string]> = [
    ["bullet item opening with bold", `- ${O}**Bold lead.** rest of item${C}.\n`],
    ["ordered item opening with code", `1. ${O}\`code()\` and more${C} tail\n`],
    ["nested bullet opening with bold", `- outer\n  - ${O}**Bold.** inner${C} tail\n`],
    ["paragraph opening with bold", `${O}**Bold lead.** rest${C}.\n`],
    ["blockquote opening with bold", `> ${O}**Bold lead.** rest${C}.\n`],
    ["continuation line opening with code", `First line\n${O}\`code\` and **bold**${C} tail\n`],
    ["closer at a line start", `Lead ${O}text\n${C}**Bold** tail\n`],
  ];

  for (const [name, src] of inlineBreakers) {
    it(`parses inline markdown in a ${name}`, () => {
      const html = render(src);
      expect(html).not.toContain("**");
      expect(html).toMatch(/<strong>|<code[ >]/);
    });
  }

  it("keeps a span marker as an HTML comment, not escaped text", () => {
    const html = render(`- ${O}**Bold lead.** rest${C}.\n`);
    expect(html).toContain(O);
    expect(html).toContain(C);
    expect(html).not.toContain("&lt;!--");
  });

  it("still emits a lone block marker as its own HTML block", () => {
    // `pmk:b` / `pmk:r` own their line (the parser treats a shared line as
    // corruption), and injectHighlights matches `<!--pmk:b ID-->` immediately
    // followed by the next element's open tag. That must keep working.
    const html = render(`<!--pmk:b aaaaaaaa-->\n# Heading\n`);
    expect(html).toContain("<!--pmk:b aaaaaaaa-->");
    expect(html).not.toContain("<p><!--pmk:b");
    expect(html).toMatch(/<!--pmk:b aaaaaaaa-->\s*<h1/);
  });

  it("still emits lone range markers as their own HTML blocks", () => {
    const html = render(`<!--pmk:r aaaaaaaa o-->\nPara text\n\n<!--pmk:r aaaaaaaa c-->\n`);
    expect(html).toMatch(/<!--pmk:r aaaaaaaa o-->\s*<p[ >]/);
    expect(html).toContain("<!--pmk:r aaaaaaaa c-->");
    expect(html).not.toContain("<p><!--pmk:r");
  });

  it("leaves a non-pmk HTML comment at a line start as an HTML block", () => {
    const html = render(`<!-- a note -->**not bold**\n`);
    expect(html).toContain("**not bold**");
    expect(html).not.toContain("<strong>");
  });
});

describe("stripFrontmatter", () => {
  it("strips YAML frontmatter from output", () => {
    const md = fixture("frontmatter-doc.md");
    const { body, frontmatter } = stripFrontmatter(md);
    const html = createRenderer({}).render(body);

    // frontmatter key-value pairs must not appear in rendered HTML
    expect(html).not.toContain("title:");
    expect(html).not.toContain("status: draft");
    expect(html).not.toContain("date: 2026-06-13");
    // body content must appear
    expect(html).toContain("Document Body");
    expect(html).toContain("body content that should appear");
    // frontmatter is returned raw
    expect(frontmatter).toContain("title: Test Document");
  });

  it("returns null frontmatter for docs with no frontmatter", () => {
    const md = fixture("tables.md");
    const { body, frontmatter } = stripFrontmatter(md);
    expect(frontmatter).toBeNull();
    expect(body).toBe(md);
  });

  it("does not strip non-leading --- blocks", () => {
    const md = "# Heading\n\n---\n\nContent after hr.\n";
    const { body, frontmatter } = stripFrontmatter(md);
    expect(frontmatter).toBeNull();
    expect(body).toBe(md);
  });

  it("strips frontmatter with CRLF line endings (Windows-authored docs)", () => {
    const md = "---\r\ntitle: Test\r\n---\r\n# Body\r\n";
    const { body, frontmatter } = stripFrontmatter(md);
    expect(frontmatter).toContain("title: Test");
    expect(body).toContain("# Body");
    expect(body).not.toContain("title: Test");
  });
});

describe("tokenizeBlockOffsets — block line ranges for anchor placement (R7)", () => {
  it("reports each top-level block's source line range", () => {
    const src = "# Title\n\nFirst para.\n\nSecond para.\n";
    const blocks = tokenizeBlockOffsets(src);
    expect(blocks).toEqual([
      { line0: 0, line1: 1, type: "heading" },
      { line0: 2, line1: 3, type: "paragraph" },
      { line0: 4, line1: 5, type: "paragraph" },
    ]);
  });

  it("normalizes list, fence, table, blockquote, and html block types", () => {
    const src =
      "- a\n- b\n\n```ts\nconst x = 1;\n```\n\n| h |\n|---|\n| v |\n\n> quote\n\n<!-- c -->\n";
    const types = tokenizeBlockOffsets(src).map((b) => b.type);
    expect(types).toContain("list");
    expect(types).toContain("fence");
    expect(types).toContain("table");
    expect(types).toContain("blockquote");
    expect(types).toContain("html");
  });

  it("uses source-relative line numbers when frontmatter is present (R7 seam)", () => {
    // The host tokenizes the RAW source so offsets line up with the document the
    // WorkspaceEdit mutates. The paragraph after a 3-line frontmatter block must
    // report its real source line, not a body-relative one.
    const src = "---\ntitle: X\n---\n\nBody paragraph.\n";
    const blocks = tokenizeBlockOffsets(src);
    const para = blocks.find((b) => b.type === "paragraph");
    expect(para?.line0).toBe(4);
  });
});
