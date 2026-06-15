/**
 * Unit tests for copyButtons.ts — copy-to-clipboard overlay on code blocks.
 *
 * Runs in the vitest "webview" project (jsdom environment).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { installCopyButtons, markLastCopied } from "./copyButtons.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MULTILINE_CODE = "function add(a, b) {\n  return a + b;\n}\n";

function seedCodeBlock(root: HTMLElement, code: string): HTMLPreElement {
  const pre = document.createElement("pre");
  const codeEl = document.createElement("code");
  codeEl.textContent = code;
  pre.appendChild(codeEl);
  root.appendChild(pre);
  return pre;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("installCopyButtons", () => {
  let root: HTMLElement;
  let post: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    document.body.innerHTML = "";
    root = document.createElement("div");
    document.body.appendChild(root);
    post = vi.fn();
  });

  it("adds exactly one copy button to every pre > code", () => {
    seedCodeBlock(root, "a");
    seedCodeBlock(root, "b");

    installCopyButtons(root, post);

    const pres = root.querySelectorAll("pre");
    expect(pres.length).toBe(2);
    for (const pre of pres) {
      expect(pre.querySelectorAll(".pmk-copy-btn").length).toBe(1);
    }
  });

  it("is idempotent — calling twice does not duplicate buttons", () => {
    seedCodeBlock(root, "a");

    installCopyButtons(root, post);
    installCopyButtons(root, post);

    expect(root.querySelectorAll(".pmk-copy-btn").length).toBe(1);
  });

  it("re-installs a button after a re-render rebuilds the pre", () => {
    seedCodeBlock(root, "a");
    installCopyButtons(root, post);
    expect(root.querySelectorAll(".pmk-copy-btn").length).toBe(1);

    // Simulate morphdom rebuilding the DOM: wipe and re-create the pre.
    root.innerHTML = "";
    seedCodeBlock(root, "a");
    expect(root.querySelectorAll(".pmk-copy-btn").length).toBe(0);

    installCopyButtons(root, post);
    expect(root.querySelectorAll(".pmk-copy-btn").length).toBe(1);
  });

  it("clicking posts copyCode with the exact code text (newlines preserved, no label leakage)", () => {
    seedCodeBlock(root, MULTILINE_CODE);
    installCopyButtons(root, post);

    const btn = root.querySelector(".pmk-copy-btn") as HTMLButtonElement;
    btn.click();

    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith({ v: 1, type: "copyCode", text: MULTILINE_CODE });

    // Defensively assert no label text leaked into the copied payload.
    const payload = post.mock.calls[0]![0] as { text: string };
    expect(payload.text).toBe(MULTILINE_CODE);
    expect(payload.text).not.toContain("Copy");
    expect(payload.text).toContain("\n");
  });

  it("markLastCopied flips the last-clicked button to the copied state, then reverts", () => {
    vi.useFakeTimers();
    try {
      seedCodeBlock(root, "x");
      installCopyButtons(root, post);
      const btn = root.querySelector(".pmk-copy-btn") as HTMLButtonElement;
      expect(btn.textContent).toBe("Copy");

      btn.click();
      markLastCopied();
      expect(btn.textContent).toContain("Copied");

      vi.advanceTimersByTime(1300);
      expect(btn.textContent).toBe("Copy");
    } finally {
      vi.useRealTimers();
    }
  });
});
