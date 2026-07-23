/**
 * Unit tests for commentBox.ts — the box that turns a selection into an
 * addComment message.
 *
 * Runs in the vitest "webview" project (jsdom environment).
 */
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import type { WebviewToHost } from "../../core/protocol/messages.js";
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

function validationError(): HTMLElement {
  return document.querySelector(".pmk-commentbox-error") as HTMLElement;
}

describe("openCommentBox", () => {
  let post: Mock<(msg: WebviewToHost) => void>;

  beforeEach(() => {
    document.body.innerHTML = "";
    post = vi.fn<(msg: WebviewToHost) => void>();
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

  it("preserves intentional leading and trailing whitespace in a non-empty body", () => {
    openCommentBox(anchorEl(), RANGE, QUOTE, post);
    textarea().value = "  preserve this spacing  \n";
    textarea().dispatchEvent(new Event("input", { bubbles: true }));
    submitBtn().click();

    expect(post).toHaveBeenCalledWith({
      v: 1,
      type: "addComment",
      range: RANGE,
      quote: QUOTE,
      body: "  preserve this spacing  \n",
    });
  });

  it("does not post when the body is empty or whitespace", () => {
    const store = memStore("   ");
    openCommentBox(anchorEl(), RANGE, QUOTE, post, store);
    textarea().value = "   ";
    textarea().dispatchEvent(new Event("input", { bubbles: true }));
    submitBtn().click();

    expect(post).not.toHaveBeenCalled();
    expect(isCommentBoxOpen()).toBe(true); // stays open for the user to fix
    expect(textarea()).toBe(document.activeElement);
    expect(textarea().getAttribute("aria-invalid")).toBe("true");
    expect(textarea().getAttribute("aria-describedby")).toBe(validationError().id);
    expect(validationError().getAttribute("role")).toBe("status");
    expect(validationError().getAttribute("aria-live")).toBe("polite");
    expect(validationError().textContent).toBe("Enter a comment before submitting.");
    expect(store.value).toBe("   ");
  });

  it.each([
    ["Cmd+Enter", { metaKey: true }],
    ["Ctrl+Enter", { ctrlKey: true }],
  ])("submits exactly once with %s, prevents a newline, clears the draft, and closes", (_name, modifier) => {
    const store = memStore();
    openCommentBox(anchorEl(), RANGE, QUOTE, post, store);
    textarea().value = "keyboard comment";
    textarea().dispatchEvent(new Event("input", { bubbles: true }));

    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
      ...modifier,
    });
    textarea().dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith({
      v: 1,
      type: "addComment",
      range: RANGE,
      quote: QUOTE,
      body: "keyboard comment",
    });
    expect(store.value).toBeUndefined();
    expect(isCommentBoxOpen()).toBe(false);
  });

  it("leaves bare Enter to the textarea", () => {
    openCommentBox(anchorEl(), RANGE, QUOTE, post);
    textarea().value = "first line";
    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });

    textarea().dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(post).not.toHaveBeenCalled();
    expect(isCommentBoxOpen()).toBe(true);
  });

  it("validates whitespace submitted with the keyboard without closing or discarding the draft", () => {
    const store = memStore("   ");
    openCommentBox(anchorEl(), RANGE, QUOTE, post, store);

    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    textarea().dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(post).not.toHaveBeenCalled();
    expect(isCommentBoxOpen()).toBe(true);
    expect(textarea()).toBe(document.activeElement);
    expect(validationError().textContent).toBe("Enter a comment before submitting.");
    expect(store.value).toBe("   ");
  });

  it("clears stale validation when input becomes non-whitespace", () => {
    openCommentBox(anchorEl(), RANGE, QUOTE, post);
    textarea().value = "   ";
    submitBtn().click();

    textarea().value = "now valid";
    textarea().dispatchEvent(new Event("input", { bubbles: true }));

    expect(textarea().hasAttribute("aria-invalid")).toBe(false);
    expect(textarea().hasAttribute("aria-describedby")).toBe(false);
    expect(validationError().hidden).toBe(true);
    expect(validationError().textContent).toBe("");
  });

  it("keeps validation visible while edited input remains whitespace-only", () => {
    openCommentBox(anchorEl(), RANGE, QUOTE, post);
    textarea().value = " ";
    submitBtn().click();

    textarea().value = "\t  \n";
    textarea().dispatchEvent(new Event("input", { bubbles: true }));

    expect(textarea().getAttribute("aria-invalid")).toBe("true");
    expect(textarea().getAttribute("aria-describedby")).toBe(validationError().id);
    expect(validationError().hidden).toBe(false);
    expect(validationError().textContent).toBe("Enter a comment before submitting.");
  });

  it.each([
    ["IME composition", { isComposing: true }],
    ["a repeated keydown", { repeat: true }],
  ])("ignores Cmd/Ctrl+Enter during %s", (_name, state) => {
    openCommentBox(anchorEl(), RANGE, QUOTE, post);
    textarea().value = "not ready";
    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
      ...state,
    });

    textarea().dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(post).not.toHaveBeenCalled();
    expect(isCommentBoxOpen()).toBe(true);
  });

  it("shows the keyboard shortcut beside the action without changing the button name", () => {
    openCommentBox(anchorEl(), RANGE, QUOTE, post);

    const shortcut = document.querySelector(".pmk-commentbox-shortcut") as HTMLElement;
    expect(submitBtn().textContent).toBe("Comment");
    expect(shortcut.textContent).toBe("Cmd/Ctrl+Enter");
    expect(shortcut.getAttribute("aria-hidden")).toBe("true");
    expect(shortcut.parentElement).toBe(submitBtn().parentElement);
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
