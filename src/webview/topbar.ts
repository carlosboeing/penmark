/**
 * Penmark webview topbar — doc name display + theme mode switcher.
 *
 * No vscode imports (ADR 0001). No inline style attributes (CSP blocks them).
 * Posts {v:1, type:"themeSelected", theme} to the host when the user picks a mode.
 */

import type { ThemeMode } from "../core/protocol/messages.js";

const THEME_MODES: ThemeMode[] = ["light", "dark", "auto"];

/**
 * Comments-drawer affordances for the topbar (R15). Omitted by older callers /
 * the pre-comments render path — when absent, neither the toggle nor the chip
 * is rendered.
 */
export interface TopbarCommentsOpts {
  /** Open (live-anchored) comment count, shown on the drawer toggle. */
  openCount: number;
  /** Needs-attention (orphan / content-removed) count; the chip shows when > 0. */
  attention: number;
  /** Toggle the comments drawer. */
  onToggleDrawer: () => void;
  /** Open the drawer at the needs-attention section (chip click). */
  onOpenAttention: () => void;
}

export interface TopbarSettingsOpts {
  settingsOpen: boolean;
  onToggleSettings: () => void;
}

/**
 * Install (or re-install) the topbar into `container`.
 *
 * Safe to call multiple times — clears the container and rebuilds.
 * All node creation uses safe DOM methods (no innerHTML with untrusted content).
 *
 * When `comments` is supplied (R15), a discreet amber attention chip
 * ("N orphaned", only when `attention > 0`) and a "Comments (N)" drawer toggle
 * are added.
 */
export function installTopbar(
  container: HTMLElement,
  docName: string,
  postMessage: (msg: unknown) => void,
  comments?: TopbarCommentsOpts,
  settings?: TopbarSettingsOpts,
): void {
  // Clear previous content safely.
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }

  // Doc name label
  const nameEl = document.createElement("span");
  nameEl.className = "pmk-topbar-docname";
  nameEl.textContent = docName;
  container.appendChild(nameEl);

  // Amber attention chip — discreet, only when something needs attention.
  if (comments && comments.attention > 0) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "pmk-topbar-chip";
    chip.setAttribute("title", `${comments.attention} comment(s) could not be re-anchored`);
    const dot = document.createElement("span");
    dot.className = "pmk-topbar-chip-dot";
    dot.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.textContent = `${comments.attention} orphaned`;
    chip.append(dot, label);
    chip.addEventListener("click", () => comments.onOpenAttention());
    container.appendChild(chip);
  }

  // Theme switcher group
  const switcher = document.createElement("div");
  switcher.className = "pmk-topbar-switcher";

  for (const mode of THEME_MODES) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pmk-topbar-btn";
    btn.setAttribute("data-theme-mode", mode);
    btn.textContent = mode;
    btn.addEventListener("click", () => {
      postMessage({ v: 1, type: "themeSelected", theme: mode });
    });
    switcher.appendChild(btn);
  }

  container.appendChild(switcher);

  if (settings) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "pmk-topbar-btn pmk-topbar-settings";
    toggle.textContent = "Preview settings";
    toggle.setAttribute("aria-expanded", settings.settingsOpen ? "true" : "false");
    toggle.addEventListener("click", () => settings.onToggleSettings());
    container.appendChild(toggle);
  }

  // Comments drawer toggle (R15).
  if (comments) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "pmk-topbar-btn pmk-topbar-comments";
    toggle.textContent = `Comments (${comments.openCount})`;
    toggle.addEventListener("click", () => comments.onToggleDrawer());
    container.appendChild(toggle);
  }
}
