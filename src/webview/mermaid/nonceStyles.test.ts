import { describe, it, expect, beforeEach } from "vitest";
import {
  getScriptNonce,
  injectNonceIntoSvgStyles,
  prepareMermaidSvgForCsp,
} from "./nonceStyles.js";

describe("injectNonceIntoSvgStyles", () => {
  it("adds nonce to a bare <style> tag", () => {
    const svg = "<svg><style>.node{fill:#fff}</style></svg>";
    expect(injectNonceIntoSvgStyles(svg, "abc123")).toBe(
      '<svg><style nonce="abc123">.node{fill:#fff}</style></svg>',
    );
  });

  it("adds nonce to every <style> tag in the SVG", () => {
    const svg = '<svg><style type="text/css">.a{}</style><g/><style>.b{}</style></svg>';
    const out = injectNonceIntoSvgStyles(svg, "n1");
    expect(out).toBe(
      '<svg><style nonce="n1" type="text/css">.a{}</style><g/><style nonce="n1">.b{}</style></svg>',
    );
  });

  it("replaces an existing nonce attribute", () => {
    const svg = '<svg><style nonce="old">.x{}</style></svg>';
    expect(injectNonceIntoSvgStyles(svg, "new")).toBe('<svg><style nonce="new">.x{}</style></svg>');
  });

  it("is case-insensitive on the tag name", () => {
    const svg = "<svg><STYLE>.x{}</STYLE></svg>";
    expect(injectNonceIntoSvgStyles(svg, "n")).toContain('nonce="n"');
  });

  it("returns the input unchanged when nonce is empty", () => {
    const svg = "<svg><style>.x{}</style></svg>";
    expect(injectNonceIntoSvgStyles(svg, "")).toBe(svg);
  });
});

describe("getScriptNonce", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
  });

  it("reads nonce from the main bundle script", () => {
    const script = document.createElement("script");
    script.src = "/dist/webview/main.js";
    script.setAttribute("nonce", "harness-nonce");
    document.body.appendChild(script);
    expect(getScriptNonce()).toBe("harness-nonce");
  });

  it("falls back to any nonce-tagged script", () => {
    const script = document.createElement("script");
    script.setAttribute("nonce", "fallback");
    document.body.appendChild(script);
    expect(getScriptNonce()).toBe("fallback");
  });

  it("returns empty string when no nonce script exists", () => {
    expect(getScriptNonce()).toBe("");
  });
});

describe("prepareMermaidSvgForCsp", () => {
  it("injects nonce and sets foreignObject overflow", () => {
    const svg = '<svg><style>.x{}</style><foreignObject width="10"><div/></foreignObject></svg>';
    const out = prepareMermaidSvgForCsp(svg, "n");
    expect(out).toContain('<style nonce="n">');
    expect(out).toContain('<foreignObject overflow="visible" width="10">');
  });

  it("does not duplicate overflow when already present", () => {
    const svg = '<svg><foreignObject overflow="hidden" width="10"/></svg>';
    expect(prepareMermaidSvgForCsp(svg, "n")).toBe(svg);
  });
});
