/**
 * Unit tests for highlights.ts — wiring the host-injected highlight elements
 * (<mark class="pmk-hl">, [data-pmk-block], .pmk-hl-range) to gutter dots and the
 * click-to-open popover.
 *
 * Runs in the vitest "webview" project (jsdom environment).
 */
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import { installHighlights } from "./highlights.js";
import { closeCommentPopover, isPopoverOpen } from "./popover.js";
import type { WireComment, WebviewToHost } from "../../core/protocol/messages.js";

function comment(over: Partial<WireComment> = {}): WireComment {
  return {
    id: "abcdefgh",
    state: "intact",
    provenance: "human",
    author: "carlos",
    timestamp: "2026-06-11 11:02 +10:00",
    quote: "eventual consistency",
    body: "Why eventual consistency?",
    extent: { startLine: 1, startCol: 0, endLine: 1, endCol: 20 },
    ...over,
  };
}

/** Seed a paragraph with an inline span highlight, mimicking injectHighlights. */
function seedSpan(root: HTMLElement, id: string, state = "intact"): HTMLElement {
  const p = document.createElement("p");
  p.appendChild(document.createTextNode("The service uses "));
  const mark = document.createElement("mark");
  mark.className = "pmk-hl";
  mark.setAttribute("data-pmk-id", id);
  mark.setAttribute("data-pmk-state", state);
  mark.textContent = "eventual consistency";
  p.appendChild(mark);
  root.appendChild(p);
  return mark;
}

describe("installHighlights", () => {
  let root: HTMLElement;
  let post: Mock<(msg: WebviewToHost) => void>;

  beforeEach(() => {
    document.body.innerHTML = "";
    root = document.createElement("div");
    root.id = "penmark-root";
    document.body.appendChild(root);
    post = vi.fn<(msg: WebviewToHost) => void>();
  });

  afterEach(() => {
    closeCommentPopover();
  });

  it("adds a gutter dot to the block containing a span highlight", () => {
    seedSpan(root, "abcdefgh");
    installHighlights(root, [comment()], post);

    const dots = root.querySelectorAll(".pmk-gutter-dot");
    expect(dots.length).toBe(1);
    // The dot lives on the paragraph (the block host), which becomes positioned.
    const p = root.querySelector("p")!;
    expect(p.querySelector(".pmk-gutter-dot")).not.toBeNull();
    expect(p.classList.contains("pmk-anchor")).toBe(true);
  });

  it("adds only one gutter dot to a block with two highlighted spans", () => {
    const p = document.createElement("p");
    for (const id of ["aaaa2345", "bbbb2345"]) {
      const mark = document.createElement("mark");
      mark.className = "pmk-hl";
      mark.setAttribute("data-pmk-id", id);
      mark.setAttribute("data-pmk-state", "intact");
      mark.textContent = "x";
      p.appendChild(mark);
    }
    root.appendChild(p);

    installHighlights(root, [comment({ id: "aaaa2345" }), comment({ id: "bbbb2345" })], post);

    expect(p.querySelectorAll(".pmk-gutter-dot").length).toBe(1);
  });

  it("opens the popover for the clicked span's comment", () => {
    const mark = seedSpan(root, "abcdefgh");
    installHighlights(root, [comment({ body: "the body text" })], post);

    mark.click();

    expect(isPopoverOpen()).toBe(true);
    expect(document.querySelector(".pmk-popover")!.textContent).toContain("the body text");
  });

  it("wires a block anchor element ([data-pmk-block]) to its popover and a dot", () => {
    const table = document.createElement("table");
    table.setAttribute("data-pmk-id", "blk12345");
    table.setAttribute("data-pmk-state", "intact");
    table.setAttribute("data-pmk-block", "");
    root.appendChild(table);

    installHighlights(root, [comment({ id: "blk12345", body: "block note" })], post);

    expect(
      table.querySelector(".pmk-gutter-dot") ?? root.querySelector(".pmk-gutter-dot"),
    ).not.toBeNull();
    table.click();
    expect(document.querySelector(".pmk-popover")!.textContent).toContain("block note");
  });

  it("is idempotent — re-install does not duplicate dots or stack popovers", () => {
    const mark = seedSpan(root, "abcdefgh");
    installHighlights(root, [comment()], post);
    installHighlights(root, [comment()], post);

    expect(root.querySelectorAll(".pmk-gutter-dot").length).toBe(1);
    mark.click();
    expect(document.querySelectorAll(".pmk-popover").length).toBe(1);
  });

  it("does not open the popover when a link inside the highlight is clicked", () => {
    const p = document.createElement("p");
    const mark = document.createElement("mark");
    mark.className = "pmk-hl";
    mark.setAttribute("data-pmk-id", "abcdefgh");
    mark.setAttribute("data-pmk-state", "intact");
    const link = document.createElement("a");
    link.href = "#section"; // hash href: jsdom treats this as a no-op, no navigation log
    link.textContent = "a link";
    mark.appendChild(link);
    p.appendChild(mark);
    root.appendChild(p);

    installHighlights(root, [comment()], post);
    link.click();

    expect(isPopoverOpen()).toBe(false);
  });

  it("ignores a highlight whose id is unknown to the comments array", () => {
    const mark = seedSpan(root, "ghost123");
    installHighlights(root, [comment({ id: "abcdefgh" })], post);

    expect(root.querySelectorAll(".pmk-gutter-dot").length).toBe(0);
    mark.click();
    expect(isPopoverOpen()).toBe(false);
  });

  it("does not open the popover when a highlight is clicked if it was resolved in a subsequent render", () => {
    const mark = seedSpan(root, "abcdefgh");
    installHighlights(root, [comment({ id: "abcdefgh" })], post);

    // First render/click works
    mark.click();
    expect(isPopoverOpen()).toBe(true);
    closeCommentPopover();

    // Re-render with resolved comment (no comments in the array)
    installHighlights(root, [], post);

    // Clicking the same element again (even if morphdom hasn't removed it yet) does not open popover
    mark.click();
    expect(isPopoverOpen()).toBe(false);
  });

  it("applies pmk-hl-active when the popover is open, and removes it when closed", () => {
    const mark = seedSpan(root, "abcdefgh");
    const comm = comment({ id: "abcdefgh" });
    installHighlights(root, [comm], post);

    expect(mark.classList.contains("pmk-hl-active")).toBe(false);

    mark.click();
    expect(isPopoverOpen()).toBe(true);
    expect(mark.classList.contains("pmk-hl-active")).toBe(true);

    closeCommentPopover();
    expect(isPopoverOpen()).toBe(false);
    expect(mark.classList.contains("pmk-hl-active")).toBe(false);
  });
});
