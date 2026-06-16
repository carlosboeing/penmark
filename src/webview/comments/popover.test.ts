/**
 * Unit tests for popover.ts — the comment popover opened by clicking a highlight.
 *
 * Runs in the vitest "webview" project (jsdom environment).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { openCommentPopover, closeCommentPopover, isPopoverOpen } from "./popover.js";
import type { WireComment } from "../../core/protocol/messages.js";

function comment(over: Partial<WireComment> = {}): WireComment {
  return {
    id: "abcdefgh",
    state: "intact",
    provenance: "human",
    author: "carlos",
    timestamp: "2026-06-11 11:02 +10:00",
    quote: "eventual consistency",
    body: "Why eventual consistency on the read path?",
    extent: { startLine: 1, startCol: 0, endLine: 1, endCol: 20 },
    ...over,
  };
}

function anchorEl(): HTMLElement {
  const el = document.createElement("mark");
  el.className = "pmk-hl";
  el.textContent = "eventual consistency";
  document.body.appendChild(el);
  return el;
}

describe("openCommentPopover", () => {
  let post: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    document.body.innerHTML = "";
    post = vi.fn();
  });

  afterEach(() => {
    closeCommentPopover();
  });

  it("renders the author, timestamp, and body", () => {
    openCommentPopover(anchorEl(), comment(), post);

    const pop = document.querySelector(".pmk-popover");
    expect(pop).not.toBeNull();
    expect(pop!.textContent).toContain("carlos");
    expect(pop!.textContent).toContain("Why eventual consistency on the read path?");
    expect(pop!.querySelector(".pmk-popover-when")!.textContent).toContain("2026-06-11");
  });

  it("shows a human avatar with the author initial for human provenance", () => {
    openCommentPopover(anchorEl(), comment({ provenance: "human", author: "carlos" }), post);

    const avatar = document.querySelector(".pmk-avatar")!;
    expect(avatar.classList.contains("pmk-avatar-human")).toBe(true);
    expect(avatar.classList.contains("pmk-avatar-agent")).toBe(false);
    expect(avatar.textContent).toBe("C");
  });

  it("shows an agent avatar for agent provenance", () => {
    openCommentPopover(anchorEl(), comment({ provenance: "agent", author: "claude-code" }), post);

    const avatar = document.querySelector(".pmk-avatar")!;
    expect(avatar.classList.contains("pmk-avatar-agent")).toBe(true);
    expect(avatar.textContent).toBe("C");
  });

  it("Resolve posts resolveComment with the comment id and closes the popover", () => {
    openCommentPopover(anchorEl(), comment({ id: "zzzz2345" }), post);

    const resolve = document.querySelector(
      ".pmk-popover-actions button.primary",
    ) as HTMLButtonElement;
    expect(resolve.textContent).toContain("Resolve");
    resolve.click();

    expect(post).toHaveBeenCalledWith({ v: 1, type: "resolveComment", id: "zzzz2345" });
    expect(isPopoverOpen()).toBe(false);
    expect(document.querySelector(".pmk-popover")).toBeNull();
  });

  it("closes on Escape", () => {
    openCommentPopover(anchorEl(), comment(), post);
    expect(isPopoverOpen()).toBe(true);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(isPopoverOpen()).toBe(false);
    expect(document.querySelector(".pmk-popover")).toBeNull();
  });

  it("closes on an outside click but not on a click inside the popover", () => {
    openCommentPopover(anchorEl(), comment(), post);
    const pop = document.querySelector(".pmk-popover") as HTMLElement;

    // Click inside — stays open.
    pop.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(isPopoverOpen()).toBe(true);

    // Click elsewhere — closes.
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(isPopoverOpen()).toBe(false);
  });

  it("surfaces an 'edited since commented' affordance for degraded-recovered comments", () => {
    openCommentPopover(anchorEl(), comment({ state: "degraded-recovered" }), post);

    const note = document.querySelector(".pmk-popover-note");
    expect(note).not.toBeNull();
    expect(note!.textContent!.toLowerCase()).toContain("edited");
  });

  it("does not show the edited note for intact comments", () => {
    openCommentPopover(anchorEl(), comment({ state: "intact" }), post);
    expect(document.querySelector(".pmk-popover-note")).toBeNull();
  });

  it("opening a second popover replaces the first (only one open at a time)", () => {
    openCommentPopover(anchorEl(), comment({ id: "aaaa2345", body: "first" }), post);
    openCommentPopover(anchorEl(), comment({ id: "bbbb2345", body: "second" }), post);

    const pops = document.querySelectorAll(".pmk-popover");
    expect(pops.length).toBe(1);
    expect(pops[0]!.textContent).toContain("second");
  });

  it("clicks Edit to switch to edit mode, Cancel to return to view mode", () => {
    openCommentPopover(anchorEl(), comment({ body: "original text" }), post);
    const pop = document.querySelector(".pmk-popover")!;
    
    // Check it starts in view mode
    expect(pop.querySelector("textarea")).toBeNull();
    
    // Click Edit
    const editBtn = Array.from(pop.querySelectorAll("button")).find(
      (b) => b.textContent === "Edit"
    ) as HTMLButtonElement;
    expect(editBtn).not.toBeUndefined();
    editBtn.click();
    
    // Now in edit mode
    const ta = pop.querySelector("textarea") as HTMLTextAreaElement;
    expect(ta).not.toBeNull();
    expect(ta.value).toBe("original text");
    
    // Click Cancel
    const cancelBtn = Array.from(pop.querySelectorAll("button")).find(
      (b) => b.textContent === "Cancel"
    ) as HTMLButtonElement;
    expect(cancelBtn).not.toBeUndefined();
    cancelBtn.click();
    
    // Back in view mode
    expect(pop.querySelector("textarea")).toBeNull();
    expect(pop.textContent).toContain("original text");
  });

  it("clicks Save to post editComment message to host and close popover", () => {
    openCommentPopover(anchorEl(), comment({ id: "aaaa2345", body: "original text" }), post);
    const pop = document.querySelector(".pmk-popover")!;
    
    // Click Edit
    const editBtn = Array.from(pop.querySelectorAll("button")).find(
      (b) => b.textContent === "Edit"
    ) as HTMLButtonElement;
    editBtn.click();
    
    // Modify text
    const ta = pop.querySelector("textarea") as HTMLTextAreaElement;
    ta.value = "  new comment text  ";
    
    // Click Save
    const saveBtn = Array.from(pop.querySelectorAll("button")).find(
      (b) => b.textContent === "Save"
    ) as HTMLButtonElement;
    expect(saveBtn).not.toBeUndefined();
    saveBtn.click();
    
    expect(post).toHaveBeenCalledWith({
      v: 1,
      type: "editComment",
      id: "aaaa2345",
      body: "new comment text",
    });
    expect(isPopoverOpen()).toBe(false);
  });

  it("opens directly in edit mode when editMode=true, Cancel closes popover", () => {
    openCommentPopover(anchorEl(), comment({ body: "some text" }), post, true);
    const pop = document.querySelector(".pmk-popover")!;
    
    // Starts in edit mode
    const ta = pop.querySelector("textarea") as HTMLTextAreaElement;
    expect(ta).not.toBeNull();
    expect(ta.value).toBe("some text");
    
    // Click Cancel
    const cancelBtn = Array.from(pop.querySelectorAll("button")).find(
      (b) => b.textContent === "Cancel"
    ) as HTMLButtonElement;
    cancelBtn.click();
    
    // Popover is closed
    expect(isPopoverOpen()).toBe(false);
  });
});
