import { describe, it, expect, beforeEach } from "vitest";
import { renderFrontmatterCard } from "./frontmatterCard.js";

describe("renderFrontmatterCard", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="penmark-root"></div>';
  });

  it("renders title, status chip, and tag chips", () => {
    renderFrontmatterCard({
      title: "Implementation Plan",
      status: "approved",
      tags: ["ui", "review"],
      author: "carlos",
    });

    const card = document.querySelector(".pmk-frontmatter-card") as HTMLDetailsElement;
    expect(card).not.toBeNull();
    expect(card.textContent).toContain("Implementation Plan");
    expect(card.querySelector(".pmk-frontmatter-status")?.textContent).toBe("approved");
    expect(Array.from(card.querySelectorAll(".pmk-frontmatter-tag")).map((x) => x.textContent)).toEqual([
      "ui",
      "review",
    ]);
  });

  it("removes the card when no frontmatter fields are present", () => {
    renderFrontmatterCard({ title: "Draft" });
    expect(document.querySelector(".pmk-frontmatter-card")).not.toBeNull();

    renderFrontmatterCard(undefined);
    expect(document.querySelector(".pmk-frontmatter-card")).toBeNull();
  });
});
