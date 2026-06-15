/**
 * Comment add-box for the Penmark webview (R14, design §5.2/§5.3 + mockup).
 *
 * Turns a selection (mapped to a source range by R10's selectionToSourceRange)
 * into an `addComment` message: a small card with a textarea and Comment/Cancel
 * actions, anchored over the selection. Submitting posts
 * `{ addComment, range, quote, body }`; the host plans the anchor + applies one
 * WorkspaceEdit (R7), and the re-render shows the new highlight.
 *
 * An in-progress body is persisted via an injected {@link CommentDraftStore}
 * (backed by getState/setState in main.ts) so a webview reload does not lose a
 * half-written comment (design §5.3). The draft is cleared on submit and cancel.
 *
 * Only one box is open at a time. It closes on submit, Cancel, or Escape. Like
 * the popover it lives in <body> (outside #penmark-root) so morphdom never
 * strips it, and is positioned via the CSSOM.
 *
 * ADR 0001: no vscode imports — host communication via postMessage only.
 * Built with createElement + textContent (never innerHTML).
 */

import type { WebviewToHost } from "../../core/protocol/messages.js";

type PostMessage = (msg: WebviewToHost) => void;

/** Persistence hooks for an in-progress comment body (design §5.3 state model). */
export interface CommentDraftStore {
  get(): string | undefined;
  set(body: string | undefined): void;
}

interface OpenBox {
  el: HTMLElement;
  onKeydown: (e: KeyboardEvent) => void;
}

let _open: OpenBox | null = null;

/** Whether a comment add-box is currently open. */
export function isCommentBoxOpen(): boolean {
  return _open !== null;
}

/** Close the open box (if any) and detach its document listeners. */
export function closeCommentBox(): void {
  if (!_open) return;
  document.removeEventListener("keydown", _open.onKeydown, true);
  _open.el.remove();
  _open = null;
}

/**
 * Open the add-comment box for `range`/`quote`, anchored over `anchor`. Replaces
 * any already-open box. Submitting a non-empty body posts `addComment` and
 * clears the draft; Cancel/Escape close and clear the draft.
 */
export function openCommentBox(
  anchor: HTMLElement,
  range: { start: number; end: number },
  quote: string,
  postMessage: PostMessage,
  draft?: CommentDraftStore,
): void {
  closeCommentBox();

  const el = document.createElement("div");
  el.className = "pmk-commentbox";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", "Add a comment");

  const ta = document.createElement("textarea");
  ta.className = "pmk-commentbox-input";
  ta.rows = 3;
  ta.placeholder = "Add a comment…";
  ta.setAttribute("aria-label", "Comment body");
  const saved = draft?.get();
  if (saved) ta.value = saved;
  ta.addEventListener("input", () => draft?.set(ta.value === "" ? undefined : ta.value));
  el.appendChild(ta);

  const actions = document.createElement("div");
  actions.className = "pmk-commentbox-actions";

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "pmk-commentbox-btn";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => {
    draft?.set(undefined);
    closeCommentBox();
  });

  const submit = document.createElement("button");
  submit.type = "button";
  submit.className = "pmk-commentbox-btn primary";
  submit.textContent = "Comment";
  submit.addEventListener("click", () => {
    const body = ta.value.trim();
    if (body === "") return; // empty body is rejected — no message
    postMessage({ v: 1, type: "addComment", range, quote, body });
    draft?.set(undefined);
    closeCommentBox();
  });

  actions.append(cancel, submit);
  el.appendChild(actions);

  document.body.appendChild(el);
  positionOver(el, anchor);

  const onKeydown = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.stopPropagation();
      draft?.set(undefined);
      closeCommentBox();
    }
  };
  document.addEventListener("keydown", onKeydown, true);

  _open = { el, onKeydown };
  ta.focus();
}

/** Position `el` just below the anchor's left edge, kept within the viewport. */
function positionOver(el: HTMLElement, anchor: HTMLElement): void {
  const rect = anchor.getBoundingClientRect();
  const margin = 8;
  const width = el.offsetWidth || 320;
  let left = rect.left + window.scrollX;
  const maxLeft = window.scrollX + document.documentElement.clientWidth - width - margin;
  if (left > maxLeft) left = Math.max(window.scrollX + margin, maxLeft);
  el.style.left = `${left}px`;
  el.style.top = `${rect.bottom + window.scrollY + margin}px`;
}
