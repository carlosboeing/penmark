/**
 * Unit tests for dom.ts — renderInto with morphdom incremental rendering
 * and webview-side sanitization (D5, D6).
 *
 * Runs in the vitest "webview" project (jsdom environment).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { initSanitizer } from "../core/render/sanitize.js";
import { renderInto } from "./dom.js";

// Bind DOMPurify to jsdom's window before any test.
beforeEach(() => {
  initSanitizer(window as unknown as Parameters<typeof initSanitizer>[0]);
});

describe("renderInto", () => {
  it("populates an empty root with the provided HTML", () => {
    const root = document.createElement("div");
    renderInto(root, "<p>Hello</p>");
    expect(root.querySelector("p")?.textContent).toBe("Hello");
  });

  it("replaces existing content on re-render", () => {
    const root = document.createElement("div");
    renderInto(root, "<p>First</p>");
    renderInto(root, "<p>Second</p>");
    expect(root.textContent).toContain("Second");
    expect(root.textContent).not.toContain("First");
  });

  it("preserves DOM node identity of unchanged blocks on incremental re-render", () => {
    const root = document.createElement("div");
    // Two blocks, both carrying data-pmk-offset
    renderInto(root, '<p data-pmk-offset="0:5">Block A</p><p data-pmk-offset="5:10">Block B</p>');

    // Capture a reference to the first block before re-render.
    const blockA = root.querySelector('[data-pmk-offset="0:5"]');
    expect(blockA).not.toBeNull();

    // Re-render with only the second block changed.
    renderInto(
      root,
      '<p data-pmk-offset="0:5">Block A</p><p data-pmk-offset="5:10">Block B CHANGED</p>',
    );

    // The unchanged block must be the SAME DOM node (morphdom preserves identity).
    const blockAAfter = root.querySelector('[data-pmk-offset="0:5"]');
    expect(blockAAfter).toBe(blockA);

    // The changed block must have updated text.
    const blockBAfter = root.querySelector('[data-pmk-offset="5:10"]');
    expect(blockBAfter?.textContent).toBe("Block B CHANGED");
  });

  it("strips <script> tags (XSS neutralization)", () => {
    const root = document.createElement("div");
    renderInto(root, "<p>Safe</p><script>window.__xss = true</script>");
    expect(root.querySelector("script")).toBeNull();
    expect((window as Window & { __xss?: boolean }).__xss).toBeUndefined();
  });

  it("strips onerror= event-handler attributes (XSS neutralization)", () => {
    const root = document.createElement("div");
    renderInto(root, '<img src="x" onerror="window.__xss2=1" />');
    const img = root.querySelector("img");
    expect(img?.getAttribute("onerror")).toBeNull();
    expect((window as Window & { __xss2?: number }).__xss2).toBeUndefined();
  });

  it("preserves data-pmk-offset attributes through sanitization", () => {
    const root = document.createElement("div");
    renderInto(root, '<p data-pmk-offset="0:10">Paragraph</p>');
    const p = root.querySelector("p");
    expect(p?.getAttribute("data-pmk-offset")).toBe("0:10");
  });

  it("renders empty string without throwing", () => {
    const root = document.createElement("div");
    expect(() => renderInto(root, "")).not.toThrow();
  });

  it("strips inline style attributes before DOM insertion (CSP)", () => {
    const root = document.createElement("div");
    renderInto(
      root,
      '<h1 style="color:white;background:white">Title</h1><p style="display:none">x</p>',
    );
    expect(root.querySelectorAll("[style]").length).toBe(0);
    expect(root.querySelector("h1")?.textContent).toBe("Title");
  });

  it("replaces bootstrap loading placeholder on first paint", () => {
    const root = document.createElement("div");
    root.innerHTML = '<p class="pmk-loading">Loading preview…</p>';
    renderInto(root, "<h1>Title</h1><p>Body</p>");
    expect(root.querySelector(".pmk-loading")).toBeNull();
    expect(root.textContent).toContain("Title");
    expect(root.textContent).toContain("Body");
  });

  it("uses bootstrap fast path only for the loading placeholder", () => {
    const root = document.createElement("div");
    root.innerHTML = "<p>Existing</p>";
    renderInto(root, "<p>Replaced</p>");
    expect(root.textContent).toBe("Replaced");
  });
});
