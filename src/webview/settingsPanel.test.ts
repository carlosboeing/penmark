import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  ensureSettingsPanel,
  renderSettingsPanel,
  toggleSettingsPanel,
  openSettingsPanel,
  closeSettingsPanel,
  isSettingsPanelOpen,
} from "./settingsPanel.js";
import type { PreviewSettingsState } from "../core/protocol/messages.js";

const SETTINGS: PreviewSettingsState = {
  theme: "auto",
  preset: "github",
  textSize: "medium",
  contentWidth: "full",
  codeBlockWrap: true,
  highlightIntensity: "medium",
  lineHeight: 0,
};

/** Ordered, de-duplicated list of the setting group keys the panel renders. */
function renderedSettingKeys(): string[] {
  const keys: string[] = [];
  for (const el of document.querySelectorAll<HTMLElement>("[data-pmk-setting]")) {
    const key = el.dataset.pmkSetting;
    if (key && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

describe("settingsPanel", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("renders preview controls with the current settings selected", () => {
    const post = vi.fn();
    ensureSettingsPanel({ post, applyLocal: vi.fn() });
    renderSettingsPanel(SETTINGS);
    toggleSettingsPanel();

    const panel = document.querySelector(".pmk-settings-panel") as HTMLElement;
    expect(panel).not.toBeNull();
    expect(panel.getAttribute("aria-hidden")).toBe("false");
    expect(panel.textContent).toContain("Preview settings");
    expect(
      panel
        .querySelector('[data-pmk-setting="preset"][data-value="github"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("renders exactly the narrowed set of setting groups in order", () => {
    ensureSettingsPanel({ post: vi.fn(), applyLocal: vi.fn() });
    renderSettingsPanel(SETTINGS);

    expect(renderedSettingKeys()).toEqual([
      "theme",
      "preset",
      "textSize",
      "contentWidth",
      "codeBlockWrap",
      "comments.highlightIntensity",
    ]);
  });

  it("offers a single button that opens all Penmark settings via a fixed host action", () => {
    const post = vi.fn();
    ensureSettingsPanel({ post, applyLocal: vi.fn() });
    renderSettingsPanel(SETTINGS);

    const openAll = document.querySelector<HTMLButtonElement>(".pmk-settings-open-all");
    expect(openAll).not.toBeNull();
    openAll!.click();

    expect(post).toHaveBeenCalledWith({ v: 1, type: "openPenmarkSettings" });
  });

  it("posts updateSetting and applies local feedback when a control changes", () => {
    const post = vi.fn();
    const applyLocal = vi.fn();
    ensureSettingsPanel({ post, applyLocal });
    renderSettingsPanel(SETTINGS);
    toggleSettingsPanel();

    (document.querySelector('[data-pmk-setting="contentWidth"][data-value="comfortable"]') as HTMLButtonElement).click();
    (document.querySelector('[data-pmk-setting="comments.highlightIntensity"][data-value="strong"]') as HTMLButtonElement).click();

    expect(post).toHaveBeenCalledWith({
      v: 1,
      type: "updateSetting",
      key: "contentWidth",
      value: "comfortable",
    });
    expect(post).toHaveBeenCalledWith({
      v: 1,
      type: "updateSetting",
      key: "comments.highlightIntensity",
      value: "strong",
    });
    expect(applyLocal).toHaveBeenCalledWith("contentWidth", "comfortable");
    expect(applyLocal).toHaveBeenCalledWith("comments.highlightIntensity", "strong");
  });

  it("emits code-block wrapping as a boolean the host will accept", () => {
    const post = vi.fn();
    const applyLocal = vi.fn();
    ensureSettingsPanel({ post, applyLocal });
    renderSettingsPanel(SETTINGS);
    toggleSettingsPanel();

    (document.querySelector('[data-pmk-setting="codeBlockWrap"][data-value="false"]') as HTMLButtonElement).click();

    expect(post).toHaveBeenCalledWith({
      v: 1,
      type: "updateSetting",
      key: "codeBlockWrap",
      value: false,
    });
    expect(applyLocal).toHaveBeenCalledWith("codeBlockWrap", false);
  });

  it("omits the webview line-height control and closes on request", () => {
    const post = vi.fn();
    ensureSettingsPanel({ post, applyLocal: vi.fn() });
    renderSettingsPanel({ ...SETTINGS, lineHeight: 1.65 });
    toggleSettingsPanel();

    expect(document.querySelector(".pmk-settings-line-height")).toBeNull();
    expect(renderedSettingKeys()).not.toContain("lineHeight");

    closeSettingsPanel();
    expect(isSettingsPanelOpen()).toBe(false);
    expect(document.querySelector(".pmk-settings-panel")!.getAttribute("aria-hidden")).toBe("true");
  });

  it("moves focus to its close control and restores the opener", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    ensureSettingsPanel({ post: vi.fn(), applyLocal: vi.fn() });

    openSettingsPanel();
    const close = document.querySelector(".pmk-settings-close");
    expect(document.activeElement).toBe(close);

    closeSettingsPanel();
    expect(document.activeElement).toBe(opener);
  });

  it("restores a focused option after rerender without stealing external focus", () => {
    ensureSettingsPanel({ post: vi.fn(), applyLocal: vi.fn() });
    renderSettingsPanel(SETTINGS);
    openSettingsPanel();
    const option = document.querySelector<HTMLButtonElement>(
      '[data-pmk-setting="preset"][data-value="github"]',
    )!;
    option.focus();

    renderSettingsPanel(SETTINGS);
    const replacement = document.querySelector<HTMLButtonElement>(
      '[data-pmk-setting="preset"][data-value="github"]',
    )!;
    expect(replacement).not.toBe(option);
    expect(document.activeElement).toBe(replacement);

    const external = document.createElement("button");
    document.body.appendChild(external);
    external.focus();
    renderSettingsPanel(SETTINGS);
    expect(document.activeElement).toBe(external);
  });
});
