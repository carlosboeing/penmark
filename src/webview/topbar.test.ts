/**
 * Unit tests for topbar.ts — doc name display + theme switcher postMessage.
 *
 * Runs in the vitest "webview" project (jsdom environment).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { installTopbar } from "./topbar.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePostMessage(): (msg: unknown) => void {
  return vi.fn();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("installTopbar", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="penmark-topbar"></div>';
  });

  it("renders the doc name in the topbar", () => {
    const post = makePostMessage();
    installTopbar(document.getElementById("penmark-topbar")!, "my-doc.md", post);
    const topbar = document.getElementById("penmark-topbar")!;
    expect(topbar.textContent).toContain("my-doc.md");
  });

  it("renders theme icon buttons: light, dark, auto", () => {
    const post = makePostMessage();
    installTopbar(document.getElementById("penmark-topbar")!, "test.md", post, undefined, undefined, "dark");
    const buttons = document.querySelectorAll("[data-theme-mode]");
    const modes = Array.from(buttons).map((b) => b.getAttribute("data-theme-mode"));
    expect(modes).toContain("light");
    expect(modes).toContain("dark");
    expect(modes).toContain("auto");
    expect(document.querySelector("[data-theme-mode='dark']")?.getAttribute("data-active")).toBe("true");
  });

  it("clicking the light button posts {v:1,type:'themeSelected',theme:'light'}", () => {
    const post = makePostMessage();
    installTopbar(document.getElementById("penmark-topbar")!, "test.md", post);
    const btn = document.querySelector("[data-theme-mode='light']") as HTMLElement;
    btn.click();
    expect(post).toHaveBeenCalledWith({ v: 1, type: "themeSelected", theme: "light" });
  });

  it("clicking the dark button posts {v:1,type:'themeSelected',theme:'dark'}", () => {
    const post = makePostMessage();
    installTopbar(document.getElementById("penmark-topbar")!, "test.md", post);
    const btn = document.querySelector("[data-theme-mode='dark']") as HTMLElement;
    btn.click();
    expect(post).toHaveBeenCalledWith({ v: 1, type: "themeSelected", theme: "dark" });
  });

  it("clicking the auto button posts {v:1,type:'themeSelected',theme:'auto'}", () => {
    const post = makePostMessage();
    installTopbar(document.getElementById("penmark-topbar")!, "test.md", post);
    const btn = document.querySelector("[data-theme-mode='auto']") as HTMLElement;
    btn.click();
    expect(post).toHaveBeenCalledWith({ v: 1, type: "themeSelected", theme: "auto" });
  });

  it("updates doc name when called again with a new name", () => {
    const post = makePostMessage();
    installTopbar(document.getElementById("penmark-topbar")!, "first.md", post);
    installTopbar(document.getElementById("penmark-topbar")!, "second.md", post);
    const topbar = document.getElementById("penmark-topbar")!;
    expect(topbar.textContent).toContain("second.md");
  });

  // --- R15: comments drawer toggle + attention chip ------------------------

  function topbar(): HTMLElement {
    return document.getElementById("penmark-topbar")!;
  }

  it("renders a Comments icon toggle with a count badge", () => {
    installTopbar(topbar(), "test.md", makePostMessage(), {
      openCount: 3,
      attention: 0,
      onToggleDrawer: vi.fn(),
      onOpenAttention: vi.fn(),
    });
    const toggle = topbar().querySelector(".pmk-topbar-comments") as HTMLButtonElement;
    expect(toggle).not.toBeNull();
    expect(toggle.getAttribute("aria-label")).toBe("Comments (3)");
    expect(toggle.querySelector(".pmk-topbar-badge")?.textContent).toBe("3");
  });

  it("clicking the Comments toggle invokes onToggleDrawer", () => {
    const onToggleDrawer = vi.fn();
    installTopbar(topbar(), "test.md", makePostMessage(), {
      openCount: 2,
      attention: 0,
      onToggleDrawer,
      onOpenAttention: vi.fn(),
    });
    (topbar().querySelector(".pmk-topbar-comments") as HTMLButtonElement).click();
    expect(onToggleDrawer).toHaveBeenCalledTimes(1);
  });

  it("shows the amber attention chip with the count only when attention > 0", () => {
    installTopbar(topbar(), "test.md", makePostMessage(), {
      openCount: 1,
      attention: 0,
      onToggleDrawer: vi.fn(),
      onOpenAttention: vi.fn(),
    });
    expect(topbar().querySelector(".pmk-topbar-chip")).toBeNull();

    installTopbar(topbar(), "test.md", makePostMessage(), {
      openCount: 1,
      attention: 2,
      onToggleDrawer: vi.fn(),
      onOpenAttention: vi.fn(),
    });
    const chip = topbar().querySelector(".pmk-topbar-chip") as HTMLElement;
    expect(chip).not.toBeNull();
    expect(chip.textContent).toContain("2 orphaned");
  });

  it("clicking the attention chip invokes onOpenAttention", () => {
    const onOpenAttention = vi.fn();
    installTopbar(topbar(), "test.md", makePostMessage(), {
      openCount: 1,
      attention: 1,
      onToggleDrawer: vi.fn(),
      onOpenAttention,
    });
    (topbar().querySelector(".pmk-topbar-chip") as HTMLElement).click();
    expect(onOpenAttention).toHaveBeenCalledTimes(1);
  });

  it("renders a settings icon button when onOpenSettings is provided", () => {
    const onOpenSettings = vi.fn();
    installTopbar(topbar(), "test.md", makePostMessage(), undefined, onOpenSettings);
    const btn = topbar().querySelector(".pmk-topbar-settings") as HTMLButtonElement;
    expect(btn.getAttribute("title")).toBe("Preview settings");
    btn.click();
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("caps the comment badge at 9+", () => {
    installTopbar(topbar(), "test.md", makePostMessage(), {
      openCount: 12,
      attention: 0,
      onToggleDrawer: vi.fn(),
      onOpenAttention: vi.fn(),
    });
    expect(topbar().querySelector(".pmk-topbar-badge")?.textContent).toBe("9+");
  });

  it("omits the Comments toggle and chip when no comment opts are passed", () => {
    installTopbar(topbar(), "test.md", makePostMessage());
    expect(topbar().querySelector(".pmk-topbar-comments")).toBeNull();
    expect(topbar().querySelector(".pmk-topbar-chip")).toBeNull();
  });
});
