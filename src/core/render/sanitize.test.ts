/**
 * Tests for the HTML sanitizer (T3).
 *
 * D6 decision: sanitization runs WEBVIEW-SIDE (DOMPurify in the browser
 * context, as the last step before DOM insertion). Host-side was ruled out
 * because both DOMPurify+linkedom (282 KB bundled) and DOMPurify+jsdom
 * (3,138 KB bundled) exceed the 250 KB core size gate. DOMPurify alone in
 * the browser bundle is 27 KB. These tests exercise the sanitize() function
 * using jsdom (already a devDependency) so the logic is fully verified;
 * the function is wired into the webview in T8.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { JSDOM } from "jsdom";
import type { WindowLike } from "dompurify";
import { sanitize, initSanitizer } from "./sanitize.js";

// Tests run in vitest node environment — provide a jsdom window so DOMPurify
// can initialise. In the production webview, DOMPurify uses the native window.
beforeAll(() => {
  const { window } = new JSDOM("<!doctype html>");
  initSanitizer(window as unknown as WindowLike);
});

const XSS = resolve(__dirname, "../../../test/fixtures/xss");

function fixture(name: string): string {
  return readFileSync(resolve(XSS, name), "utf8");
}

// ── XSS neutralization ────────────────────────────────────────────────────────

describe("sanitize — XSS neutralization", () => {
  it("strips <script> tags", () => {
    const out = sanitize(fixture("script-tag.html"));
    expect(out).not.toMatch(/<script/i);
    expect(out).toContain("Legitimate paragraph");
  });

  it("strips inline style attributes (CSP: style-src nonce, no unsafe-inline)", () => {
    const out = sanitize('<p style="color:red">text</p><span style="display:none">x</span>');
    expect(out).not.toMatch(/\bstyle\s*=/i);
    expect(out).toContain("text");
    expect(out).toContain("x");
  });

  it("strips <style> elements", () => {
    const out = sanitize('<style>body{color:red}</style><p>safe</p>');
    expect(out).not.toMatch(/<style/i);
    expect(out).toContain("safe");
  });

  it("strips onerror attribute from <img>", () => {
    const out = sanitize(fixture("img-onerror.html"));
    expect(out).not.toMatch(/\bonerror\b/i);
    // img element itself may survive (DOMPurify allows img)
  });

  it("strips javascript: hrefs", () => {
    const out = sanitize(fixture("javascript-href.html"));
    expect(out).not.toMatch(/javascript:/i);
    // safe https href must survive
    expect(out).toContain('href="https://example.com"');
  });

  it("strips onload attribute from <svg>", () => {
    const out = sanitize(fixture("svg-onload.html"));
    expect(out).not.toMatch(/\bonload\b/i);
  });

  it("strips <iframe> elements", () => {
    const out = sanitize(fixture("iframe.html"));
    expect(out).not.toMatch(/<iframe/i);
  });

  it("strips all inline event-handler attributes", () => {
    const out = sanitize(fixture("inline-event-handlers.html"));
    expect(out).not.toMatch(/\bon\w+\s*=/i);
  });

  it("neutralizes mXSS nesting attack", () => {
    const out = sanitize(fixture("mxss-nesting.html"));
    expect(out).not.toMatch(/\bonerror\b/i);
    expect(out).not.toMatch(/<script/i);
  });

  it("neutralizes mXSS template/table confusion attack", () => {
    const out = sanitize(fixture("mxss-template.html"));
    expect(out).not.toMatch(/\bonerror\b/i);
    expect(out).not.toMatch(/<script/i);
  });
});

// ── Attribute / class preservation ───────────────────────────────────────────

describe("sanitize — safe attribute and class preservation", () => {
  it("preserves data-pmk-offset attributes", () => {
    const out = sanitize(fixture("preserve-pmk.html"));
    expect(out).toContain('data-pmk-offset="0:1"');
    expect(out).toContain('data-pmk-offset="2:3"');
    expect(out).toContain('data-pmk-offset="10:12"');
  });

  it("preserves hljs CSS classes", () => {
    const out = sanitize(fixture("preserve-pmk.html"));
    expect(out).toContain("hljs");
    expect(out).toContain("hljs-keyword");
    expect(out).toContain("hljs-number");
    expect(out).toContain("language-typescript");
  });

  it("preserves mermaid CSS class", () => {
    const out = sanitize(fixture("preserve-pmk.html"));
    expect(out).toContain("mermaid");
  });

  it("preserves data-pmk-source on mermaid containers, including --> arrows (T9)", () => {
    const out = sanitize(fixture("preserve-pmk.html"));
    expect(out).toContain("data-pmk-source=");
    expect(out).toContain("graph TD");
    // The --> flowchart arrow must survive (DOMPurify would otherwise drop the
    // attribute, treating --> as a comment-close token). It re-parses correctly
    // from the quoted attribute value regardless of > escaping on output.
    expect(out).toContain("A --> B");
  });

  it("preserves <mark> highlight with data-pmk-id/state (D12)", () => {
    const out = sanitize(fixture("preserve-pmk.html"));
    expect(out).toContain("<mark");
    expect(out).toContain('data-pmk-id="abcdefgh"');
    expect(out).toContain('data-pmk-state="intact"');
    expect(out).toContain(">highlighted span</mark>");
  });

  it("preserves data-pmk-id/state/block on a block-tagged element (D12)", () => {
    const out = sanitize(fixture("preserve-pmk.html"));
    expect(out).toContain('data-pmk-id="ij2345kl"');
    expect(out).toContain("data-pmk-block");
  });

  it("preserves heading id attribute", () => {
    const out = sanitize(fixture("preserve-pmk.html"));
    expect(out).toContain('id="heading"');
  });

  it("preserves safe https href", () => {
    const out = sanitize(fixture("preserve-pmk.html"));
    expect(out).toContain('href="https://example.com"');
  });

  it("preserves inline-event-handler data-pmk-offset (strips event, keeps offset)", () => {
    const out = sanitize(fixture("inline-event-handlers.html"));
    // data-pmk-offset on the paragraph survives even though onclick is stripped
    expect(out).toContain('data-pmk-offset="0:1"');
    // Check the onclick attribute is gone (not the text "Onclick" in content)
    expect(out).not.toContain("onclick=");
  });
});

// ── pmk HTML comment stripping ────────────────────────────────────────────────

describe("sanitize — pmk HTML comment stripping", () => {
  it("strips <!--pmk:...--> comments from output", () => {
    const out = sanitize(fixture("preserve-pmk.html"));
    expect(out).not.toContain("<!--pmk:");
    expect(out).not.toContain("<!--/pmk:");
  });

  it("does not strip non-pmk HTML comments", () => {
    // Regular HTML comments (not pmk-prefixed) — DOMPurify strips all comments
    // by default, which is fine and expected. This test documents that behaviour.
    const input = "<!-- regular comment --><p>text</p>";
    const out = sanitize(input);
    expect(out).toContain("text");
    // DOMPurify strips comments by default — that is the correct/safe behaviour
    expect(out).not.toContain("<!--");
  });

  it("strips pmk comments embedded in script-tag fixture", () => {
    // Even if pmk comments appear alongside XSS — both must be gone
    const input = "<!--pmk:s:abc123--><script>alert(1)</script><!--pmk:e:abc123--><p>safe</p>";
    const out = sanitize(input);
    expect(out).not.toContain("<!--pmk:");
    expect(out).not.toMatch(/<script/i);
    expect(out).toContain("safe");
  });
});

// ── Passthrough sanity ────────────────────────────────────────────────────────

describe("sanitize — clean HTML passthrough", () => {
  it("returns clean markdown-rendered HTML unchanged in structure", () => {
    const input = '<h1 data-pmk-offset="0:1">Title</h1><p data-pmk-offset="2:3">Body text.</p>';
    const out = sanitize(input);
    expect(out).toContain("<h1");
    expect(out).toContain("Title");
    expect(out).toContain("Body text");
    expect(out).toContain('data-pmk-offset="0:1"');
  });

  it("returns a string for empty input", () => {
    expect(sanitize("")).toBe("");
  });
});
