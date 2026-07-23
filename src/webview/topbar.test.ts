/**
 * Unit tests for topbar.ts — doc name display + theme cycle callback.
 *
 * Runs in the vitest "webview" project (jsdom environment).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { installTopbar } from "./topbar.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeThemeSelected(): (theme: "auto" | "light" | "dark") => void {
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
    installTopbar(document.getElementById("penmark-topbar")!, "my-doc.md", makeThemeSelected());
    const topbar = document.getElementById("penmark-topbar")!;
    expect(topbar.textContent).toContain("my-doc.md");
  });

  it("renders subdued reading metadata beside the document name", () => {
    installTopbar(
      topbar(),
      "my-doc.md",
      makeThemeSelected(),
      undefined,
      undefined,
      undefined,
      "auto",
      "2,140 words · 9 min read",
    );

    const documentZone = topbar().querySelector(":scope > .pmk-topbar-document")!;
    const metadata = documentZone.querySelector(".pmk-topbar-reading-meta")!;
    expect(metadata.textContent).toBe("2,140 words · 9 min read");
    expect(metadata.previousElementSibling?.classList.contains("pmk-topbar-docname")).toBe(true);
  });

  it("hides only optional metadata below 700px while preserving task controls", () => {
    const cssPath = resolve(process.cwd(), "media/penmark.css");
    const css = readFileSync(cssPath, "utf8");
    const compactRules = css.match(/@media \(max-width: 700px\) \{([\s\S]*?)\n\}/)?.[1] ?? "";

    expect(compactRules).toMatch(/\.pmk-topbar-reading-meta[\s\S]*display:\s*none/);
    expect(compactRules).not.toMatch(/\.pmk-topbar-(?:switcher|settings|export|comments)[\s\S]*display:\s*none/);
    expect(css).toMatch(/\.pmk-topbar-reading-meta\s*\{[\s\S]*color:\s*var\(--pmk-color-fg-subtle\)/);
  });

  it("defines themed styles for the in-preview search surface and its hits", () => {
    const css = readFileSync(resolve(process.cwd(), "media/penmark.css"), "utf8");

    expect(css).toMatch(/\.pmk-find-surface\s*\{/);
    expect(css).toMatch(/#penmark-root\s+\.pmk-search-hit\s*\{/);
    expect(css).toMatch(/\.pmk-search-hit-current\s*\{/);
  });

  it("renders one native theme button that announces and cycles all three modes", () => {
    const onThemeSelected = makeThemeSelected();
    installTopbar(
      document.getElementById("penmark-topbar")!,
      "test.md",
      onThemeSelected,
      undefined,
      undefined,
      undefined,
      "auto",
    );
    const buttons = document.querySelectorAll("[data-theme-mode]");
    expect(buttons).toHaveLength(1);
    const button = buttons[0] as HTMLButtonElement;
    expect(button.tagName).toBe("BUTTON");
    expect(button.type).toBe("button");
    expect(button.getAttribute("data-theme-mode")).toBe("auto");
    expect(button.getAttribute("data-active")).toBe("true");
    expect(button.hasAttribute("aria-pressed")).toBe(false);
    expect(button.getAttribute("aria-label")).toBe("Theme: auto. Switch to light");
    expect(button.title).toBe("Theme: auto. Switch to light");

    button.click();
    expect(onThemeSelected).toHaveBeenLastCalledWith("light");

    installTopbar(topbar(), "test.md", onThemeSelected, undefined, undefined, undefined, "light");
    const lightButton = document.querySelector("[data-theme-mode]") as HTMLButtonElement;
    expect(lightButton.hasAttribute("aria-pressed")).toBe(false);
    expect(lightButton.getAttribute("aria-label")).toBe("Theme: light. Switch to dark");
    lightButton.click();
    expect(onThemeSelected).toHaveBeenLastCalledWith("dark");

    installTopbar(topbar(), "test.md", onThemeSelected, undefined, undefined, undefined, "dark");
    const darkButton = document.querySelector("[data-theme-mode]") as HTMLButtonElement;
    expect(darkButton.hasAttribute("aria-pressed")).toBe(false);
    expect(darkButton.getAttribute("aria-label")).toBe("Theme: dark. Switch to auto");
    darkButton.click();
    expect(onThemeSelected).toHaveBeenLastCalledWith("auto");
  });

  it("renders a Preview settings toggle when settings opts are passed", () => {
    const onToggleSettings = vi.fn();
    installTopbar(document.getElementById("penmark-topbar")!, "test.md", makeThemeSelected(), undefined, {
      onToggleSettings,
      settingsOpen: false,
    });
    const toggle = document.querySelector(".pmk-topbar-settings") as HTMLButtonElement;
    expect(toggle).not.toBeNull();
    expect(toggle.getAttribute("aria-label")).toBe("Preview settings");
    expect(toggle.title).toBe("Preview settings");
    expect(toggle.getAttribute("aria-controls")).toBe("penmark-settings-panel");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.hasAttribute("aria-pressed")).toBe(false);
    toggle.click();
    expect(onToggleSettings).toHaveBeenCalledTimes(1);
  });

  it("renders a Search control that reports its active state and opens the find surface", () => {
    const onOpenFind = vi.fn();
    installTopbar(topbar(), "test.md", makeThemeSelected(), undefined, undefined, undefined, "auto", undefined, {
      open: true,
      onOpenFind,
    });

    const search = topbar().querySelector(".pmk-topbar-find") as HTMLButtonElement;
    expect(search.getAttribute("aria-label")).toBe("Search document");
    expect(search.getAttribute("aria-pressed")).toBe("true");
    search.click();
    expect(onOpenFind).toHaveBeenCalledOnce();
  });

  it("uses aria-hidden bundled SVGs while button names remain independent of labels", () => {
    installTopbar(
      topbar(),
      "test.md",
      makeThemeSelected(),
      { openCount: 3, attention: 0, drawerOpen: false, onToggleDrawer: vi.fn(), onOpenAttention: vi.fn() },
      { settingsOpen: false, onToggleSettings: vi.fn() },
      { onOpenExport: vi.fn() },
      "light",
    );

    expect(topbar().querySelector(".pmk-topbar-document-icon svg")?.getAttribute("aria-hidden")).toBe("true");
    for (const selector of [
      ".pmk-topbar-switcher",
      ".pmk-topbar-settings",
      ".pmk-topbar-export",
      ".pmk-topbar-comments",
    ]) {
      const button = topbar().querySelector(selector) as HTMLButtonElement;
      expect(button.querySelector("svg")?.namespaceURI).toBe("http://www.w3.org/2000/svg");
      expect(button.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
      expect(button.getAttribute("aria-label")).toBeTruthy();
      expect(button.title).toBeTruthy();
    }
  });

  it("updates doc name when called again with a new name", () => {
    const onThemeSelected = makeThemeSelected();
    installTopbar(document.getElementById("penmark-topbar")!, "first.md", onThemeSelected);
    installTopbar(document.getElementById("penmark-topbar")!, "second.md", onThemeSelected);
    const topbar = document.getElementById("penmark-topbar")!;
    expect(topbar.textContent).toContain("second.md");
  });

  // --- R15: comments drawer toggle + attention chip ------------------------

  function topbar(): HTMLElement {
    return document.getElementById("penmark-topbar")!;
  }

  it("renders a Comments toggle showing the open-comment count", () => {
    installTopbar(topbar(), "test.md", makeThemeSelected(), {
      openCount: 3,
      attention: 0,
      drawerOpen: false,
      onToggleDrawer: vi.fn(),
      onOpenAttention: vi.fn(),
    }, { onToggleSettings: vi.fn(), settingsOpen: false });
    const toggle = topbar().querySelector(".pmk-topbar-comments") as HTMLButtonElement;
    expect(toggle).not.toBeNull();
    expect(toggle.textContent).toContain("3");
    expect(toggle.getAttribute("aria-label")).toBe("Comments, 3 open");
    expect(toggle.title).toBe("Comments, 3 open");
    expect(toggle.getAttribute("aria-controls")).toBe("penmark-comments-drawer");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.hasAttribute("aria-pressed")).toBe(false);
  });

  it("clicking the Comments toggle invokes onToggleDrawer", () => {
    const onToggleDrawer = vi.fn();
    installTopbar(topbar(), "test.md", makeThemeSelected(), {
      openCount: 2,
      attention: 0,
      drawerOpen: false,
      onToggleDrawer,
      onOpenAttention: vi.fn(),
    }, { onToggleSettings: vi.fn(), settingsOpen: false });
    (topbar().querySelector(".pmk-topbar-comments") as HTMLButtonElement).click();
    expect(onToggleDrawer).toHaveBeenCalledTimes(1);
  });

  it("shows the amber attention chip with the count only when attention > 0", () => {
    installTopbar(topbar(), "test.md", makeThemeSelected(), {
      openCount: 1,
      attention: 0,
      drawerOpen: false,
      onToggleDrawer: vi.fn(),
      onOpenAttention: vi.fn(),
    });
    expect(topbar().querySelector(".pmk-topbar-chip")).toBeNull();

    installTopbar(topbar(), "test.md", makeThemeSelected(), {
      openCount: 1,
      attention: 2,
      drawerOpen: false,
      onToggleDrawer: vi.fn(),
      onOpenAttention: vi.fn(),
    });
    const chip = topbar().querySelector(".pmk-topbar-chip") as HTMLElement;
    expect(chip).not.toBeNull();
    expect(chip.textContent).toContain("2 orphaned");
  });

  it("clicking the attention chip invokes onOpenAttention", () => {
    const onOpenAttention = vi.fn();
    installTopbar(topbar(), "test.md", makeThemeSelected(), {
      openCount: 1,
      attention: 1,
      drawerOpen: false,
      onToggleDrawer: vi.fn(),
      onOpenAttention,
    });
    (topbar().querySelector(".pmk-topbar-chip") as HTMLElement).click();
    expect(onOpenAttention).toHaveBeenCalledTimes(1);
  });

  it("omits the Comments toggle and chip when no comment opts are passed", () => {
    installTopbar(topbar(), "test.md", makeThemeSelected());
    expect(topbar().querySelector(".pmk-topbar-comments")).toBeNull();
    expect(topbar().querySelector(".pmk-topbar-chip")).toBeNull();
  });
});
