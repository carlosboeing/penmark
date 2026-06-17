import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  renderFrontmatterCard,
  estimateReadingMinutes,
} from "./frontmatterCard.js";

describe("frontmatterCard", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="penmark-root"><p>word </p>'.repeat(50) + "</div>";
  });

  afterEach(() => {
    document.getElementById("pmk-frontmatter-card")?.remove();
  });

  it("estimateReadingMinutes returns at least 1", () => {
    expect(estimateReadingMinutes("one two three")).toBe(1);
    expect(estimateReadingMinutes("word ".repeat(500))).toBeGreaterThan(1);
  });

  it("renders tags and reading time", () => {
    renderFrontmatterCard(
      { title: "Doc", status: "draft", tags: ["a", "b"] },
      5,
    );
    const card = document.getElementById("pmk-frontmatter-card");
    expect(card).not.toBeNull();
    expect(document.querySelectorAll(".pmk-frontmatter-tag").length).toBe(2);
    expect(document.querySelector(".pmk-frontmatter-reading")?.textContent).toBe("5 min read");
  });

  it("removes card when fields are empty", () => {
    renderFrontmatterCard({ title: "x" }, 1);
    expect(document.getElementById("pmk-frontmatter-card")).not.toBeNull();
    renderFrontmatterCard(undefined);
    expect(document.getElementById("pmk-frontmatter-card")).toBeNull();
  });
});
