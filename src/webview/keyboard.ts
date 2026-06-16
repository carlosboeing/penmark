/**
 * Keyboard navigation for the preview webview (v1.0 polish).
 */

import type { WireComment } from "../core/protocol/messages.js";
import { closeDrawer, focusDrawerItem, isDrawerOpen, openDrawer, toggleDrawer } from "./comments/drawer.js";
import { closeCommentPopover } from "./comments/popover.js";
import { scrollToCommentId } from "./comments/highlights.js";

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
export function installKeyboardNav(getComments: () => WireComment[]): void {
  let drawerIndex = 0;
  let commentIndex = 0;

  document.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

    const comments = getComments();
    const ids = commentIds(comments);

    switch (e.key) {
      case "d":
        if (!e.metaKey && !e.ctrlKey && !e.altKey) {
          toggleDrawer();
          e.preventDefault();
        }
        break;
      case "j":
        if (isDrawerOpen()) {
          drawerIndex = Math.min(drawerIndex + 1, Math.max(0, comments.length - 1));
          focusDrawerItem(drawerIndex);
          e.preventDefault();
        }
        break;
      case "k":
        if (isDrawerOpen()) {
          drawerIndex = Math.max(0, drawerIndex - 1);
          focusDrawerItem(drawerIndex);
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
      case "Escape":
        closeCommentPopover();
        if (isDrawerOpen()) {
          closeDrawer();
          e.preventDefault();
        }
        break;
      default:
        break;
    }
  });
}
