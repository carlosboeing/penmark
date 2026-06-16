/**
 * Comments drawer for the Penmark webview (R15, design §3/§5.2 + mockup).
 *
 * A webview-internal slide-in panel (NOT a VS Code view, design §5.2) listing:
 *   - OPEN comments (live extent): quote + body + provenance avatar, with
 *     "Jump to source" (posts jumpToSource) and "Resolve" (posts resolveComment).
 *   - NEEDS ATTENTION (orphan / content-removed, extent === null): the preserved
 *     quote + body with "Re-anchor" and "Delete". Delete posts resolveComment
 *     (resolve = delete, ADR 0002). Re-anchor hands off to an injected callback
 *     that drives the "select new location" flow in main.ts (resolve-old +
 *     add-new — two undo steps for v0.5; a single combined edit would need a new
 *     protocol message + host handler, outside R15's webview-only scope).
 *
 * Lives in <body> (outside #penmark-root) so morphdom never strips it; the open
 * comment set is re-rendered on every render/comments message. Open/closed state
 * persists via an injected {@link DrawerStateStore} (getState/setState in main.ts)
 * so a reload keeps the drawer where the user left it.
 *
 * ADR 0001: no vscode imports — host communication via postMessage only.
 * Built with createElement + textContent (never innerHTML).
 */

import type { WireComment, WebviewToHost } from "../../core/protocol/messages.js";

type PostMessage = (msg: WebviewToHost) => void;

/** Drives the "select new location" re-anchor flow (implemented in main.ts). */
type ReanchorRequest = (id: string, quote: string, body: string) => void;

/** Persistence hooks for the drawer's open/closed state (design §5.3). */
export interface DrawerStateStore {
  get(): boolean;
  set(open: boolean): void;
}

interface DrawerConfig {
  post: PostMessage;
  onReanchor: ReanchorRequest;
  store?: DrawerStateStore;
}

interface DrawerInternals {
  panel: HTMLElement;
  content: HTMLElement;
  cfg: DrawerConfig;
  onKeydown: (e: KeyboardEvent) => void;
}

let _d: DrawerInternals | null = null;
let _open = false;

/** A comment is "needs attention" when reconcile left it without a live span. */
function needsAttention(c: WireComment): boolean {
  return c.extent === null;
}

/** Split comments into the open list and the needs-attention bucket (§8 states). */
export function bucketComments(comments: WireComment[]): {
  open: WireComment[];
  attention: WireComment[];
} {
  const open: WireComment[] = [];
  const attention: WireComment[] = [];
  for (const c of comments) (needsAttention(c) ? attention : open).push(c);
  return { open, attention };
}

/** First character of `author`, upper-cased, for the avatar (fallback "?"). */
function avatarInitial(author: string): string {
  const ch = author.trim().charAt(0);
  return ch ? ch.toUpperCase() : "?";
}

/** Whether the drawer is currently open. */
export function isDrawerOpen(): boolean {
  return _open;
}

function applyOpenState(): void {
  if (!_d) return;
  _d.panel.setAttribute("aria-hidden", _open ? "false" : "true");
  // `inert` keeps the off-screen (closed) drawer's buttons out of the tab order
  // and the accessibility tree — aria-hidden alone leaves them focusable.
  if (_open) {
    _d.panel.setAttribute("data-open", "");
    _d.panel.removeAttribute("inert");
    document.body.setAttribute("data-pmk-drawer-open", "");
  } else {
    _d.panel.removeAttribute("data-open");
    _d.panel.setAttribute("inert", "");
    document.body.removeAttribute("data-pmk-drawer-open");
  }
}

export function openDrawer(): void {
  _open = true;
  applyOpenState();
  _d?.cfg.store?.set(true);
}

export function closeDrawer(): void {
  _open = false;
  applyOpenState();
  _d?.cfg.store?.set(false);
}

export function toggleDrawer(): void {
  if (_open) closeDrawer();
  else openDrawer();
}

/** Open the drawer and reveal the needs-attention section (chip click target). */
export function openDrawerAtAttention(): void {
  openDrawer();
  const sec = _d?.panel.querySelector<HTMLElement>(".pmk-drawer-attention");
  sec?.scrollIntoView?.({ block: "start" });
}

/**
 * Create the drawer panel in <body> (once) and wire its config. Restores the
 * persisted open/closed state. Idempotent: a second call re-uses the panel and
 * updates the config (so a reload re-binds the live postMessage/onReanchor).
 */
export function ensureDrawer(cfg: DrawerConfig): HTMLElement {
  // Re-use the existing panel only while it is still attached. If the body was
  // reset (test teardown) or the panel otherwise detached, drop the stale state
  // and rebuild — mirrors the selection overlay's robustness to a body reset.
  if (_d && document.body.contains(_d.panel)) {
    _d.cfg = cfg;
    _open = cfg.store?.get() ?? _open;
    applyOpenState();
    return _d.panel;
  }
  if (_d) {
    document.removeEventListener("keydown", _d.onKeydown);
    _d = null;
  }

  const panel = document.createElement("aside");
  panel.className = "pmk-drawer";
  panel.setAttribute("aria-label", "Review comments");

  const head = document.createElement("div");
  head.className = "pmk-drawer-bar";
  const title = document.createElement("span");
  title.className = "pmk-drawer-title";
  title.textContent = "Comments";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "pmk-drawer-close";
  close.setAttribute("aria-label", "Close comments drawer");
  close.textContent = "✕"; // ✕
  close.addEventListener("click", () => closeDrawer());
  head.append(title, close);

  const content = document.createElement("div");
  content.className = "pmk-drawer-content";

  panel.append(head, content);
  document.body.appendChild(panel);

  const onKeydown = (e: KeyboardEvent): void => {
    if (e.key === "Escape" && _open) {
      e.stopPropagation();
      closeDrawer();
    }
  };
  document.addEventListener("keydown", onKeydown);

  _d = { panel, content, cfg, onKeydown };
  _open = cfg.store?.get() ?? false;
  applyOpenState();
  return panel;
}

/** Remove the drawer and its listeners; reset module state (tests / teardown). */
export function destroyDrawer(): void {
  if (!_d) return;
  document.removeEventListener("keydown", _d.onKeydown);
  _d.panel.remove();
  _d = null;
  _open = false;
}

function metaRow(c: WireComment): HTMLElement {
  const meta = document.createElement("div");
  meta.className = "pmk-drawer-meta";

  const avatar = document.createElement("span");
  avatar.className = `pmk-avatar pmk-avatar-${c.provenance}`;
  avatar.textContent = avatarInitial(c.author);
  avatar.setAttribute("aria-hidden", "true");

  const who = document.createElement("span");
  who.className = "pmk-drawer-who";
  who.textContent = c.author;

  const when = document.createElement("span");
  when.className = "pmk-drawer-when";
  when.textContent = `${c.provenance} · ${c.timestamp}`;

  meta.append(avatar, who, when);
  return meta;
}

function actionButton(label: string, cls: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `pmk-drawer-action ${cls}`;
  btn.textContent = label;
  btn.addEventListener("click", onClick);
  return btn;
}

function card(c: WireComment, attention: boolean, cfg: DrawerConfig): HTMLElement {
  const el = document.createElement("div");
  el.className = attention ? "pmk-drawer-card attention" : "pmk-drawer-card";
  el.setAttribute("data-pmk-id", c.id);

  el.appendChild(metaRow(c));

  const quote = document.createElement("div");
  quote.className = "pmk-drawer-quote";
  quote.textContent = c.quote;
  el.appendChild(quote);

  const body = document.createElement("div");
  body.className = "pmk-drawer-body";
  body.textContent = c.body;
  el.appendChild(body);

  const actions = document.createElement("div");
  actions.className = "pmk-drawer-actions";
  if (attention) {
    actions.append(
      actionButton("↻ Re-anchor", "reanchor", () => cfg.onReanchor(c.id, c.quote, c.body)),
      actionButton("🗑 Delete", "delete", () =>
        cfg.post({ v: 1, type: "resolveComment", id: c.id }),
      ),
    );
  } else {
    actions.append(
      actionButton("Jump to source", "jump", () =>
        cfg.post({ v: 1, type: "jumpToSource", id: c.id }),
      ),
      actionButton("✓ Resolve", "resolve", () =>
        cfg.post({ v: 1, type: "resolveComment", id: c.id }),
      ),
    );
  }
  el.appendChild(actions);
  return el;
}

/** Rebuild the drawer's open + needs-attention sections from `comments`. */
export function renderDrawer(comments: WireComment[]): void {
  if (!_d) return;
  const { cfg, content } = _d;
  content.replaceChildren();

  const { open, attention } = bucketComments(comments);

  const openSec = document.createElement("div");
  openSec.className = "pmk-drawer-section open";
  const openHead = document.createElement("h3");
  openHead.className = "pmk-drawer-head";
  openHead.textContent = `Comments · ${open.length} open`;
  openSec.appendChild(openHead);
  if (open.length === 0) {
    const empty = document.createElement("p");
    empty.className = "pmk-drawer-empty";
    empty.textContent = "No open comments";
    openSec.appendChild(empty);
  } else {
    for (const c of open) openSec.appendChild(card(c, false, cfg));
  }
  content.appendChild(openSec);

  if (attention.length > 0) {
    const attSec = document.createElement("div");
    attSec.className = "pmk-drawer-attention";
    const attHead = document.createElement("h3");
    attHead.className = "pmk-drawer-head";
    attHead.textContent = "Needs attention ";
    const badge = document.createElement("span");
    badge.className = "pmk-drawer-badge";
    badge.textContent = `${attention.length} orphaned`;
    attHead.appendChild(badge);
    attSec.appendChild(attHead);
    for (const c of attention) attSec.appendChild(card(c, true, cfg));
    content.appendChild(attSec);
  }
}
