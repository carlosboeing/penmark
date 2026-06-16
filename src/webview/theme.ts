/**
 * Theme resolution for the Penmark webview.
 *
 * No vscode imports — pure DOM/browser code (ADR 0001).
 *
 * Three modes:
 *   light/dark — user override; always wins regardless of IDE theme.
 *   auto       — follows the IDE body class (vscode-dark / vscode-light etc.)
 */

import type { ThemeMode } from "../core/protocol/messages.js";

// ---------------------------------------------------------------------------
// resolveTheme
// ---------------------------------------------------------------------------

/**
 * Resolve the effective theme given a setting and the current IDE body classes.
 *
 * light/dark settings OVERRIDE IDE detection — this is a core requirement.
 * auto maps IDE body classes: vscode-dark / vscode-high-contrast → dark,
 * everything else (including vscode-light, vscode-high-contrast-light, none) → light.
 */
export function resolveTheme(
  setting: ThemeMode,
  bodyClassList: DOMTokenList | string[],
): "light" | "dark" {
  if (setting === "light") return "light";
  if (setting === "dark") return "dark";

  // auto: inspect IDE body classes
  const has = (cls: string): boolean =>
    Array.isArray(bodyClassList) ? bodyClassList.includes(cls) : bodyClassList.contains(cls);

  if (has("vscode-dark") || has("vscode-high-contrast")) return "dark";
  return "light";
}

// ---------------------------------------------------------------------------
// applyResolvedTheme
// ---------------------------------------------------------------------------

/**
 * Apply the resolved theme to document.body by setting a data-theme attribute
 * and toggling theme-light / theme-dark classes.
 *
 * CSS stylesheets key off body.theme-light / body.theme-dark (or [data-theme]).
 */
export function applyResolvedTheme(resolved: "light" | "dark"): void {
  document.body.classList.remove("theme-light", "theme-dark");
  document.body.classList.add(`theme-${resolved}`);
  document.body.setAttribute("data-theme", resolved);
}

// ---------------------------------------------------------------------------
// observeIdeTheme
// ---------------------------------------------------------------------------

/**
 * Install a MutationObserver on document.body's class attribute.
 * Calls `cb` whenever the class list changes (used for auto mode re-resolution).
 *
 * Returns a disposer function that disconnects the observer.
 */
export function observeIdeTheme(cb: () => void): () => void {
  const observer = new MutationObserver(() => {
    cb();
  });

  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ["class"],
  });

  return () => observer.disconnect();
}
