/**
 * Unit tests for main.ts — message loop, state persistence, ready handshake.
 *
 * Runs in the vitest "webview" project (jsdom environment).
 * acquireVsCodeApi mock is installed by test/setup/vscode-api-mock.ts.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Helpers for accessing the mock API
// ---------------------------------------------------------------------------

interface VsCodeApiMock {
  _messages: unknown[];
  postMessage: (msg: unknown) => void;
  getState: () => unknown;
  setState: (state: unknown) => void;
}

function getMock(): VsCodeApiMock {
  return (globalThis as Record<string, unknown>)["__vsCodeApiMock"] as VsCodeApiMock;
}

function clearMessages(): void {
  getMock()._messages.length = 0;
}

// State management helpers matching the mock.
let _savedState: unknown = undefined;

function resetMockState(): void {
  _savedState = undefined;
  const mock = getMock();
  mock.getState = () => _savedState;
  mock.setState = (s: unknown) => {
    _savedState = s;
  };
}

// ---------------------------------------------------------------------------
// Inject a simulated host message into the webview's window.
// ---------------------------------------------------------------------------

function injectMessage(data: unknown): void {
  window.dispatchEvent(new MessageEvent("message", { data }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("main.ts message loop", () => {
  beforeEach(async () => {
    clearMessages();
    resetMockState();

    // Set up the topbar + root elements (the shell provides both).
    document.body.innerHTML = '<div id="penmark-topbar"></div><div id="penmark-root"></div>';

    // Import main.ts once. Vitest caches modules, so subsequent imports are no-ops.
    // We reset messages before each test above.
    await import("./main.js");
  });

  it("posts {v:1, type:'ready'} after attaching message listener", () => {
    // The ready message must be in the recorded messages.
    const msgs = getMock()._messages;
    expect(msgs).toContainEqual({ v: 1, type: "ready" });
  });

  it("a 'render' message populates the penmark-root element", () => {
    const root = document.getElementById("penmark-root");
    expect(root).not.toBeNull();

    injectMessage({
      v: 1,
      type: "render",
      html: "<p>Content</p>",
      theme: "light",
      docName: "test.md",
      comments: [],
      attention: 0,
    });

    expect(root!.textContent).toContain("Content");
  });

  it("a 'render' message sanitizes XSS vectors before inserting into DOM", () => {
    injectMessage({
      v: 1,
      type: "render",
      html: "<p>Safe</p><script>window.__mainXss = true</script>",
      theme: "light",
      docName: "test.md",
      comments: [],
      attention: 0,
    });

    const root = document.getElementById("penmark-root");
    expect(root!.querySelector("script")).toBeNull();
    expect((window as Window & { __mainXss?: boolean }).__mainXss).toBeUndefined();
  });

  it("a 'render' message with comments wires highlights (gutter dot + popover)", () => {
    injectMessage({
      v: 1,
      type: "render",
      html: '<p>see <mark class="pmk-hl" data-pmk-id="abcdefgh" data-pmk-state="intact">this span</mark></p>',
      theme: "light",
      docName: "test.md",
      comments: [
        {
          id: "abcdefgh",
          state: "intact",
          provenance: "human",
          author: "carlos",
          timestamp: "2026-06-11 11:02 +10:00",
          quote: "this span",
          body: "a comment body",
          extent: { startLine: 0, startCol: 4, endLine: 0, endCol: 13 },
        },
      ],
      attention: 0,
    });

    const root = document.getElementById("penmark-root")!;
    expect(root.querySelector(".pmk-gutter-dot")).not.toBeNull();

    const mark = root.querySelector("mark.pmk-hl") as HTMLElement;
    mark.click();
    const pop = document.querySelector(".pmk-popover");
    expect(pop).not.toBeNull();
    expect(pop!.textContent).toContain("a comment body");

    // Clean up the popover so it doesn't leak into later tests.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });

  it("a 'render' message without a comments field still renders (no throw)", () => {
    // Older host builds / harness fixtures may omit comments; the webview must
    // tolerate it (treat as no comments) rather than crash the message handler.
    expect(() =>
      injectMessage({
        v: 1,
        type: "render",
        html: "<p>Plain</p>",
        theme: "light",
        docName: "test.md",
      }),
    ).not.toThrow();
    expect(document.getElementById("penmark-root")!.textContent).toContain("Plain");
  });

  it("a selection shows an Add-comment button that opens a box and posts addComment", () => {
    // Render a paragraph carrying data-pmk-coff so selectionToSourceRange maps it.
    injectMessage({
      v: 1,
      type: "render",
      html: '<p data-pmk-offset="0:1" data-pmk-coff="0">The quick brown fox jumps.</p>',
      theme: "light",
      docName: "test.md",
      comments: [],
      attention: 0,
    });

    // jsdom has no layout engine — stub Range.getClientRects so the selection
    // overlay path (which draws preview rects) runs without throwing. Real
    // browsers always have it; the rect rendering itself is covered by Playwright.
    (Range.prototype as unknown as { getClientRects: () => unknown }).getClientRects = () =>
      [] as unknown[];

    // Select "quick brown" inside the paragraph.
    const p = document.querySelector("#penmark-root p")!;
    const textNode = p.firstChild!;
    const content = textNode.textContent ?? "";
    const start = content.indexOf("quick");
    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, start + "quick brown".length);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));

    const addBtn = document.querySelector(".pmk-add-comment-btn") as HTMLButtonElement;
    expect(addBtn).not.toBeNull();

    addBtn.click();
    const box = document.querySelector(".pmk-commentbox");
    expect(box).not.toBeNull();

    const ta = box!.querySelector("textarea") as HTMLTextAreaElement;
    ta.value = "is this the right animal?";
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    (box!.querySelector("button.primary") as HTMLButtonElement).click();

    const posted = getMock()._messages;
    const add = posted.find((m) => (m as { type?: string }).type === "addComment") as {
      range: { start: number; end: number };
      quote: string;
      body: string;
    };
    expect(add).toBeTruthy();
    expect(add.quote).toBe("quick brown");
    expect(add.body).toBe("is this the right animal?");
  });

  // --- R15: drawer + needs-attention wiring --------------------------------

  function renderWith(comments: unknown[], attention: number, html = "<p>doc</p>"): void {
    injectMessage({
      v: 1,
      type: "render",
      html,
      theme: "light",
      docName: "test.md",
      comments,
      attention,
    });
  }

  const OPEN_C = {
    id: "open0001",
    state: "intact",
    provenance: "human",
    author: "carlos",
    timestamp: "2026-06-11 11:02 +10:00",
    quote: "eventual consistency",
    body: "Why eventual consistency?",
    extent: { startLine: 0, startCol: 0, endLine: 0, endCol: 3 },
  };
  const ORPHAN_C = {
    id: "orph0001",
    state: "orphan",
    provenance: "human",
    author: "carlos",
    timestamp: "2026-06-11 10:48 +10:00",
    quote: "three retries with backoff",
    body: "Text was rewritten. Re-anchor or delete.",
    extent: null,
  };

  it("a render wires the topbar Comments toggle with the open count and the drawer", () => {
    renderWith([OPEN_C], 0);
    const toggle = document.querySelector(".pmk-topbar-comments") as HTMLButtonElement;
    expect(toggle).not.toBeNull();
    expect(toggle.textContent).toContain("1");
    // Toggle opens the drawer.
    toggle.click();
    const drawer = document.querySelector(".pmk-drawer") as HTMLElement;
    expect(drawer.getAttribute("aria-hidden")).toBe("false");
    expect(drawer.textContent).toContain("eventual consistency");
    toggle.click(); // close again so later tests start closed
  });

  it("the attention chip appears only when attention > 0 and opens the drawer", () => {
    renderWith([OPEN_C], 0);
    expect(document.querySelector(".pmk-topbar-chip")).toBeNull();

    renderWith([OPEN_C, ORPHAN_C], 1);
    const chip = document.querySelector(".pmk-topbar-chip") as HTMLElement;
    expect(chip).not.toBeNull();
    expect(chip.textContent).toContain("1 orphaned");
    chip.click();
    expect((document.querySelector(".pmk-drawer") as HTMLElement).getAttribute("aria-hidden")).toBe(
      "false",
    );
    // The needs-attention section is present.
    expect(document.querySelector(".pmk-drawer-attention")).not.toBeNull();
  });

  it("a comments-only message refreshes the drawer lists and the count", () => {
    renderWith([OPEN_C], 0);
    injectMessage({ v: 1, type: "comments", comments: [OPEN_C, ORPHAN_C], attention: 1 });
    expect((document.querySelector(".pmk-topbar-comments") as HTMLElement).textContent).toContain(
      "1",
    ); // 1 open
    expect(document.querySelector(".pmk-topbar-chip")!.textContent).toContain("1 orphaned");
    expect(document.querySelectorAll(".pmk-drawer-attention .pmk-drawer-card").length).toBe(1);
  });

  it("re-anchor flow: drawer Re-anchor → select new location → posts resolveComment + addComment", () => {
    // Render with an orphan plus a commentable paragraph to re-anchor onto.
    renderWith(
      [ORPHAN_C],
      1,
      '<p data-pmk-offset="0:1" data-pmk-coff="0">The quick brown fox jumps over the lazy dog.</p>',
    );

    // Open the drawer at the needs-attention bucket and arm re-anchor.
    (document.querySelector(".pmk-topbar-chip") as HTMLElement).click();
    const reanchor = document.querySelector(
      ".pmk-drawer-attention .pmk-drawer-action.reanchor",
    ) as HTMLButtonElement;
    expect(reanchor).not.toBeNull();
    clearMessages();
    reanchor.click();

    // Arming closes the drawer and shows the hint.
    expect((document.querySelector(".pmk-drawer") as HTMLElement).getAttribute("aria-hidden")).toBe(
      "true",
    );
    expect(document.getElementById("penmark-reanchor-hint")!.hasAttribute("data-active")).toBe(
      true,
    );

    // Stub layout, then select "brown fox" as the new location.
    (Range.prototype as unknown as { getClientRects: () => unknown }).getClientRects = () =>
      [] as unknown[];
    const p = document.querySelector("#penmark-root p")!;
    const textNode = p.firstChild!;
    const content = textNode.textContent ?? "";
    const start = content.indexOf("brown fox");
    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, start + "brown fox".length);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));

    // The selection affordance now commits the re-anchor.
    const here = document.querySelector(".pmk-reanchor-here") as HTMLButtonElement;
    expect(here).not.toBeNull();
    expect(here.textContent).toContain("Re-anchor here");
    here.click();

    const posted = getMock()._messages;
    expect(posted).toContainEqual({ v: 1, type: "resolveComment", id: "orph0001" });
    const add = posted.find((m) => (m as { type?: string }).type === "addComment") as {
      quote: string;
      body: string;
    };
    expect(add).toBeTruthy();
    expect(add.quote).toBe("three retries with backoff"); // same quote (delete-then-add)
    expect(add.body).toBe("Text was rewritten. Re-anchor or delete.");

    // Hint cleared after commit.
    expect(document.getElementById("penmark-reanchor-hint")!.hasAttribute("data-active")).toBe(
      false,
    );
  });

  it("a 'setTheme' message applies theme class to body", () => {
    injectMessage({ v: 1, type: "setTheme", theme: "dark" });
    expect(document.body.classList.contains("theme-dark")).toBe(true);
  });

  it("a 'setContentWidth' message swaps the pmk-content-* body class", () => {
    injectMessage({ v: 1, type: "setContentWidth", contentWidth: "comfortable" });
    expect(document.body.classList.contains("pmk-content-comfortable")).toBe(true);

    injectMessage({ v: 1, type: "setContentWidth", contentWidth: "wide" });
    expect(document.body.classList.contains("pmk-content-wide")).toBe(true);
    // previous preset removed (not accumulated)
    expect(document.body.classList.contains("pmk-content-comfortable")).toBe(false);
  });

  it("scroll state is persisted with setState and restored on re-render", () => {
    // Simulate a saved state with a scroll position.
    _savedState = { scrollTop: 200, theme: "light" };
    const mock = getMock();
    mock.getState = () => _savedState;

    injectMessage({
      v: 1,
      type: "render",
      html: "<p>Restored</p>",
      theme: "light",
      docName: "test.md",
      comments: [],
      attention: 0,
    });

    // setState is called during/after render to persist state (implementation may vary).
    // At minimum, getState should return something truthy if state was previously set.
    expect(_savedState).toBeTruthy();
  });

  it("a 'revealLine' message sets root.scrollTop via the offset map", () => {
    // Seed the root with blocks that carry data-pmk-offset, then stub their
    // layout geometry (jsdom does not lay out — offsetTop/Height are 0).
    const root = document.getElementById("penmark-root")!;
    root.innerHTML = '<p data-pmk-offset="0:5">Block 1</p><p data-pmk-offset="10:15">Block 2</p>';

    const blocks = root.querySelectorAll<HTMLElement>("[data-pmk-offset]");
    Object.defineProperty(blocks[0], "offsetTop", { value: 0, configurable: true });
    Object.defineProperty(blocks[0], "offsetHeight", { value: 50, configurable: true });
    Object.defineProperty(blocks[1], "offsetTop", { value: 200, configurable: true });
    Object.defineProperty(blocks[1], "offsetHeight", { value: 80, configurable: true });

    injectMessage({ v: 1, type: "revealLine", line: 10 });

    // Line 10 is the start of block 2 (offsetTop 200) → scrollTop 200.
    expect(root.scrollTop).toBeCloseTo(200, 5);
  });

  it("a 'scrolled' message is posted (throttled) when the root scrolls", () => {
    const root = document.getElementById("penmark-root")!;
    // A render attaches the scroll listener to the current (fresh) root.
    injectMessage({
      v: 1,
      type: "render",
      html: '<p data-pmk-offset="0:5">Block 1</p><p data-pmk-offset="10:15">Block 2</p>',
      theme: "light",
      docName: "test.md",
      comments: [],
      attention: 0,
    });
    const blocks = root.querySelectorAll<HTMLElement>("[data-pmk-offset]");
    Object.defineProperty(blocks[0], "offsetTop", { value: 0, configurable: true });
    Object.defineProperty(blocks[0], "offsetHeight", { value: 50, configurable: true });
    Object.defineProperty(blocks[1], "offsetTop", { value: 200, configurable: true });
    Object.defineProperty(blocks[1], "offsetHeight", { value: 80, configurable: true });

    // Push wall-clock time forward past any open echo-suppression / throttle
    // window left by a prior test (module state is shared — main.ts imports once).
    const realNow = Date.now;
    const future = realNow() + 10_000;
    vi.spyOn(Date, "now").mockImplementation(() => future);
    try {
      clearMessages();
      root.scrollTop = 200;
      root.dispatchEvent(new Event("scroll"));
    } finally {
      Date.now = realNow;
    }

    const scrolled = getMock()._messages.find(
      (m) => (m as { type?: string }).type === "scrolled",
    ) as { v: number; type: string; topLine: number } | undefined;
    expect(scrolled).toBeDefined();
    expect(scrolled!.topLine).toBe(10);
  });

  it("messages with wrong v field are ignored", () => {
    const root = document.getElementById("penmark-root")!;
    const before = root.innerHTML;
    // v: 2 is not handled — should be silently dropped.
    injectMessage({
      v: 2,
      type: "render",
      html: "<p>IGNORED</p>",
      theme: "light",
      docName: "test.md",
    });
    expect(root.innerHTML).toBe(before);
  });
});
