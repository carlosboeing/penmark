import { describe, it, expect } from "vitest";
import { createRenderer } from "./markdown.js";
import { highlight } from "../../hljs.js";

describe("createRenderer — syntax highlighting hook", () => {
  it("emits hljs token spans for a language-tagged fence", () => {
    const md = "```ts\nconst greet = (name: string) => name;\n```\n";
    const html = createRenderer({ highlight }).render(md);
    // highlight.js wraps tokens in spans like <span class="hljs-keyword">.
    expect(html).toContain('class="hljs-keyword"');
    expect(html).toContain("<code");
  });

  it("falls back to plain escaped <code> for an unknown language (no crash)", () => {
    const md = "```not-a-real-language\nsome plain text & <stuff>\n```\n";
    const render = () => createRenderer({ highlight }).render(md);
    expect(render).not.toThrow();
    const html = render();
    // No hljs token spans for an unknown language.
    expect(html).not.toContain("hljs-");
    expect(html).toContain("<code");
    // markdown-it default escaping applied to the raw code.
    expect(html).toContain("&amp;");
    expect(html).toContain("&lt;stuff&gt;");
  });

  it("renders plain <code> when no highlight hook is supplied", () => {
    const md = "```ts\nconst x = 1;\n```\n";
    const html = createRenderer({}).render(md);
    expect(html).not.toContain("hljs-");
    expect(html).toContain("<code");
  });
});
