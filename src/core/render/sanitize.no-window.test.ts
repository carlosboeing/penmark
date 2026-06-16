// @vitest-environment node
/**
 * Tests for sanitize() no-window throw guard.
 *
 * Runs under the node environment (no global window). With _instance reset to
 * null via vi.resetModules(), getInstance() must reach the throw branch.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

describe("sanitize — no-window throw guard (node env)", () => {
  it("throws with the expected message when no window is available", async () => {
    // node environment: typeof window === "undefined". Fresh module: _instance null.
    const { sanitize } = await import("./sanitize.js");
    expect(() => sanitize("<p>x</p>")).toThrow(
      "sanitize(): no window available. Call initSanitizer(window) before use in non-browser environments.",
    );
  });
});
