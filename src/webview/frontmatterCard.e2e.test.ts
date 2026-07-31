/**
 * Frontmatter parse-to-card coverage.
 *
 * The browser test for the card feeds it an ALREADY-PARSED object, so it cannot
 * see a parser that fails on real YAML — the card would simply render nothing
 * and the test would still pass. This drives the real parser output into the
 * real card, which is the path a user actually exercises.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { parseFrontmatterFields, stripFrontmatter } from "../core/render/frontmatter.js";
import { renderFrontmatterCard } from "./frontmatterCard.js";

const DOC = `---
date: 2026-07-26
title: Panel, search and typography bug bash
type: design
status: draft
authors:
  - Carlos Boeing
  - claude-opus-5 (claude-code)
scope:
  - webview
  - responsive
reviewed_by:
  - Carlos Boeing
related:
  - .workbench/2-design/2026-07-22-adaptive-review-ui-design.md
---

# Body
`;

function getFieldContent(key: string): string[] {
  for (const dt of document.querySelectorAll(".pmk-frontmatter-fields dt")) {
    if (dt.textContent === key) {
      const dd = dt.nextElementSibling;
      if (!dd) return [];
      const chips = dd.querySelectorAll(".pmk-frontmatter-chip");
      if (chips.length > 0) {
        return Array.from(chips).map((c) => c.textContent ?? "");
      }
      const listItems = dd.querySelectorAll(".pmk-frontmatter-list-item");
      if (listItems.length > 0) {
        return Array.from(listItems).map((li) => li.textContent ?? "");
      }
      return [dd.textContent ?? ""];
    }
  }
  return [];
}

describe("frontmatter document to card", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="penmark-root"></div>';
  });

  it("renders every block-sequence key with structured lists or chips", () => {
    const { frontmatter } = stripFrontmatter(DOC);
    renderFrontmatterCard(parseFrontmatterFields(frontmatter));

    expect(getFieldContent("title")).toEqual(["Panel, search and typography bug bash"]);
    expect(getFieldContent("status")).toEqual(["draft"]);
    expect(getFieldContent("authors")).toEqual(["Carlos Boeing", "claude-opus-5 (claude-code)"]);
    expect(getFieldContent("scope")).toEqual(["webview", "responsive"]);
    expect(getFieldContent("reviewed_by")).toEqual(["Carlos Boeing"]);
    expect(getFieldContent("related")).toEqual([".workbench/2-design/2026-07-22-adaptive-review-ui-design.md"]);
  });

  it("omits a key that genuinely has no value rather than showing a bare label", () => {
    const { frontmatter } = stripFrontmatter("---\ntitle: T\nauthors:\nstatus: draft\n---\n\nBody\n");
    renderFrontmatterCard(parseFrontmatterFields(frontmatter));

    const keys = Array.from(document.querySelectorAll(".pmk-frontmatter-fields dt")).map((dt) => dt.textContent);
    expect(keys).toEqual(["title", "status"]);
  });

  it("handles CRLF line endings", () => {
    const { frontmatter } = stripFrontmatter(DOC.replace(/\n/g, "\r\n"));
    renderFrontmatterCard(parseFrontmatterFields(frontmatter));

    expect(getFieldContent("authors")).toEqual(["Carlos Boeing", "claude-opus-5 (claude-code)"]);
  });
});
