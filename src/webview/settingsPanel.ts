/**
 * In-preview settings slide-out (UI/UX polish).
 *
 * Adjusts penmark.* settings with instant preview feedback; persists via
 * updateSetting postMessage. ADR 0001: no vscode imports.
 */

import type {
  ContentWidth,
  HighlightIntensity,
  PenmarkSettingKey,
  ThemeMode,
  TypographySettings,
  WebviewToHost,
} from "../core/protocol/messages.js";
import type { PresetName, TextSize } from "../core/settings/typography.js";
import { applyTypography } from "./typography.js";

type PostMessage = (msg: WebviewToHost) => void;

export interface PreviewUiState {
  theme: ThemeMode;
  typography: TypographySettings;
  highlightIntensity: HighlightIntensity;
}

const PRESETS: PresetName[] = ["github", "reading", "compact", "focus", "print", "custom"];
const TEXT_SIZES: TextSize[] = ["small", "medium", "large", "x-large"];
const WIDTHS: ContentWidth[] = ["comfortable", "wide", "full"];
const INTENSITIES: HighlightIntensity[] = ["subtle", "medium", "strong"];
const THEMES: ThemeMode[] = ["light", "dark", "auto"];

let _state: PreviewUiState | null = null;
let _post: PostMessage | null = null;
let _panel: HTMLElement | null = null;
let _scrim: HTMLElement | null = null;
let _open = false;

function postUpdate(key: PenmarkSettingKey, value: string | number): void {
  _post?.({ v: 1, type: "updateSetting", key, value });
}

function applyHighlightIntensity(intensity: HighlightIntensity): void {
  const cls = document.body.classList;
  cls.remove("pmk-hl-subtle", "pmk-hl-medium", "pmk-hl-strong");
  cls.add(`pmk-hl-${intensity}`);
}

function applyContentWidth(width: ContentWidth): void {
  const cls = document.body.classList;
  cls.remove("pmk-content-comfortable", "pmk-content-wide", "pmk-content-full");
  cls.add(`pmk-content-${width}`);
}

function labelRow(label: string, control: HTMLElement): HTMLElement {
  const row = document.createElement("div");
  row.className = "pmk-settings-row";
  const lbl = document.createElement("label");
  lbl.className = "pmk-settings-label";
  lbl.textContent = label;
  row.appendChild(lbl);
  row.appendChild(control);
  return row;
}

function select<T extends string>(
  options: readonly T[],
  value: T,
  onChange: (v: T) => void,
  format?: (v: T) => string,
): HTMLSelectElement {
  const sel = document.createElement("select");
  sel.className = "pmk-settings-select";
  for (const opt of options) {
    const o = document.createElement("option");
    o.value = opt;
    o.textContent = format ? format(opt) : opt;
    if (opt === value) o.selected = true;
    sel.appendChild(o);
  }
  sel.addEventListener("change", () => onChange(sel.value as T));
  return sel;
}

function rebuildPanel(): void {
  if (!_panel || !_state) return;
  _panel.replaceChildren();

  const header = document.createElement("div");
  header.className = "pmk-settings-header";
  const title = document.createElement("h2");
  title.className = "pmk-settings-title";
  title.textContent = "Preview settings";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "pmk-settings-close";
  close.setAttribute("aria-label", "Close settings");
  close.textContent = "×";
  close.addEventListener("click", () => closeSettingsPanel());
  header.appendChild(title);
  header.appendChild(close);
  _panel.appendChild(header);

  const body = document.createElement("div");
  body.className = "pmk-settings-body";

  const t = _state.typography;

  body.appendChild(
    labelRow(
      "Theme",
      select(THEMES, _state.theme, (theme) => {
        _state!.theme = theme;
        _post?.({ v: 1, type: "themeSelected", theme });
        postUpdate("theme", theme);
      }),
    ),
  );

  body.appendChild(
    labelRow(
      "Preset",
      select(PRESETS, t.preset, (preset) => {
        t.preset = preset;
        postUpdate("preset", preset);
        if (preset !== "custom") {
          postUpdate("textSize", t.textSize);
          postUpdate("lineHeight", t.lineHeight);
          postUpdate("contentWidth", t.contentWidth);
        }
        const root = document.getElementById("penmark-root");
        if (root) applyTypography(root, t);
        applyContentWidth(t.contentWidth);
      }),
    ),
  );

  body.appendChild(
    labelRow(
      "Text size",
      select(TEXT_SIZES, t.textSize, (textSize) => {
        t.textSize = textSize;
        if (t.preset !== "custom") {
          t.preset = "custom";
          postUpdate("preset", "custom");
        }
        postUpdate("textSize", textSize);
        const root = document.getElementById("penmark-root");
        if (root) applyTypography(root, t);
      }),
    ),
  );

  const lineRange = document.createElement("input");
  lineRange.type = "range";
  lineRange.className = "pmk-settings-range";
  lineRange.min = "1.2";
  lineRange.max = "2";
  lineRange.step = "0.05";
  lineRange.value = String(t.lineHeight);
  const lineVal = document.createElement("span");
  lineVal.className = "pmk-settings-range-val";
  lineVal.textContent = t.lineHeight.toFixed(2);
  lineRange.addEventListener("input", () => {
    const lh = parseFloat(lineRange.value);
    t.lineHeight = lh;
    lineVal.textContent = lh.toFixed(2);
    if (t.preset !== "custom") {
      t.preset = "custom";
      postUpdate("preset", "custom");
    }
    postUpdate("lineHeight", lh);
    const root = document.getElementById("penmark-root");
    if (root) applyTypography(root, t);
  });
  const lineWrap = document.createElement("div");
  lineWrap.className = "pmk-settings-range-wrap";
  lineWrap.appendChild(lineRange);
  lineWrap.appendChild(lineVal);
  body.appendChild(labelRow("Line height", lineWrap));

  body.appendChild(
    labelRow(
      "Content width",
      select(WIDTHS, t.contentWidth, (contentWidth) => {
        t.contentWidth = contentWidth;
        if (t.preset !== "custom") {
          t.preset = "custom";
          postUpdate("preset", "custom");
        }
        postUpdate("contentWidth", contentWidth);
        applyContentWidth(contentWidth);
        const root = document.getElementById("penmark-root");
        if (root) applyTypography(root, t);
      }),
    ),
  );

  body.appendChild(
    labelRow(
      "Highlight intensity",
      select(INTENSITIES, _state.highlightIntensity, (highlightIntensity) => {
        _state!.highlightIntensity = highlightIntensity;
        applyHighlightIntensity(highlightIntensity);
        postUpdate("highlightIntensity", highlightIntensity);
      }),
    ),
  );

  const hint = document.createElement("p");
  hint.className = "pmk-settings-hint";
  hint.textContent = "Changes save to your Penmark user settings.";
  body.appendChild(hint);

  _panel.appendChild(body);
}

function ensureDom(): void {
  if (_scrim && _panel) return;

  const scrim = document.createElement("div");
  scrim.id = "pmk-settings-scrim";
  scrim.className = "pmk-settings-scrim";
  scrim.addEventListener("click", () => closeSettingsPanel());

  const panel = document.createElement("aside");
  panel.id = "pmk-settings-panel";
  panel.className = "pmk-settings-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Preview settings");

  document.body.appendChild(scrim);
  document.body.appendChild(panel);
  _scrim = scrim;
  _panel = panel;

  document.addEventListener("keydown", (e) => {
    if (_open && e.key === "Escape") {
      e.stopPropagation();
      closeSettingsPanel();
    }
  });
}

/** Install the settings panel (idempotent). */
export function ensureSettingsPanel(post: PostMessage): void {
  _post = post;
  ensureDom();
}

/** Sync panel state from the latest render / config messages. */
export function syncPreviewUiState(state: PreviewUiState): void {
  _state = state;
  if (_open) rebuildPanel();
}

export function isSettingsPanelOpen(): boolean {
  return _open;
}

export function openSettingsPanel(): void {
  ensureDom();
  if (!_state) return;
  rebuildPanel();
  _open = true;
  _scrim?.setAttribute("data-open", "");
  _panel?.setAttribute("data-open", "");
  document.body.setAttribute("data-pmk-settings-open", "");
}

export function closeSettingsPanel(): void {
  _open = false;
  _scrim?.removeAttribute("data-open");
  _panel?.removeAttribute("data-open");
  document.body.removeAttribute("data-pmk-settings-open");
}

export function toggleSettingsPanel(): void {
  if (_open) closeSettingsPanel();
  else openSettingsPanel();
}

export { applyHighlightIntensity };
