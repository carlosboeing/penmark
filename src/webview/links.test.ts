/**
 * Unit tests for links.ts — delegated click handling for all link classes.
 *
 * Runs in the vitest "webview" project (jsdom environment).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { installLinkHandler } from "./links.js";

// ---------------------------------------------------------------------------
// Mock vscode API
// ---------------------------------------------------------------------------

interface VsCodeMock {
  _messages: { v: number; type: string; href?: string }[];
  postMessage: (msg: unknown) => void;
  getState: () => unknown;
  setState: (s: unknown) => void;
}

function makeMock(): VsCodeMock {
  const mock: VsCodeMock = {
    _messages: [],
    postMessage(msg) {
      this._messages.push(msg as { v: number; type: string; href?: string });
    },
    getState: () => undefined,
    setState: () => {},
  };
  return mock;
}

describe("installLinkHandler", () => {
  let root: HTMLElement;
  let mock: VsCodeMock;
  let postMessage: (msg: unknown) => void;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    mock = makeMock();
    postMessage = (msg) => mock.postMessage(msg);
    installLinkHandler(root, postMessage);
  });

  it("external http link triggers openLink postMessage and prevents default", () => {
    const a = document.createElement("a");
    a.href = "http://example.com";
    root.appendChild(a);

    const evt = new MouseEvent("click", { bubbles: true, cancelable: true });
    a.dispatchEvent(evt);

    expect(evt.defaultPrevented).toBe(true);
    expect(mock._messages).toContainEqual({
      v: 1,
      type: "openLink",
      href: "http://example.com/",
    });
  });

  it("external https link triggers openLink postMessage", () => {
    const a = document.createElement("a");
    a.href = "https://example.com/page";
    root.appendChild(a);

    const evt = new MouseEvent("click", { bubbles: true, cancelable: true });
    a.dispatchEvent(evt);

    expect(evt.defaultPrevented).toBe(true);
    expect(mock._messages).toContainEqual({
      v: 1,
      type: "openLink",
      href: "https://example.com/page",
    });
  });

  it("fragment (#section) link scrolls in-page element by id — no postMessage", () => {
    // Create the target element in the document.
    const target = document.createElement("h2");
    target.id = "section";
    root.appendChild(target);

    // Mock scrollIntoView since jsdom doesn't implement it.
    const scrollSpy = vi.fn();
    target.scrollIntoView = scrollSpy;

    const a = document.createElement("a");
    // jsdom resolves href="#section" relative to about:blank
    a.setAttribute("href", "#section");
    root.appendChild(a);

    const evt = new MouseEvent("click", { bubbles: true, cancelable: true });
    a.dispatchEvent(evt);

    expect(evt.defaultPrevented).toBe(true);
    // No postMessage for fragments.
    expect(mock._messages.filter((m) => m.type === "openLink")).toHaveLength(0);
    // scrollIntoView was called on the target element.
    expect(scrollSpy).toHaveBeenCalled();
  });

  it("relative path link triggers openLink postMessage", () => {
    const a = document.createElement("a");
    a.setAttribute("href", "./other.md");
    root.appendChild(a);

    const evt = new MouseEvent("click", { bubbles: true, cancelable: true });
    a.dispatchEvent(evt);

    expect(evt.defaultPrevented).toBe(true);
    // The href attribute value is passed (host resolves relative paths).
    expect(mock._messages.some((m) => m.type === "openLink" && typeof m.href === "string")).toBe(
      true,
    );
  });

  it("does not fire for non-anchor elements", () => {
    const span = document.createElement("span");
    span.textContent = "not a link";
    root.appendChild(span);

    const evt = new MouseEvent("click", { bubbles: true, cancelable: true });
    span.dispatchEvent(evt);

    expect(mock._messages).toHaveLength(0);
    expect(evt.defaultPrevented).toBe(false);
  });
});
