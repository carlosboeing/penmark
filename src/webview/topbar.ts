/**
 * Penmark webview topbar — compact document identity, preview state and actions.
 *
 * No vscode imports (ADR 0001). No inline style attributes (CSP blocks them).
 * Posts {v:1, type:"themeSelected", theme} to the host when theme mode cycles.
 */

import type { ThemeMode } from "../core/protocol/messages.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const THEME_MODES: ThemeMode[] = ["auto", "light", "dark"];

const ICON_PATHS = {
  document: "M4 2.5h7l4 4v11H4z M11 2.5v4h4",
  theme: "M10 2.5v2 M10 15.5v2 M2.5 10h2 M15.5 10h2 M4.7 4.7l1.4 1.4 M13.9 13.9l1.4 1.4 M15.3 4.7l-1.4 1.4 M6.1 13.9l-1.4 1.4 M10 6.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7",
  settings: "M4 5h12 M4 10h12 M4 15h12 M8 3.5v3 M13 8.5v3 M7 13.5v3",
  export: "M10 3v9 M10 12l3-3 M10 12L7 9 M4 14v3h12v-3",
  comments: "M4 4h12v9H9l-4 3v-3H4z",
  find: "M9 3.5a5.5 5.5 0 1 0 0 11a5.5 5.5 0 1 0 0-11 M13 13l3.5 3.5",
} as const;

function staticIcon(pathData: string, className?: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 20 20");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  if (className) svg.setAttribute("class", className);
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", pathData);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.5");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.appendChild(path);
  return svg;
}

function nameButton(button: HTMLButtonElement, name: string): void {
  button.setAttribute("aria-label", name);
  button.title = name;
}

function visibleLabel(text: string): HTMLSpanElement {
  const label = document.createElement("span");
  label.className = "pmk-topbar-label";
  label.setAttribute("aria-hidden", "true");
  label.textContent = text;
  return label;
}

export interface TopbarCommentsOpts {
  openCount: number;
  attention: number;
  drawerOpen: boolean;
  onToggleDrawer: () => void;
  onOpenAttention: () => void;
}

export interface TopbarSettingsOpts {
  settingsOpen: boolean;
  onToggleSettings: () => void;
}

export interface TopbarExportOpts {
  onOpenExport: () => void;
}

export interface TopbarFindOpts {
  open: boolean;
  onOpenFind: () => void;
}

export function installTopbar(
  container: HTMLElement,
  docName: string,
  onThemeSelected: (theme: ThemeMode) => void,
  comments?: TopbarCommentsOpts,
  settings?: TopbarSettingsOpts,
  exportOpts?: TopbarExportOpts,
  initialTheme: ThemeMode = "auto",
  readingMeta?: string,
  findOpts?: TopbarFindOpts,
): void {
  while (container.firstChild) container.removeChild(container.firstChild);

  const documentZone = document.createElement("div");
  documentZone.className = "pmk-topbar-document";
  const documentIcon = document.createElement("span");
  documentIcon.className = "pmk-topbar-document-icon";
  documentIcon.appendChild(staticIcon(ICON_PATHS.document));
  const nameEl = document.createElement("span");
  nameEl.className = "pmk-topbar-docname";
  nameEl.textContent = docName;
  documentZone.append(documentIcon, nameEl);
  if (readingMeta) {
    const metadata = document.createElement("span");
    metadata.className = "pmk-topbar-reading-meta";
    metadata.textContent = readingMeta;
    documentZone.appendChild(metadata);
  }

  const previewZone = document.createElement("div");
  previewZone.className = "pmk-topbar-preview";
  const themeButton = document.createElement("button");
  themeButton.type = "button";
  themeButton.className = "pmk-topbar-btn pmk-topbar-switcher";
  themeButton.dataset.pmkTopbarControl = "theme";
  themeButton.setAttribute("data-active", "true");
  themeButton.appendChild(staticIcon(ICON_PATHS.theme));
  const nextTheme =
    THEME_MODES[(THEME_MODES.indexOf(initialTheme) + 1) % THEME_MODES.length] ?? "auto";
  const themeName = `Theme: ${initialTheme}. Switch to ${nextTheme}`;
  themeButton.setAttribute("data-theme-mode", initialTheme);
  nameButton(themeButton, themeName);
  themeButton.addEventListener("click", () => onThemeSelected(nextTheme));
  previewZone.appendChild(themeButton);

  const actions = document.createElement("nav");
  actions.className = "pmk-topbar-actions";
  actions.setAttribute("aria-label", "Preview actions");

  if (comments && comments.attention > 0) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "pmk-topbar-chip";
    chip.dataset.pmkTopbarControl = "attention";
    chip.setAttribute("title", `${comments.attention} comment(s) could not be re-anchored`);
    const dot = document.createElement("span");
    dot.className = "pmk-topbar-chip-dot";
    dot.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.textContent = `${comments.attention} orphaned`;
    chip.append(dot, label);
    chip.addEventListener("click", () => comments.onOpenAttention());
    actions.appendChild(chip);
  }

  if (settings) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "pmk-topbar-btn pmk-topbar-settings";
    toggle.dataset.pmkTopbarControl = "settings";
    nameButton(toggle, "Preview settings");
    toggle.setAttribute("aria-controls", "penmark-settings-panel");
    toggle.setAttribute("aria-expanded", String(settings.settingsOpen));
    toggle.append(staticIcon(ICON_PATHS.settings), visibleLabel("Settings"));
    toggle.addEventListener("click", () => settings.onToggleSettings());
    actions.appendChild(toggle);
  }

  if (exportOpts) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pmk-topbar-btn pmk-topbar-export";
    button.dataset.pmkTopbarControl = "export";
    nameButton(button, "Export document");
    button.append(staticIcon(ICON_PATHS.export), visibleLabel("Export"));
    button.addEventListener("click", () => exportOpts.onOpenExport());
    actions.appendChild(button);
  }

  if (findOpts) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pmk-topbar-btn pmk-topbar-find";
    button.dataset.pmkTopbarControl = "find";
    nameButton(button, "Search document");
    button.setAttribute("aria-pressed", String(findOpts.open));
    button.append(staticIcon(ICON_PATHS.find), visibleLabel("Search"));
    button.addEventListener("click", () => findOpts.onOpenFind());
    actions.appendChild(button);
  }

  if (comments) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "pmk-topbar-btn pmk-topbar-comments";
    toggle.dataset.pmkTopbarControl = "comments";
    const name = `Comments, ${comments.openCount} open`;
    nameButton(toggle, name);
    toggle.setAttribute("aria-controls", "penmark-comments-drawer");
    toggle.setAttribute("aria-expanded", String(comments.drawerOpen));
    const count = document.createElement("span");
    count.className = "pmk-topbar-count";
    count.setAttribute("aria-hidden", "true");
    count.textContent = String(comments.openCount);
    toggle.append(staticIcon(ICON_PATHS.comments), visibleLabel("Comments"), count);
    toggle.addEventListener("click", () => comments.onToggleDrawer());
    actions.appendChild(toggle);
  }

  container.append(documentZone, previewZone, actions);
}
