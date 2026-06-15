import { describe, it, expect } from "vitest";
// sentinel: verifies the core test layer runs in Node (no DOM) and imports from src/core cleanly.

describe("core sentinel", () => {
  it("runs in node environment without DOM", () => {
    expect(typeof window).toBe("undefined");
  });

  it("imports src/core without error", async () => {
    const mod = await import("../../../src/core/index.js");
    expect(mod).toBeDefined();
  });
});
