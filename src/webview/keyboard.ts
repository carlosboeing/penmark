/**
 * Keyboard navigation for the preview webview (v1.0 polish).
 */

import type { WireComment } from "../core/protocol/messages.js";
import { scrollToCommentId } from "./comments/highlights.js";

export interface KeyboardDrawerControls {
  toggle(): void;
  isOpen(): boolean;
  focusItem(index: number): void;
}

interface PenmarkSurface {
  el: HTMLElement;
  opener: HTMLElement | null;
  openerControlId: string | null;
  close: () => void;
  restoreFocus: boolean;
}

function focusReturnTarget(surface: PenmarkSurface): HTMLElement | null {
  if (surface.opener && isFocusable(surface.opener)) return surface.opener;
  if (!surface.openerControlId) return null;
  return (
    Array.from(document.querySelectorAll<HTMLElement>("[data-pmk-topbar-control]")).find(
      (candidate) =>
        candidate.dataset.pmkTopbarControl === surface.openerControlId && isFocusable(candidate),
    ) ?? null
  );
}

const _surfaces: PenmarkSurface[] = [];

function isFocusable(el: HTMLElement): boolean {
  if (!el.isConnected || el.closest("[inert]") || el.hidden) return false;
  if (el.matches("button, input, select, textarea, a[href], [contenteditable='true']")) {
    return !(el as HTMLButtonElement).disabled;
  }
  return el.tabIndex >= 0;
}

function pruneSurfaces(): void {
  for (let i = _surfaces.length - 1; i >= 0; i -= 1) {
    if (!_surfaces[i]!.el.isConnected) _surfaces.splice(i, 1);
  }
}

/** Register an open Penmark-owned surface and return its close cleanup. */
export function registerPenmarkSurface(
  el: HTMLElement,
  opener: HTMLElement | null,
  close: () => void,
): (restoreFocus?: boolean) => void {
  pruneSurfaces();
  const surface: PenmarkSurface = {
    el,
    opener,
    openerControlId: opener?.dataset.pmkTopbarControl ?? null,
    close,
    restoreFocus: true,
  };
  _surfaces.push(surface);
  return (restoreFocus = surface.restoreFocus): void => {
    const index = _surfaces.indexOf(surface);
    if (index !== -1) _surfaces.splice(index, 1);
    if (restoreFocus) focusReturnTarget(surface)?.focus();
  };
}

/** Close one topmost Penmark surface, optionally suppressing focus restoration. */
export function closeTopmostPenmarkSurface(restoreFocus = true): boolean {
  pruneSurfaces();
  const surface = _surfaces.at(-1);
  if (!surface) return false;
  surface.restoreFocus = restoreFocus;
  surface.close();
  const index = _surfaces.indexOf(surface);
  if (index !== -1) {
    _surfaces.splice(index, 1);
    if (restoreFocus) focusReturnTarget(surface)?.focus();
  }
  return true;
}

document.addEventListener(
  "keydown",
  (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    pruneSurfaces();
    const top = _surfaces.at(-1);
    if (!top) return;
    const path = e.composedPath();
    const active = document.activeElement;
    const owned = path.includes(top.el) || (active instanceof Node && top.el.contains(active));
    if (!owned) return;
    if (closeTopmostPenmarkSurface()) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  },
  true,
);

let _helpEl: HTMLElement | null = null;

function ensureHelp(): HTMLElement {
  if (_helpEl) return _helpEl;
  const el = document.createElement("div");
  el.id = "pmk-keyboard-help";
  el.className = "pmk-keyboard-help";
  el.hidden = true;
  el.innerHTML =
    "<strong>Shortcuts</strong> d drawer · j/k navigate drawer · n/p next/prev comment · ? help · Esc close";
  document.body.appendChild(el);
  _helpEl = el;
  return el;
}

function commentIds(comments: WireComment[]): string[] {
  return comments.filter((c) => c.extent).map((c) => c.id);
}

/**
 * Install global keyboard shortcuts. Call once at bootstrap; pass fresh comments
 * on each render via `updateKeyboardComments`.
 */
export function installKeyboardNav(
  getComments: () => WireComment[],
  drawer: KeyboardDrawerControls,
): void {
  let drawerIndex = 0;
  let commentIndex = 0;

  document.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

    const comments = getComments();
    const ids = commentIds(comments);

    switch (e.key) {
      case "d":
        if (!e.metaKey && !e.ctrlKey && !e.altKey) {
          drawer.toggle();
          e.preventDefault();
        }
        break;
      case "j":
        if (drawer.isOpen()) {
          drawerIndex = Math.min(drawerIndex + 1, Math.max(0, comments.length - 1));
          drawer.focusItem(drawerIndex);
          e.preventDefault();
        }
        break;
      case "k":
        if (drawer.isOpen()) {
          drawerIndex = Math.max(0, drawerIndex - 1);
          drawer.focusItem(drawerIndex);
          e.preventDefault();
        }
        break;
      case "n":
        if (ids.length > 0) {
          commentIndex = (commentIndex + 1) % ids.length;
          scrollToCommentId(ids[commentIndex] as string);
          e.preventDefault();
        }
        break;
      case "p":
        if (ids.length > 0) {
          commentIndex = (commentIndex - 1 + ids.length) % ids.length;
          scrollToCommentId(ids[commentIndex] as string);
          e.preventDefault();
        }
        break;
      case "?":
        {
          const help = ensureHelp();
          help.hidden = !help.hidden;
          e.preventDefault();
        }
        break;
      default:
        break;
    }
  });
}
