import { describe, it, expect } from "vitest";
import { createTopbarIcon } from "./topbarIcons.js";

describe("createTopbarIcon", () => {
  it("returns a 16x16 svg with aria-hidden", () => {
    const svg = createTopbarIcon("sun");
    expect(svg.tagName).toBe("svg");
    expect(svg.getAttribute("width")).toBe("16");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
  });

  it("settings uses a gear outline with a center hole", () => {
    const svg = createTopbarIcon("settings");
    const gear = svg.querySelector("path");
    expect(gear?.getAttribute("d")).toMatch(/Z$/);
    expect(svg.querySelectorAll("circle").length).toBe(1);
  });

  it("auto uses a filled half-circle plus divider", () => {
    const svg = createTopbarIcon("auto");
    const filled = svg.querySelector('path[fill="currentColor"]');
    expect(filled).not.toBeNull();
    expect(svg.querySelectorAll("circle").length).toBe(1);
  });

  it("comments uses a single interior line", () => {
    const svg = createTopbarIcon("comments");
    expect(svg.querySelectorAll("path").length).toBe(2);
  });
});
