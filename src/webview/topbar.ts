/**
 * Penmark webview topbar — doc name display + theme mode switcher.
 *
 * No vscode imports (ADR 0001). No inline style attributes (CSP blocks them).
 * Posts {v:1, type:"themeSelected", theme} to the host when the user picks a mode.
 */

import type { ThemeMode } from "../core/protocol/messages.js";
import { createTopbarIcon } from "./topbarIcons.js";

const THEME_MODES: ThemeMode[] = ["light", "dark", "auto"];

const THEME_LABELS: Record<ThemeMode, string> = {
  light: "Light theme",
  dark: "Dark theme",
  auto: "Match editor theme",
};

const THEME_ICONS = {
  light: "sun",
  dark: "moon",
  auto: "auto",
} as const;

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

function iconButton(opts: {
  className: string;
  label: string;
  icon: ReturnType<typeof createTopbarIcon>;
  onClick: () => void;
  badge?: number;
}): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = opts.className;
  btn.setAttribute("aria-label", opts.label);
  btn.setAttribute("title", opts.label);
  btn.appendChild(opts.icon);
  if (opts.badge !== undefined && opts.badge > 0) {
    const badge = document.createElement("span");
    badge.className = "pmk-topbar-badge";
    badge.textContent = opts.badge > 9 ? "9+" : String(opts.badge);
    badge.setAttribute("aria-hidden", "true");
    btn.appendChild(badge);
  }
  btn.addEventListener("click", opts.onClick);
  return btn;
}

/**
 * Install (or re-install) the topbar into `container`.
 *
 * Safe to call multiple times — clears the container and rebuilds.
 * All node creation uses safe DOM methods (no innerHTML with untrusted content).
 */
export function installTopbar(
  container: HTMLElement,
  docName: string,
  postMessage: (msg: unknown) => void,
  comments?: TopbarCommentsOpts,
  onOpenSettings?: () => void,
  currentTheme: ThemeMode = "auto",
): void {
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }

  const left = document.createElement("div");
  left.className = "pmk-topbar-left";

  const nameEl = document.createElement("span");
  nameEl.className = "pmk-topbar-docname";
  nameEl.textContent = docName;
  left.appendChild(nameEl);

  if (comments && comments.attention > 0) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "pmk-topbar-chip";
    chip.setAttribute("title", `${comments.attention} comment(s) could not be re-anchored`);
    chip.setAttribute("aria-label", `${comments.attention} orphaned comments`);
    const dot = document.createElement("span");
    dot.className = "pmk-topbar-chip-dot";
    dot.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.textContent = `${comments.attention} orphaned`;
    chip.appendChild(dot);
    chip.appendChild(label);
    chip.addEventListener("click", () => comments.onOpenAttention());
    left.appendChild(chip);
  }

  container.appendChild(left);

  const actions = document.createElement("div");
  actions.className = "pmk-topbar-actions";

  const themeGroup = document.createElement("div");
  themeGroup.className = "pmk-topbar-theme";
  themeGroup.setAttribute("role", "group");
  themeGroup.setAttribute("aria-label", "Preview theme");

  for (const mode of THEME_MODES) {
    const label = THEME_LABELS[mode];
    const btn = iconButton({
      className: "pmk-topbar-icon-btn pmk-topbar-theme-btn",
      label,
      icon: createTopbarIcon(THEME_ICONS[mode]),
      onClick: () => postMessage({ v: 1, type: "themeSelected", theme: mode }),
    });
    btn.setAttribute("data-theme-mode", mode);
    if (mode === currentTheme) {
      btn.setAttribute("data-active", "true");
    }
    themeGroup.appendChild(btn);
  }

  actions.appendChild(themeGroup);

  const tools = document.createElement("div");
  tools.className = "pmk-topbar-tools";
  tools.setAttribute("role", "group");
  tools.setAttribute("aria-label", "Preview tools");

  if (onOpenSettings) {
    tools.appendChild(
      iconButton({
        className: "pmk-topbar-icon-btn pmk-topbar-settings",
        label: "Preview settings",
        icon: createTopbarIcon("settings"),
        onClick: onOpenSettings,
      }),
    );
  }

  if (comments) {
    const commentLabel =
      comments.openCount > 0
        ? `Comments (${comments.openCount})`
        : "Comments";
    tools.appendChild(
      iconButton({
        className: "pmk-topbar-icon-btn pmk-topbar-comments",
        label: commentLabel,
        icon: createTopbarIcon("comments"),
        badge: comments.openCount,
        onClick: () => comments.onToggleDrawer(),
      }),
    );
  }

  actions.appendChild(tools);
  container.appendChild(actions);
}
