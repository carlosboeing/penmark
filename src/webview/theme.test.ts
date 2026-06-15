/**
 * Unit tests for theme.ts — resolveTheme, applyResolvedTheme, observeIdeTheme.
 *
 * Runs in the vitest "webview" project (jsdom environment).
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { resolveTheme, applyResolvedTheme, observeIdeTheme } from "./theme.js";

// ---------------------------------------------------------------------------
// resolveTheme — resolution matrix
// ---------------------------------------------------------------------------

describe("resolveTheme", () => {
  it("setting=light always returns 'light' regardless of body classes", () => {
    // Light overrides IDE dark classes
    expect(resolveTheme("light", ["vscode-dark"])).toBe("light");
    expect(resolveTheme("light", ["vscode-high-contrast"])).toBe("light");
    expect(resolveTheme("light", ["vscode-light"])).toBe("light");
    expect(resolveTheme("light", [])).toBe("light");
  });

  it("setting=dark always returns 'dark' regardless of body classes", () => {
    // Dark overrides IDE light classes
    expect(resolveTheme("dark", ["vscode-light"])).toBe("dark");
    expect(resolveTheme("dark", ["vscode-high-contrast-light"])).toBe("dark");
    expect(resolveTheme("dark", ["vscode-dark"])).toBe("dark");
    expect(resolveTheme("dark", [])).toBe("dark");
  });

  it("setting=auto maps vscode-dark to 'dark'", () => {
    expect(resolveTheme("auto", ["vscode-dark"])).toBe("dark");
  });

  it("setting=auto maps vscode-high-contrast to 'dark'", () => {
    expect(resolveTheme("auto", ["vscode-high-contrast"])).toBe("dark");
  });

  it("setting=auto maps vscode-light to 'light'", () => {
    expect(resolveTheme("auto", ["vscode-light"])).toBe("light");
  });

  it("setting=auto maps vscode-high-contrast-light to 'light'", () => {
    expect(resolveTheme("auto", ["vscode-high-contrast-light"])).toBe("light");
  });

  it("setting=auto defaults to 'light' when no IDE class is present", () => {
    expect(resolveTheme("auto", [])).toBe("light");
    expect(resolveTheme("auto", ["some-other-class"])).toBe("light");
  });

  it("setting=auto works with DOMTokenList-like objects (string[])", () => {
    expect(resolveTheme("auto", ["vscode-dark", "some-extra-class"])).toBe("dark");
  });
});

// ---------------------------------------------------------------------------
// applyResolvedTheme
// ---------------------------------------------------------------------------

describe("applyResolvedTheme", () => {
  beforeEach(() => {
    document.body.className = "";
    document.body.removeAttribute("data-theme");
  });

  it("sets data-theme=light and theme-light class when resolved=light", () => {
    applyResolvedTheme("light");
    expect(document.body.getAttribute("data-theme")).toBe("light");
    expect(document.body.classList.contains("theme-light")).toBe(true);
    expect(document.body.classList.contains("theme-dark")).toBe(false);
  });

  it("sets data-theme=dark and theme-dark class when resolved=dark", () => {
    applyResolvedTheme("dark");
    expect(document.body.getAttribute("data-theme")).toBe("dark");
    expect(document.body.classList.contains("theme-dark")).toBe(true);
    expect(document.body.classList.contains("theme-light")).toBe(false);
  });

  it("removes old theme class when switching from dark to light", () => {
    applyResolvedTheme("dark");
    applyResolvedTheme("light");
    expect(document.body.classList.contains("theme-dark")).toBe(false);
    expect(document.body.classList.contains("theme-light")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// observeIdeTheme
// ---------------------------------------------------------------------------

describe("observeIdeTheme", () => {
  afterEach(() => {
    document.body.className = "";
  });

  it("calls the callback when body class changes", async () => {
    const cb = vi.fn();
    const dispose = observeIdeTheme(cb);

    // Simulate IDE theme change
    document.body.className = "vscode-dark";

    // Wait for MutationObserver to fire (microtask)
    await new Promise((r) => setTimeout(r, 0));
    expect(cb).toHaveBeenCalled();

    dispose();
  });

  it("does not call callback after dispose", async () => {
    const cb = vi.fn();
    const dispose = observeIdeTheme(cb);
    dispose();

    document.body.className = "vscode-dark";
    await new Promise((r) => setTimeout(r, 0));
    expect(cb).not.toHaveBeenCalled();
  });
});
