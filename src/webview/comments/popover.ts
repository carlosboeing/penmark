/**
 * Comment popover for the Penmark webview (R11, design §5.2 + mockup
 * docs/assets/penmark-v1-concept.html).
 *
 * Clicking a highlight opens a single floating card showing the comment's author
 * (with a provenance-coloured avatar — blue human / purple agent), timestamp,
 * and body, plus a Resolve action. Resolve == delete (ADR 0002): it posts
 * `resolveComment` and the host removes the entry + markers in one WorkspaceEdit;
 * the re-render then drops the highlight.
 *
 * Only one popover is open at a time. It closes on Resolve, Escape, or an
 * outside click. The card is appended to <body> (outside #penmark-root) so a
 * morphdom re-render never strips it, and positioned over the clicked highlight
 * via the CSSOM (`element.style`, which CSP style-src does not govern — only
 * markup `style=""`/`<style>` are blocked).
 *
 * ADR 0001: no vscode imports — host communication via postMessage only.
 * The DOM is built with createElement + textContent (never innerHTML) so author
 * and body text can never inject markup.
 */

import type { WireComment, WebviewToHost } from "../../core/protocol/messages.js";
import { registerPenmarkSurface } from "../keyboard.js";

type PostMessage = (msg: WebviewToHost) => void;

interface OpenPopover {
  el: HTMLElement;
  commentId: string;
  onMousedown: (e: MouseEvent) => void;
  unregister: (restoreFocus?: boolean) => void;
}

let _open: OpenPopover | null = null;

function commentElements(id: string): HTMLElement[] {
  const root = document.getElementById("penmark-root");
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>("[data-pmk-id]")).filter(
    (element) => element.getAttribute("data-pmk-id") === id,
  );
}

/** Whether a comment popover is currently open. */
export function isPopoverOpen(): boolean {
  return _open !== null;
}

/** Retrieve the ID of the comment whose popover is currently open. */
export function getActiveCommentId(): string | null {
  return _open ? _open.commentId : null;
}

/** Close the open popover (if any) and detach its document listeners. */
export function closeCommentPopover(restoreFocus = true): void {
  if (!_open) return;
  document.removeEventListener("mousedown", _open.onMousedown, true);
  _open.unregister(restoreFocus);
  _open.el.remove();
  _open = null;

  // Clear active styling from highlights
  document
    .querySelectorAll("#penmark-root [data-pmk-id]")
    .forEach((x) => x.classList.remove("pmk-hl-active"));
}

/** First character of `author`, upper-cased, for the avatar (fallback "?"). */
function avatarInitial(author: string): string {
  const c = author.trim().charAt(0);
  return c ? c.toUpperCase() : "?";
}

/**
 * Open the comment popover for `comment`, anchored over `anchor`. Replaces any
 * already-open popover. Resolve posts `resolveComment` and closes.
 */
export function openCommentPopover(
  anchor: HTMLElement,
  comment: WireComment,
  postMessage: PostMessage,
  editMode = false,
): void {
  const active = document.activeElement;
  const opener = active instanceof HTMLElement && active !== document.body ? active : anchor;
  closeCommentPopover(false);

  const el = document.createElement("div");
  el.className = "pmk-popover";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", `Comment by ${comment.author}`);

  // --- meta row: avatar + author + timestamp ---
  const meta = document.createElement("div");
  meta.className = "pmk-popover-meta";

  const avatar = document.createElement("span");
  avatar.className = `pmk-avatar pmk-avatar-${comment.provenance}`;
  avatar.textContent = avatarInitial(comment.author);
  avatar.setAttribute("aria-hidden", "true");

  const who = document.createElement("span");
  who.className = "pmk-popover-who";
  who.textContent = comment.author;

  const when = document.createElement("span");
  when.className = "pmk-popover-when";
  when.textContent = `${comment.provenance} · ${comment.timestamp}`;

  meta.append(avatar, who, when);
  el.appendChild(meta);

  // --- degraded-recovered affordance (the anchored text was edited) ---
  if (comment.state === "degraded-recovered") {
    const note = document.createElement("div");
    note.className = "pmk-popover-note";
    note.textContent = "This text was edited since it was commented.";
    el.appendChild(note);
  }

  // --- body container ---
  const body = document.createElement("div");
  body.className = "pmk-popover-body";
  el.appendChild(body);

  // --- actions container ---
  const actions = document.createElement("div");
  actions.className = "pmk-popover-actions";
  el.appendChild(actions);

  function renderViewMode() {
    body.replaceChildren();
    body.textContent = comment.body;

    actions.replaceChildren();

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "pmk-popover-btn";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => {
      renderEditMode();
    });

    const resolveBtn = document.createElement("button");
    resolveBtn.type = "button";
    resolveBtn.className = "pmk-popover-btn primary";
    resolveBtn.textContent = "Resolve";
    resolveBtn.addEventListener("click", () => {
      postMessage({ v: 1, type: "resolveComment", id: comment.id });
      closeCommentPopover();
    });

    actions.append(editBtn, resolveBtn);
  }

  function renderEditMode() {
    body.replaceChildren();

    const textarea = document.createElement("textarea");
    textarea.className = "pmk-commentbox-input";
    textarea.value = comment.body;
    textarea.rows = 3;
    textarea.style.width = "100%";
    textarea.style.boxSizing = "border-box";
    textarea.style.resize = "vertical";
    body.appendChild(textarea);

    actions.replaceChildren();

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "pmk-popover-btn";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => {
      if (editMode) {
        closeCommentPopover();
      } else {
        renderViewMode();
      }
    });

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "pmk-popover-btn primary";
    saveBtn.textContent = "Save";
    saveBtn.addEventListener("click", () => {
      const val = textarea.value.trim();
      if (val === "") return;
      postMessage({ v: 1, type: "editComment", id: comment.id, body: val });
      closeCommentPopover();
    });

    actions.append(cancelBtn, saveBtn);
    textarea.focus();
  }

  if (editMode) {
    renderEditMode();
  } else {
    renderViewMode();
  }

  document.body.appendChild(el);
  positionOver(el, anchor);
  const firstControl = el.querySelector<HTMLElement>("textarea, button, input, select, a[href]");
  firstControl?.focus();

  // Apply active styling to the new active highlights
  commentElements(comment.id).forEach((x) => x.classList.add("pmk-hl-active"));

  // Outside-click closes (capture phase so it sees the click before re-render).
  const onMousedown = (e: MouseEvent): void => {
    if (!el.contains(e.target as Node)) closeCommentPopover();
  };
  document.addEventListener("mousedown", onMousedown, true);
  const unregister = registerPenmarkSurface(el, opener, () => closeCommentPopover());
  _open = { el, commentId: comment.id, onMousedown, unregister };
}

/** Position `el` just below the anchor's left edge, kept within the viewport. */
function positionOver(el: HTMLElement, anchor: HTMLElement): void {
  const rect = anchor.getBoundingClientRect();
  const margin = 8;
  const width = el.offsetWidth || 330;
  let left = rect.left + window.scrollX;
  // Keep the card inside the viewport's right edge.
  const maxLeft = window.scrollX + document.documentElement.clientWidth - width - margin;
  if (left > maxLeft) left = Math.max(window.scrollX + margin, maxLeft);
  el.style.left = `${left}px`;
  el.style.top = `${rect.bottom + window.scrollY + margin}px`;
}
