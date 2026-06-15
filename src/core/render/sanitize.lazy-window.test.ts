// @vitest-environment jsdom
/**
 * Tests for sanitize() lazy window resolution (global-window path).
 *
 * These tests run under the jsdom environment so that `window` is available as
 * a global. They reset the module between tests to ensure _instance is null,
 * forcing getInstance() to take the `typeof window !== "undefined"` branch.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

describe("sanitize — lazy global-window path (jsdom env)", () => {
  it("sanitizes via the global window without initSanitizer()", async () => {
    // Fresh module: _instance is null. jsdom provides window globally.
    // getInstance() must detect window and create the DOMPurify instance itself.
    const { sanitize } = await import("./sanitize.js");
    const out = sanitize("<p>hello</p><script>alert(1)</script>");
    expect(out).toContain("hello");
    expect(out).not.toMatch(/<script/i);
  });

  it("strips XSS and returns clean HTML using the lazy instance", async () => {
    const { sanitize } = await import("./sanitize.js");
    const out = sanitize('<img src="x" onerror="alert(1)"><p>safe</p>');
    expect(out).not.toMatch(/onerror/i);
    expect(out).toContain("safe");
  });

  it("returns empty string for empty input via lazy instance", async () => {
    const { sanitize } = await import("./sanitize.js");
    expect(sanitize("")).toBe("");
  });
});
