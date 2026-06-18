import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  ensureSettingsPanel,
  renderSettingsPanel,
  toggleSettingsPanel,
  closeSettingsPanel,
  isSettingsPanelOpen,
} from "./settingsPanel.js";
import type { PreviewSettingsState } from "../core/protocol/messages.js";

const SETTINGS: PreviewSettingsState = {
  theme: "auto",
  preset: "github",
  textSize: "medium",
  contentWidth: "full",
  highlightIntensity: "medium",
  lineHeight: 0,
};

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

  it("keeps line height numeric and closes on request", () => {
    const post = vi.fn();
    ensureSettingsPanel({ post, applyLocal: vi.fn() });
    renderSettingsPanel({ ...SETTINGS, lineHeight: 1.65 });
    toggleSettingsPanel();

    const input = document.querySelector(".pmk-settings-line-height") as HTMLInputElement;
    expect(input.value).toBe("1.65");
    input.value = "1.8";
    input.dispatchEvent(new Event("change", { bubbles: true }));

    expect(post).toHaveBeenCalledWith({
      v: 1,
      type: "updateSetting",
      key: "lineHeight",
      value: 1.8,
    });

    closeSettingsPanel();
    expect(isSettingsPanelOpen()).toBe(false);
    expect(document.querySelector(".pmk-settings-panel")!.getAttribute("aria-hidden")).toBe("true");
  });
});
