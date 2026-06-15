/**
 * Unit tests for commentBox.ts — the box that turns a selection into an
 * addComment message.
 *
 * Runs in the vitest "webview" project (jsdom environment).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  openCommentBox,
  closeCommentBox,
  isCommentBoxOpen,
  type CommentDraftStore,
} from "./commentBox.js";

const RANGE = { start: 10, end: 22 };
const QUOTE = "selected text";

function anchorEl(): HTMLElement {
  const el = document.createElement("span");
  document.body.appendChild(el);
  return el;
}

/** An in-memory draft store for the tests. */
function memStore(initial?: string): CommentDraftStore & { value: string | undefined } {
  return {
    value: initial,
    get() {
      return this.value;
    },
    set(body: string | undefined) {
      this.value = body;
    },
  };
}

function textarea(): HTMLTextAreaElement {
  return document.querySelector(".pmk-commentbox textarea") as HTMLTextAreaElement;
}

function submitBtn(): HTMLButtonElement {
  return document.querySelector(".pmk-commentbox button.primary") as HTMLButtonElement;
}

function cancelBtn(): HTMLButtonElement {
  return document.querySelector(".pmk-commentbox button:not(.primary)") as HTMLButtonElement;
}

describe("openCommentBox", () => {
  let post: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    document.body.innerHTML = "";
    post = vi.fn();
  });

  afterEach(() => {
    closeCommentBox();
  });

  it("opens a box with a textarea and Comment + Cancel buttons", () => {
    openCommentBox(anchorEl(), RANGE, QUOTE, post);

    expect(isCommentBoxOpen()).toBe(true);
    expect(textarea()).not.toBeNull();
    expect(submitBtn().textContent).toContain("Comment");
    expect(cancelBtn().textContent).toContain("Cancel");
  });

  it("submitting a body posts addComment with the range, quote, and body, then closes", () => {
    openCommentBox(anchorEl(), RANGE, QUOTE, post);
    textarea().value = "please clarify this";
    textarea().dispatchEvent(new Event("input", { bubbles: true }));
    submitBtn().click();

    expect(post).toHaveBeenCalledWith({
      v: 1,
      type: "addComment",
      range: RANGE,
      quote: QUOTE,
      body: "please clarify this",
    });
    expect(isCommentBoxOpen()).toBe(false);
  });

  it("does not post when the body is empty or whitespace", () => {
    openCommentBox(anchorEl(), RANGE, QUOTE, post);
    textarea().value = "   ";
    textarea().dispatchEvent(new Event("input", { bubbles: true }));
    submitBtn().click();

    expect(post).not.toHaveBeenCalled();
    expect(isCommentBoxOpen()).toBe(true); // stays open for the user to fix
  });

  it("Cancel closes without posting", () => {
    openCommentBox(anchorEl(), RANGE, QUOTE, post);
    textarea().value = "abandoned";
    textarea().dispatchEvent(new Event("input", { bubbles: true }));
    cancelBtn().click();

    expect(post).not.toHaveBeenCalled();
    expect(isCommentBoxOpen()).toBe(false);
  });

  it("Escape closes without posting", () => {
    openCommentBox(anchorEl(), RANGE, QUOTE, post);
    textarea().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(post).not.toHaveBeenCalled();
    expect(isCommentBoxOpen()).toBe(false);
  });

  it("persists the draft body as the user types and prefills it on open", () => {
    const store = memStore();
    openCommentBox(anchorEl(), RANGE, QUOTE, post, store);
    textarea().value = "half-written";
    textarea().dispatchEvent(new Event("input", { bubbles: true }));
    expect(store.value).toBe("half-written");

    // Re-open (e.g. after a reload) prefills from the store.
    closeCommentBox();
    openCommentBox(anchorEl(), RANGE, QUOTE, post, store);
    expect(textarea().value).toBe("half-written");
  });

  it("clears the draft on submit and on cancel", () => {
    const store = memStore("leftover");
    openCommentBox(anchorEl(), RANGE, QUOTE, post, store);
    textarea().value = "final body";
    textarea().dispatchEvent(new Event("input", { bubbles: true }));
    submitBtn().click();
    expect(store.value).toBeUndefined();

    const store2 = memStore("leftover2");
    openCommentBox(anchorEl(), RANGE, QUOTE, post, store2);
    cancelBtn().click();
    expect(store2.value).toBeUndefined();
  });

  it("opening a second box replaces the first", () => {
    openCommentBox(anchorEl(), RANGE, QUOTE, post);
    openCommentBox(anchorEl(), RANGE, QUOTE, post);
    expect(document.querySelectorAll(".pmk-commentbox").length).toBe(1);
  });
});
