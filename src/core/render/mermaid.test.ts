import { describe, it, expect } from "vitest";
import { createRenderer } from "./markdown.js";

const DIAGRAM = 'graph TD\n  A[Start] --> B{Is it <ok> & "safe"?}\n  B --> C[Done]';

describe("createRenderer — mermaid fence", () => {
  it("renders a mermaid fence as a container div when mermaid is enabled", () => {
    const html = createRenderer({ mermaid: true }).render("```mermaid\n" + DIAGRAM + "\n```\n");

    // Container div, not a <pre>.
    expect(html).toContain('<div class="pmk-mermaid"');
    expect(html).not.toContain("<pre");

    // Source is carried in an HTML-escaped data-pmk-source attribute so that
    // the angle brackets / ampersands / quotes in the diagram cannot break the
    // attribute or inject markup (XSS). The webview reads it back via dataset.
    expect(html).toContain("data-pmk-source=");
    expect(html).toContain("&lt;ok&gt;");
    expect(html).toContain("&amp;");
    expect(html).toContain("&quot;safe&quot;");
    // The raw, unescaped angle brackets must NOT appear in the attribute value.
    expect(html).not.toContain("<ok>");
  });

  it("stamps data-pmk-offset on the mermaid container (ADR 0005)", () => {
    const html = createRenderer({ mermaid: true }).render("```mermaid\ngraph TD\n  A --> B\n```\n");
    expect(html).toMatch(/<div class="pmk-mermaid"[^>]*data-pmk-offset="\d+:\d+"/);
  });

  it("renders a mermaid fence as a normal code block when mermaid is disabled", () => {
    const html = createRenderer({ mermaid: false }).render(
      "```mermaid\ngraph TD\n  A --> B\n```\n",
    );
    expect(html).not.toContain("pmk-mermaid");
    expect(html).toContain("<pre");
    expect(html).toContain("<code");
  });

  it("renders a mermaid fence as a normal code block when mermaid is omitted", () => {
    const html = createRenderer({}).render("```mermaid\ngraph TD\n  A --> B\n```\n");
    expect(html).not.toContain("pmk-mermaid");
    expect(html).toContain("<pre");
  });

  it("does not treat non-mermaid fences as diagrams when mermaid is enabled", () => {
    const html = createRenderer({ mermaid: true }).render("```js\nconst x = 1;\n```\n");
    expect(html).not.toContain("pmk-mermaid");
    expect(html).toContain("<pre");
  });
});
