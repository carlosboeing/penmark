import type {
  PreviewSettingKey,
  PreviewSettingsState,
  PreviewSettingValue,
  WebviewToHost,
} from "../core/protocol/messages.js";

type PostMessage = (msg: WebviewToHost) => void;
type ApplyLocal = (key: PreviewSettingKey, value: PreviewSettingValue) => void;

interface SettingsConfig {
  post: PostMessage;
  applyLocal: ApplyLocal;
}

interface SettingsInternals {
  panel: HTMLElement;
  content: HTMLElement;
  cfg: SettingsConfig;
  onKeydown: (e: KeyboardEvent) => void;
}

let _settings: SettingsInternals | null = null;
let _open = false;
let _state: PreviewSettingsState | null = null;

const GROUPS: Array<{
  title: string;
  key: PreviewSettingKey;
  values: Array<{ value: string; label: string }>;
}> = [
  {
    title: "Theme",
    key: "theme",
    values: [
      { value: "auto", label: "Auto" },
      { value: "light", label: "Light" },
      { value: "dark", label: "Dark" },
    ],
  },
  {
    title: "Preset",
    key: "preset",
    values: [
      { value: "github", label: "GitHub" },
      { value: "reading", label: "Reading" },
      { value: "compact", label: "Compact" },
      { value: "focus", label: "Focus" },
      { value: "print", label: "Print" },
    ],
  },
  {
    title: "Text size",
    key: "textSize",
    values: [
      { value: "small", label: "Small" },
      { value: "medium", label: "Medium" },
      { value: "large", label: "Large" },
      { value: "x-large", label: "X-Large" },
    ],
  },
  {
    title: "Width",
    key: "contentWidth",
    values: [
      { value: "comfortable", label: "Comfortable" },
      { value: "wide", label: "Wide" },
      { value: "full", label: "Full" },
    ],
  },
  {
    title: "Highlight",
    key: "comments.highlightIntensity",
    values: [
      { value: "subtle", label: "Subtle" },
      { value: "medium", label: "Medium" },
      { value: "strong", label: "Strong" },
    ],
  },
];

export function isSettingsPanelOpen(): boolean {
  return _open;
}

function applyOpenState(): void {
  if (!_settings) return;
  _settings.panel.setAttribute("aria-hidden", _open ? "false" : "true");
  if (_open) {
    _settings.panel.setAttribute("data-open", "");
    _settings.panel.removeAttribute("inert");
    document.body.setAttribute("data-pmk-settings-open", "");
  } else {
    _settings.panel.removeAttribute("data-open");
    _settings.panel.setAttribute("inert", "");
    document.body.removeAttribute("data-pmk-settings-open");
  }
}

export function openSettingsPanel(): void {
  _open = true;
  applyOpenState();
}

export function closeSettingsPanel(): void {
  _open = false;
  applyOpenState();
}

export function toggleSettingsPanel(): void {
  if (_open) closeSettingsPanel();
  else openSettingsPanel();
}

export function ensureSettingsPanel(cfg: SettingsConfig): HTMLElement {
  if (_settings && document.body.contains(_settings.panel)) {
    _settings.cfg = cfg;
    applyOpenState();
    return _settings.panel;
  }
  if (_settings) {
    document.removeEventListener("keydown", _settings.onKeydown);
    _settings = null;
  }

  const panel = document.createElement("aside");
  panel.className = "pmk-settings-panel";
  panel.setAttribute("aria-label", "Preview settings");

  const head = document.createElement("div");
  head.className = "pmk-settings-head";
  const title = document.createElement("span");
  title.className = "pmk-settings-title";
  title.textContent = "Preview settings";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "pmk-settings-close";
  close.setAttribute("aria-label", "Close preview settings");
  close.textContent = "Close";
  close.addEventListener("click", () => closeSettingsPanel());
  head.append(title, close);

  const content = document.createElement("div");
  content.className = "pmk-settings-content";

  panel.append(head, content);
  document.body.appendChild(panel);

  const onKeydown = (e: KeyboardEvent): void => {
    if (e.key === "Escape" && _open) {
      e.stopPropagation();
      closeSettingsPanel();
    }
  };
  document.addEventListener("keydown", onKeydown);

  _settings = { panel, content, cfg, onKeydown };
  applyOpenState();
  return panel;
}

function selectedValue(state: PreviewSettingsState, key: PreviewSettingKey): string {
  switch (key) {
    case "theme":
      return state.theme;
    case "preset":
      return state.preset;
    case "textSize":
      return state.textSize;
    case "contentWidth":
      return state.contentWidth;
    case "comments.highlightIntensity":
      return state.highlightIntensity;
    case "lineHeight":
      return String(state.lineHeight);
  }
}

function sendSetting(key: PreviewSettingKey, value: PreviewSettingValue): void {
  if (!_settings) return;
  _settings.cfg.applyLocal(key, value);
  _settings.cfg.post({ v: 1, type: "updateSetting", key, value });
}

function segmentedGroup(state: PreviewSettingsState, group: (typeof GROUPS)[number]): HTMLElement {
  const fieldset = document.createElement("fieldset");
  fieldset.className = "pmk-settings-group";

  const legend = document.createElement("legend");
  legend.textContent = group.title;
  fieldset.appendChild(legend);

  const row = document.createElement("div");
  row.className = "pmk-settings-segmented";
  const current = selectedValue(state, group.key);
  for (const option of group.values) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pmk-settings-option";
    btn.textContent = option.label;
    btn.setAttribute("data-pmk-setting", group.key);
    btn.setAttribute("data-value", option.value);
    btn.setAttribute("aria-pressed", option.value === current ? "true" : "false");
    btn.addEventListener("click", () => {
      sendSetting(group.key, option.value);
      if (_state) {
        _state = { ..._state, [stateKey(group.key)]: option.value };
        renderSettingsPanel(_state);
      }
    });
    row.appendChild(btn);
  }
  fieldset.appendChild(row);
  return fieldset;
}

function stateKey(key: PreviewSettingKey): keyof PreviewSettingsState {
  if (key === "comments.highlightIntensity") return "highlightIntensity";
  return key;
}

function lineHeightControl(state: PreviewSettingsState): HTMLElement {
  const fieldset = document.createElement("fieldset");
  fieldset.className = "pmk-settings-group";

  const legend = document.createElement("legend");
  legend.textContent = "Line height";
  fieldset.appendChild(legend);

  const row = document.createElement("div");
  row.className = "pmk-settings-line-row";

  const input = document.createElement("input");
  input.className = "pmk-settings-line-height";
  input.type = "number";
  input.min = "1";
  input.max = "2.5";
  input.step = "0.05";
  input.value = state.lineHeight > 0 ? String(state.lineHeight) : "";
  input.placeholder = "Preset";
  input.setAttribute("aria-label", "Line height");
  input.addEventListener("change", () => {
    const value = Number.parseFloat(input.value);
    if (!Number.isFinite(value)) return;
    sendSetting("lineHeight", value);
    if (_state) _state = { ..._state, lineHeight: value };
  });

  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "pmk-settings-option";
  reset.textContent = "Preset";
  reset.addEventListener("click", () => {
    sendSetting("lineHeight", 0);
    if (_state) {
      _state = { ..._state, lineHeight: 0 };
      renderSettingsPanel(_state);
    }
  });

  row.append(input, reset);
  fieldset.appendChild(row);
  return fieldset;
}

export function renderSettingsPanel(state: PreviewSettingsState): void {
  if (!_settings) return;
  _state = state;
  _settings.content.replaceChildren();
  for (const group of GROUPS) {
    _settings.content.appendChild(segmentedGroup(state, group));
  }
  _settings.content.appendChild(lineHeightControl(state));
}
