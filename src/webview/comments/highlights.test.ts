/**
 * Unit tests for highlights.ts — wiring the host-injected highlight elements
 * (<mark class="pmk-hl">, [data-pmk-block], .pmk-hl-range) to gutter dots and the
 * click-to-open popover.
 *
 * Runs in the vitest "webview" project (jsdom environment).
 */
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import { installHighlights, scrollToCommentId } from "./highlights.js";
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

  it("exposes comment anchors as named keyboard buttons", () => {
    const mark = seedSpan(root, "abcdefgh");
    installHighlights(root, [comment({ author: "carlos" })], post);

    expect(mark.getAttribute("role")).toBe("button");
    expect(mark.getAttribute("aria-label")).toBe("Open comment by carlos");
    expect(mark.tabIndex).toBe(0);
  });

  it.each(["Enter", " "])("opens the popover with %s", (key) => {
    const mark = seedSpan(root, "abcdefgh");
    installHighlights(root, [comment()], post);
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });

    mark.dispatchEvent(event);

    expect(isPopoverOpen()).toBe(true);
    expect(event.defaultPrevented).toBe(key === " ");
  });

  it("does not hijack keyboard activation from a link inside a highlight", () => {
    const mark = seedSpan(root, "abcdefgh");
    const link = document.createElement("a");
    link.href = "#section";
    link.textContent = "linked words";
    mark.replaceChildren(link);
    installHighlights(root, [comment()], post);
    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });

    link.dispatchEvent(event);

    expect(isPopoverOpen()).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });

  it.each([
    ["button", () => document.createElement("button")],
    ["input", () => document.createElement("input")],
    ["select", () => document.createElement("select")],
    ["textarea", () => document.createElement("textarea")],
    ["contenteditable", () => {
      const el = document.createElement("span");
      el.setAttribute("contenteditable", "true");
      return el;
    }],
    ["tabindex", () => {
      const el = document.createElement("span");
      el.tabIndex = 0;
      return el;
    }],
  ])("does not hijack nested %s controls", (_name, createControl) => {
    const mark = seedSpan(root, "abcdefgh");
    const control = createControl();
    control.textContent = "native control";
    mark.replaceChildren(control);
    installHighlights(root, [comment()], post);

    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    control.dispatchEvent(click);
    const key = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
    control.dispatchEvent(key);

    expect(click.defaultPrevented).toBe(false);
    expect(key.defaultPrevented).toBe(false);
    expect(isPopoverOpen()).toBe(false);

    root.querySelector<HTMLButtonElement>(".pmk-highlight-action")!.click();
    expect(isPopoverOpen()).toBe(true);
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
    expect(table.getAttribute("role")).toBeNull();
    expect(table.getAttribute("tabindex")).toBeNull();
    const action = root.querySelector<HTMLButtonElement>(".pmk-highlight-action")!;
    expect(action.getAttribute("aria-label")).toBe("Open comment by carlos");
    action.click();
    expect(document.querySelector(".pmk-popover")!.textContent).toContain("block note");
  });

  it("preserves range semantics and gives the range a native keyboard action", () => {
    const range = document.createElement("div");
    range.className = "pmk-hl-range";
    range.setAttribute("data-pmk-id", "range001");
    range.setAttribute("data-pmk-state", "intact");
    range.append(document.createElement("p"));
    root.appendChild(range);

    installHighlights(root, [comment({ id: "range001" })], post);

    expect(range.getAttribute("role")).toBeNull();
    expect(range.getAttribute("tabindex")).toBeNull();
    const action = root.querySelector<HTMLButtonElement>(".pmk-highlight-action")!;
    expect(action.tagName).toBe("BUTTON");
    action.focus();
    action.click();
    expect(isPopoverOpen()).toBe(true);
  });

  it("uses the current structural comment after a subsequent install", () => {
    const table = document.createElement("table");
    table.setAttribute("data-pmk-id", "blk12345");
    table.setAttribute("data-pmk-state", "intact");
    table.setAttribute("data-pmk-block", "");
    root.appendChild(table);
    installHighlights(root, [comment({ id: "blk12345", body: "old body" })], post);

    installHighlights(
      root,
      [comment({ id: "blk12345", author: "updated", body: "edited body" })],
      post,
    );
    const action = root.querySelector<HTMLButtonElement>(".pmk-highlight-action")!;
    expect(action.getAttribute("aria-label")).toBe("Open comment by updated");
    action.click();

    expect(document.querySelector(".pmk-popover")?.textContent).toContain("edited body");
    expect(document.querySelector(".pmk-popover")?.textContent).not.toContain("old body");
  });

  it("removes a structural action when its comment leaves the current map", () => {
    const table = document.createElement("table");
    table.setAttribute("data-pmk-id", "blk12345");
    table.setAttribute("data-pmk-state", "intact");
    table.setAttribute("data-pmk-block", "");
    root.appendChild(table);
    installHighlights(root, [comment({ id: "blk12345" })], post);
    expect(root.querySelector(".pmk-highlight-action")).not.toBeNull();

    installHighlights(root, [], post);

    expect(root.querySelector(".pmk-highlight-action")).toBeNull();
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
    expect(mark.getAttribute("role")).toBeNull();
    expect(mark.getAttribute("tabindex")).toBeNull();
    link.click();

    expect(isPopoverOpen()).toBe(false);
    const action = root.querySelector<HTMLButtonElement>(".pmk-highlight-action")!;
    action.click();
    expect(isPopoverOpen()).toBe(true);
  });

  it("scrolls to comment IDs containing CSS selector metacharacters", () => {
    const hostileId = 'comment"\\]';
    const mark = seedSpan(root, hostileId);
    const scroll = vi.fn();
    mark.scrollIntoView = scroll;

    scrollToCommentId(hostileId);

    expect(scroll).toHaveBeenCalledOnce();
    expect(mark.classList.contains("pmk-hl-active")).toBe(true);
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
