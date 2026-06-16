import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  ensureSettingsPanel,
  openSettingsPanel,
  toggleSettingsPanel,
  closeSettingsPanel,
  isSettingsPanelOpen,
  syncPreviewUiState,
  applyHighlightIntensity,
} from "./settingsPanel.js";

describe("settingsPanel", () => {
  beforeEach(() => {
    document.body.className = "pmk-content-full pmk-hl-medium";
    document.body.innerHTML =
      '<div id="penmark-topbar"></div><div id="penmark-root"><p>Hello</p></div>';
  });

  afterEach(() => {
    document.getElementById("pmk-settings-scrim")?.remove();
    document.getElementById("pmk-settings-panel")?.remove();
    document.body.removeAttribute("data-pmk-settings-open");
  });

  it("opens and closes the settings panel", () => {
    const posted: unknown[] = [];
    ensureSettingsPanel((msg) => posted.push(msg));
    syncPreviewUiState({
      theme: "light",
      highlightIntensity: "medium",
      typography: {
        preset: "github",
        textSize: "medium",
        fontFamily: "sans",
        headingFontFamily: "sans",
        lineHeight: 1.5,
        contentWidth: "full",
      },
    });

    expect(isSettingsPanelOpen()).toBe(false);
    openSettingsPanel();
    expect(isSettingsPanelOpen()).toBe(true);
    expect(document.getElementById("pmk-settings-panel")?.getAttribute("data-open")).toBe("");

    closeSettingsPanel();
    expect(isSettingsPanelOpen()).toBe(false);
  });

  it("applyHighlightIntensity swaps body classes", () => {
    applyHighlightIntensity("strong");
    expect(document.body.classList.contains("pmk-hl-strong")).toBe(true);
    expect(document.body.classList.contains("pmk-hl-medium")).toBe(false);
  });

  it("toggleSettingsPanel opens and closes", () => {
    const posted: unknown[] = [];
    ensureSettingsPanel((msg) => posted.push(msg));
    syncPreviewUiState({
      theme: "dark",
      highlightIntensity: "subtle",
      typography: {
        preset: "reading",
        textSize: "large",
        fontFamily: "serif",
        headingFontFamily: "sans",
        lineHeight: 1.7,
        contentWidth: "comfortable",
      },
    });
    toggleSettingsPanel();
    expect(isSettingsPanelOpen()).toBe(true);
    toggleSettingsPanel();
    expect(isSettingsPanelOpen()).toBe(false);
  });
});
