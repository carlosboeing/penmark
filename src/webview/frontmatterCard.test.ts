import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderFrontmatterCard } from "./frontmatterCard.js";

describe("renderFrontmatterCard", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="penmark-root"></div>';
  });

  it("renders title, status chip, tag chips, and sets status dataset attribute", () => {
    renderFrontmatterCard({
      title: "Implementation Plan",
      status: "approved",
      tags: ["ui", "review"],
      author: "carlos",
    });

    const card = document.querySelector(".pmk-frontmatter-card") as HTMLDetailsElement;
    expect(card).not.toBeNull();
    expect(card.dataset.status).toBe("approved");
    expect(card.textContent).toContain("Implementation Plan");
    expect(card.querySelector(".pmk-frontmatter-status")?.textContent).toBe("approved");
    expect(Array.from(card.querySelectorAll(".pmk-frontmatter-tag")).map((x) => x.textContent)).toEqual([
      "ui",
      "review",
    ]);
  });

  it("renders scope as a tag group and authors/related as vertical lists with path formatting", () => {
    renderFrontmatterCard({
      title: "Observability Spec",
      status: "shipped",
      scope: ["monitoring", "logging"],
      authors: ["Carlos Boeing", "gemini-3.6-flash (agy)"],
      related: ["docs/0-brainstorms/logging.md", "skills/SKILL.md"],
    });

    const card = document.querySelector(".pmk-frontmatter-card") as HTMLDetailsElement;
    expect(card).not.toBeNull();

    const tagGroup = card.querySelector(".pmk-frontmatter-tag-group");
    expect(tagGroup).not.toBeNull();
    expect(Array.from(tagGroup!.querySelectorAll(".pmk-frontmatter-chip")).map((x) => x.textContent)).toEqual([
      "monitoring",
      "logging",
    ]);

    const lists = card.querySelectorAll(".pmk-frontmatter-list");
    expect(lists.length).toBe(2);

    const authorsList = lists[0]!;
    expect(Array.from(authorsList.querySelectorAll("li")).map((x) => x.textContent)).toEqual([
      "Carlos Boeing",
      "gemini-3.6-flash (agy)",
    ]);

    const paths = Array.from(card.querySelectorAll(".pmk-frontmatter-path")).map(
      (a) => (a as HTMLAnchorElement).getAttribute("href")
    );
    expect(paths).toEqual(["docs/0-brainstorms/logging.md", "skills/SKILL.md"]);
  });

  it("intercepts path clicks and dispatches openLink postMessage", () => {
    const postMessage = vi.fn();
    (window as unknown as { vscode?: { postMessage: (msg: unknown) => void } }).vscode = { postMessage };

    renderFrontmatterCard({
      title: "Navigation Test",
      related: ["skills/schedule-resume/SKILL.md"],
    });

    const pathLink = document.querySelector(".pmk-frontmatter-path") as HTMLAnchorElement;
    expect(pathLink).not.toBeNull();

    pathLink.click();

    expect(postMessage).toHaveBeenCalledWith({
      v: 1,
      type: "openLink",
      href: "skills/schedule-resume/SKILL.md",
    });
  });

  it("removes the card when no frontmatter fields are present", () => {
    renderFrontmatterCard({ title: "Draft" });
    expect(document.querySelector(".pmk-frontmatter-card")).not.toBeNull();

    renderFrontmatterCard(undefined);
    expect(document.querySelector(".pmk-frontmatter-card")).toBeNull();
  });
});
