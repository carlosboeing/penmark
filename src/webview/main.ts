/**
 * Penmark webview entry point.
 *
 * Responsibilities (T5 + T6):
 *   - Acquire the VS Code API handle.
 *   - Attach a window message listener for HostToWebview messages.
 *   - On `render`: sanitize + morphdom-render into #penmark-root, restore scroll.
 *   - On `setTheme`: resolve + apply theme; re-wire observeIdeTheme for auto mode.
 *   - On `revealLine`: map the source line to a scrollTop via the offset map.
 *   - Post `scrolled` (throttled, echo-suppressed) when the user scrolls (T10).
 *   - Persist scroll + theme via getState/setState (survives webview reload).
 *   - Install delegated link handler on the root.
 *   - Install topbar (doc name + theme switcher).
 *   - Post {v:1, type:"ready"} once the listener is attached (handshake).
 *
 * ADR 0001: no vscode imports — only the injected acquireVsCodeApi() bridge.
 * D5: morphdom incremental render (via renderInto).
 * D6: sanitization is webview-side (inside renderInto).
 */

import type {
  ContentWidth,
  HostToWebview,
  ThemeMode,
  WireComment,
} from "../core/protocol/messages.js";
import {
  openCommentBox,
  closeCommentBox,
  isCommentBoxOpen,
  type CommentDraftStore,
} from "./comments/commentBox.js";
import {
  ensureDrawer,
  renderDrawer,
  toggleDrawer,
  closeDrawer,
  openDrawerAtAttention,
  bucketComments,
  type DrawerStateStore,
} from "./comments/drawer.js";
import { installHighlights } from "./comments/highlights.js";
import { closeCommentPopover } from "./comments/popover.js";
import { installCopyButtons, markLastCopied } from "./copyButtons.js";
import { renderInto } from "./dom.js";
import { installLinkHandler } from "./links.js";
import { ensureMermaid, hasMermaid, isMermaidLoaded } from "./mermaidLoader.js";
import { lineToScrollTop, readBlocks, scrollTopToLine } from "./scrollSync.js";
import { selectionToSourceRange } from "./selection.js";
import { resolveTheme, applyResolvedTheme, observeIdeTheme } from "./theme.js";
import { installTopbar } from "./topbar.js";
import { applyTypography } from "./typography.js";
import { installImageLightbox } from "./imageLightbox.js";
import { renderFrontmatterCard, estimateReadingMinutes } from "./frontmatterCard.js";
import { installKeyboardNav } from "./keyboard.js";
import {
  ensureSettingsPanel,
  syncPreviewUiState,
  toggleSettingsPanel,
  applyHighlightIntensity,
  type PreviewUiState,
} from "./settingsPanel.js";

// acquireVsCodeApi is injected by the extension host (inline shell script or harness).
declare function acquireVsCodeApi(): PenmarkVscodeApi;

interface PenmarkVscodeApi {
  postMessage: (msg: unknown) => void;
  getState: () => unknown;
  setState: (state: unknown) => void;
}

function getVsCodeApi(): PenmarkVscodeApi {
  const injected = (globalThis as { __penmarkApi?: PenmarkVscodeApi }).__penmarkApi;
  if (injected) return injected;
  return acquireVsCodeApi();
}

// ---------------------------------------------------------------------------
// Internal state shape persisted via getState/setState
// ---------------------------------------------------------------------------

interface PersistedState {
  scrollTop: number;
  theme: ThemeMode;
  /** In-progress comment body, so a webview reload doesn't lose it (R14, §5.3). */
  commentDraft?: string;
  /** Drawer open/closed, so a reload keeps it where the user left it (R15, §5.3). */
  drawerOpen?: boolean;
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const vscode = getVsCodeApi();

// Look up DOM elements lazily so the module works across DOM resets in tests.
function getRoot(): HTMLElement | null {
  return document.getElementById("penmark-root");
}

function getTopbar(): HTMLElement | null {
  return document.getElementById("penmark-topbar");
}

// Install link delegation on the root once it exists.
const _initialRoot = getRoot();
if (_initialRoot) {
  installLinkHandler(_initialRoot, (msg) => vscode.postMessage(msg));
  installImageLightbox(_initialRoot);
}

let _lastComments: WireComment[] = [];
let _lastAttention = 0;
let _lastUiState: PreviewUiState | null = null;
let _renderReceived = false;
installKeyboardNav(() => _lastComments);
try {
  ensureSettingsPanel((m) => vscode.postMessage(m));
} catch (err) {
  console.error("[Penmark] settings panel init failed:", err);
}

// ---------------------------------------------------------------------------
// Scroll sync (T10) — bidirectional, echo-suppressed
// ---------------------------------------------------------------------------

/**
 * Length of the echo-suppression window. After applying a host-driven
 * `revealLine`, the resulting `scroll` event fires asynchronously; we ignore
 * our own scroll events for this long so they are NOT bounced back as
 * `scrolled`. This is the webview half of the two-sided 100 ms window that
 * breaks the editor↔preview feedback loop (the host has its own half).
 */
const ECHO_SUPPRESS_MS = 100;

/** Throttle interval for posting `scrolled` while the user drags the scrollbar. */
const SCROLL_THROTTLE_MS = 100;

/**
 * Timestamp (Date.now()) until which self-originated scroll events are ignored.
 * Set when we apply a revealLine; a timestamp (not a boolean) lets overlapping
 * reveals extend the window correctly.
 */
let _suppressScrollUntil = 0;

/** Last time a `scrolled` message was posted, for throttling. */
let _lastScrolledPostedAt = 0;

/** Roots wired for task-checkbox toggling (v1.0 polish). */
const _taskCheckboxRoots = new WeakSet<HTMLElement>();

/** Click a task-list checkbox → toggle the source markdown line via the host. */
function installTaskCheckboxHandler(root: HTMLElement): void {
  if (_taskCheckboxRoots.has(root)) return;
  _taskCheckboxRoots.add(root);
  root.addEventListener("change", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLInputElement) || target.type !== "checkbox") return;
    const li = target.closest<HTMLElement>("li[data-pmk-line]");
    if (!li || !root.contains(li)) return;
    const lineRaw = li.getAttribute("data-pmk-line");
    if (lineRaw === null) return;
    const line = Number.parseInt(lineRaw, 10);
    if (Number.isNaN(line)) return;
    e.preventDefault();
    vscode.postMessage({ v: 1, type: "toggleTaskCheckbox", line, checked: target.checked });
  });
}

/** Apply a host-driven revealLine by mapping the source line to a scrollTop. */
function applyRevealLine(root: HTMLElement, line: number): void {
  const blocks = readBlocks(root);
  if (blocks.length === 0) return;
  // Open the suppression window BEFORE mutating scrollTop so the scroll event
  // this triggers (fired async) is treated as an echo and not bounced back.
  _suppressScrollUntil = Date.now() + ECHO_SUPPRESS_MS;
  // Instant (not smooth) — smooth scrolling spreads the motion across many
  // scroll events past the suppression window, re-arming the feedback loop.
  root.scrollTop = lineToScrollTop(line, blocks);
}

/** Roots that already carry a scroll listener — guards against double-install. */
const _scrollListenerRoots = new WeakSet<HTMLElement>();

/** Install the throttled, echo-suppressed scroll→`scrolled` listener on root. */
function installScrollListener(root: HTMLElement): void {
  if (_scrollListenerRoots.has(root)) return;
  _scrollListenerRoots.add(root);
  root.addEventListener("scroll", () => {
    // Always persist the current scroll position (survives webview reload).
    const current = (vscode.getState() as PersistedState | undefined) ?? {
      scrollTop: 0,
      theme: "auto",
    };
    vscode.setState({ ...current, scrollTop: root.scrollTop });

    const now = Date.now();
    // Suppress echoes: this scroll was caused by a just-applied revealLine.
    if (now < _suppressScrollUntil) return;
    // Throttle: at most one `scrolled` per SCROLL_THROTTLE_MS.
    if (now - _lastScrolledPostedAt < SCROLL_THROTTLE_MS) return;
    _lastScrolledPostedAt = now;

    const blocks = readBlocks(root);
    if (blocks.length === 0) return;
    const topLine = Math.round(scrollTopToLine(root.scrollTop, blocks));
    vscode.postMessage({ v: 1, type: "scrolled", topLine });
  });
}

if (_initialRoot) {
  installScrollListener(_initialRoot);
}

// ---------------------------------------------------------------------------
// Theme application — uses theme.ts for resolution (T6)
// ---------------------------------------------------------------------------

// Tracks the current ThemeMode setting so the IDE-observer can re-resolve.
let _currentSetting: ThemeMode = "auto";

// Disposer for the current MutationObserver (auto mode only).
let _ideObserverDispose: (() => void) | null = null;

/** Resolved preview theme from body (T6 sets data-theme="light"|"dark"). */
function resolvedTheme(): "light" | "dark" {
  return document.body.dataset.theme === "dark" ? "dark" : "light";
}

function applyTheme(theme: ThemeMode): void {
  _currentSetting = theme;

  // Disconnect any existing IDE observer before re-wiring.
  if (_ideObserverDispose) {
    _ideObserverDispose();
    _ideObserverDispose = null;
  }

  const resolved = resolveTheme(theme, document.body.classList);
  applyResolvedTheme(resolved);

  // In auto mode, re-resolve whenever the IDE body class changes.
  if (theme === "auto") {
    _ideObserverDispose = observeIdeTheme(() => {
      applyResolvedTheme(resolveTheme(_currentSetting, document.body.classList));
    });
  }
}

/**
 * Apply the content-width preset as a body class (the shell sets the initial
 * one; this handles live `penmark.contentWidth` changes). media/penmark.css maps
 * each class to a responsive `max-width` on #penmark-root.
 */
function applyContentWidth(width: ContentWidth): void {
  const cls = document.body.classList;
  cls.remove("pmk-content-comfortable", "pmk-content-wide", "pmk-content-full");
  cls.add(`pmk-content-${width}`);
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

// --- Selection snap-preview + add-comment trigger (R10, R14) -----------------

let _selectionPreviewInstalled = false;

/** Last doc name from a render, so a comments-only message can re-draw the topbar. */
let _lastDocName = "";

/** Build the topbar's comments affordances (drawer toggle + attention chip). */
function topbarCommentsOpts(
  comments: WireComment[],
  attention: number,
): {
  openCount: number;
  attention: number;
  onToggleDrawer: () => void;
  onOpenAttention: () => void;
} {
  return {
    openCount: bucketComments(comments).open.length,
    attention,
    onToggleDrawer: toggleDrawer,
    onOpenAttention: openDrawerAtAttention,
  };
}

/** Persist the in-progress comment body across reloads via getState/setState. */
const commentDraftStore: CommentDraftStore = {
  get: () => (vscode.getState() as PersistedState | undefined)?.commentDraft,
  set: (body) => {
    const cur = (vscode.getState() as PersistedState | undefined) ?? {
      scrollTop: 0,
      theme: "auto",
    };
    vscode.setState({ ...cur, commentDraft: body });
  },
};

/** Persist the drawer open/closed state across reloads (R15, §5.3). */
const drawerStateStore: DrawerStateStore = {
  get: () => (vscode.getState() as PersistedState | undefined)?.drawerOpen ?? false,
  set: (open) => {
    const cur = (vscode.getState() as PersistedState | undefined) ?? {
      scrollTop: 0,
      theme: "auto",
    };
    vscode.setState({ ...cur, drawerOpen: open });
  },
};

// --- Re-anchor "select new location" mode (R15) ------------------------------
// Re-anchor is delete-then-add: clicking "Re-anchor" in the drawer's needs-
// attention bucket arms this mode; the next selection resolves the orphaned
// comment and re-adds the SAME body/quote at the new location. Two undo steps
// for v0.5 (a single combined edit would need a new protocol message + host
// handler — outside R15's webview-only file scope; recorded as the chosen
// trade-off in the PR).
let _pendingReanchor: { id: string; quote: string; body: string } | null = null;

/** Whether a re-anchor is awaiting a new-location selection. */
function isReanchorPending(): boolean {
  return _pendingReanchor !== null;
}

/** The hint banner shown while re-anchoring (created lazily, lives in <body>). */
function getOrCreateReanchorHint(): HTMLElement {
  let hint = document.getElementById("penmark-reanchor-hint");
  if (!hint) {
    hint = document.createElement("div");
    hint.id = "penmark-reanchor-hint";
    hint.className = "pmk-reanchor-hint";
    hint.setAttribute("role", "status");
    const label = document.createElement("span");
    label.textContent = "Select the new location for this comment";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "pmk-reanchor-cancel";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => cancelReanchor());
    hint.appendChild(label);
    hint.appendChild(cancel);
    document.body.appendChild(hint);
  }
  return hint;
}

/** Arm re-anchor mode for `id` (the drawer's onReanchor callback). */
function requestReanchor(id: string, quote: string, body: string): void {
  _pendingReanchor = { id, quote, body };
  closeDrawer(); // free the document so the user can select the new location
  getOrCreateReanchorHint().setAttribute("data-active", "");
}

/** Leave re-anchor mode without committing. */
function cancelReanchor(): void {
  _pendingReanchor = null;
  document.getElementById("penmark-reanchor-hint")?.removeAttribute("data-active");
}

/** Commit the armed re-anchor at `range`: resolve the orphan, re-add the body. */
function commitReanchor(range: { start: number; end: number }): void {
  if (!_pendingReanchor) return;
  const { id, quote, body } = _pendingReanchor;
  vscode.postMessage({ v: 1, type: "resolveComment", id });
  vscode.postMessage({ v: 1, type: "addComment", range, quote, body });
  cancelReanchor();
}

// Esc cancels an armed re-anchor (the drawer is closed in this mode, so the
// drawer's own Esc handler is inactive).
document.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.key === "Escape" && isReanchorPending()) {
    e.stopPropagation();
    cancelReanchor();
  }
});

/**
 * Show a transient highlight (`.pmk-hl-preview`) over the current selection while
 * it maps to a valid source range (R10), plus an "Add comment" button (R14) that
 * opens the add-box for the snapped range. Installed once: the listener lives on
 * `document` and the overlay layer lives in `<body>` OUTSIDE the morphdom'd
 * content root, so neither is stripped on re-render. The rects come from
 * `getClientRects` (empty under jsdom) — verified by Playwright, not units.
 */
/** The selection-overlay layer, created in <body> on first use (and re-created
 *  if it ever goes missing — robust to a body reset). */
function getOrCreateOverlay(): HTMLElement {
  let layer = document.getElementById("penmark-selection-preview");
  if (!layer) {
    layer = document.createElement("div");
    layer.id = "penmark-selection-preview";
    layer.setAttribute("aria-hidden", "true");
    document.body.appendChild(layer);
  }
  return layer;
}

function installSelectionPreview(): void {
  if (_selectionPreviewInstalled) return;
  _selectionPreviewInstalled = true;
  getOrCreateOverlay();

  document.addEventListener("selectionchange", () => {
    // Don't fight an open add-box: it owns focus and we want to preserve the selection highlight of the text being commented on.
    if (isCommentBoxOpen()) return;

    const layer = getOrCreateOverlay();
    layer.replaceChildren();
    // Resolve the root lazily — #penmark-root persists across renders, but
    // reading it per-event keeps this robust to root replacement.
    const root = getRoot();
    const sel = document.getSelection();
    if (!root || !sel) return;
    const range = selectionToSourceRange(sel, root);
    if (range === null) return;

    const rects = sel.getRangeAt(0).getClientRects();
    for (const rect of rects) {
      const box = document.createElement("div");
      box.className = "pmk-hl-preview";
      box.style.left = `${rect.left + window.scrollX}px`;
      box.style.top = `${rect.top + window.scrollY}px`;
      box.style.width = `${rect.width}px`;
      box.style.height = `${rect.height}px`;
      layer.appendChild(box);
    }

    // Capture the range + selected text NOW — clicking the button can collapse
    // the selection, so the action must use these snapshot values.
    const quote = sel.toString();
    const last = rects[rects.length - 1];
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    // In re-anchor mode the same selection affordance commits the move instead
    // of opening the add-box (R15).
    if (isReanchorPending()) {
      addBtn.className = "pmk-add-comment-btn pmk-reanchor-here";
      addBtn.textContent = "📍 Re-anchor here"; // 📍
      addBtn.addEventListener("click", () => {
        commitReanchor(range);
        layer.replaceChildren();
      });
    } else {
      addBtn.className = "pmk-add-comment-btn";
      addBtn.textContent = "💬 Add comment"; // 💬
      addBtn.addEventListener("click", () => {
        // Open first (positionOver reads addBtn's rect), then remove the button but keep highlights.
        openCommentBox(addBtn, range, quote, (m) => vscode.postMessage(m), commentDraftStore);
        addBtn.remove();
      });
    }
    if (last) {
      addBtn.style.left = `${last.right + window.scrollX}px`;
      addBtn.style.top = `${last.bottom + window.scrollY}px`;
    }
    layer.appendChild(addBtn);
  });
}

function showRenderError(root: HTMLElement, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.error("[Penmark] render failed:", err);
  root.replaceChildren();
  const note = document.createElement("p");
  note.className = "pmk-render-error";
  note.textContent = `Preview failed to render: ${message}`;
  root.appendChild(note);
}

window.addEventListener("message", (event: MessageEvent) => {
  const msg = event.data as HostToWebview;
  if (!msg || typeof msg !== "object" || msg.v !== 1) return;

  switch (msg.type) {
    case "render": {
      const root = getRoot();
      if (!root) break;

      _renderReceived = true;
      console.info(
        "[Penmark] render received for",
        msg.docName,
        `(${String(msg.html?.length ?? 0)} bytes html)`,
      );

      // Core paint first — post-render affordances must not block or undo this.
      try {
        applyTheme(msg.theme);

        if (msg.highlightIntensity) {
          applyHighlightIntensity(msg.highlightIntensity);
        }

        installScrollListener(root);
        closeCommentPopover();
        closeCommentBox();

        renderInto(root, msg.html ?? "");
        root.querySelector(".pmk-loading")?.remove();
        console.info("[Penmark] render applied,", root.childElementCount, "top-level blocks");
      } catch (err) {
        showRenderError(root, err);
        break;
      }

      try {
        _lastDocName = msg.docName;
        const topbar = getTopbar();
        if (topbar) {
          installTopbar(
            topbar,
            msg.docName,
            (m) => vscode.postMessage(m),
            topbarCommentsOpts(msg.comments ?? [], msg.attention ?? 0),
            toggleSettingsPanel,
            msg.theme,
          );
        }

        if (msg.typography && msg.highlightIntensity) {
          _lastUiState = {
            theme: msg.theme,
            typography: msg.typography,
            highlightIntensity: msg.highlightIntensity,
          };
          syncPreviewUiState(_lastUiState);
        } else if (msg.typography) {
          _lastUiState = {
            theme: msg.theme,
            typography: msg.typography,
            highlightIntensity: "medium",
          };
          syncPreviewUiState(_lastUiState);
        }

        installSelectionPreview();

        if (msg.typography) {
          applyTypography(root, msg.typography);
        }
        const readingMin = estimateReadingMinutes(root.textContent ?? "");
        renderFrontmatterCard(msg.frontmatter, readingMin);
        _lastComments = msg.comments ?? [];
        _lastAttention = msg.attention ?? 0;

        installTaskCheckboxHandler(root);
        installCopyButtons(root, (m) => vscode.postMessage(m));
        installHighlights(root, msg.comments ?? [], (m) => vscode.postMessage(m));

        ensureDrawer({
          post: (m) => vscode.postMessage(m),
          onReanchor: requestReanchor,
          store: drawerStateStore,
        });
        renderDrawer(msg.comments ?? []);

        if (hasMermaid(root)) {
          void ensureMermaid(root, resolvedTheme());
        }

        const saved = vscode.getState() as PersistedState | undefined;
        if (saved?.scrollTop && root.scrollHeight > root.clientHeight) {
          root.scrollTop = Math.min(saved.scrollTop, root.scrollHeight - root.clientHeight);
        }

        const current = (vscode.getState() as PersistedState | undefined) ?? {
          scrollTop: 0,
          theme: msg.theme,
        };
        vscode.setState({ ...current, theme: msg.theme });
      } catch (err) {
        console.error("[Penmark] post-render failed (content should still be visible):", err);
      }
      break;
    }

    case "comments": {
      // Reconcile-only update (no new HTML): refresh the highlight wiring, the
      // drawer lists, and the topbar count/chip against the new comment set
      // (R15). No docName on this message — reuse the last render's.
      _lastComments = msg.comments ?? [];
      _lastAttention = msg.attention ?? 0;
      const root = getRoot();
      if (root) {
        installHighlights(root, msg.comments ?? [], (m) => vscode.postMessage(m));
      }
      ensureDrawer({
        post: (m) => vscode.postMessage(m),
        onReanchor: requestReanchor,
        store: drawerStateStore,
      });
      renderDrawer(msg.comments ?? []);
      const topbar = getTopbar();
      if (topbar) {
        installTopbar(
          topbar,
          _lastDocName,
          (m) => vscode.postMessage(m),
          topbarCommentsOpts(msg.comments ?? [], msg.attention ?? 0),
          toggleSettingsPanel,
          _currentSetting,
        );
      }
      break;
    }

    case "setTypography": {
      const root = getRoot();
      if (root) applyTypography(root, msg.typography);
      if (_lastUiState) {
        _lastUiState.typography = msg.typography;
        syncPreviewUiState(_lastUiState);
      }
      break;
    }

    case "setHighlightIntensity": {
      applyHighlightIntensity(msg.highlightIntensity);
      if (_lastUiState) {
        _lastUiState.highlightIntensity = msg.highlightIntensity;
        syncPreviewUiState(_lastUiState);
      }
      break;
    }

    case "setContentWidth": {
      applyContentWidth(msg.contentWidth);
      break;
    }

    case "setTheme": {
      applyTheme(msg.theme);
      const current = (vscode.getState() as PersistedState | undefined) ?? {
        scrollTop: 0,
        theme: "light",
      };
      vscode.setState({ ...current, theme: msg.theme });

      const topbar = getTopbar();
      if (topbar) {
        installTopbar(
          topbar,
          _lastDocName,
          (m) => vscode.postMessage(m),
          topbarCommentsOpts(_lastComments, _lastAttention),
          toggleSettingsPanel,
          msg.theme,
        );
      }

      // Re-render existing diagrams under the new theme — but only if the chunk
      // was already loaded (never trigger the heavy import from a theme change).
      const root = getRoot();
      if (root && isMermaidLoaded() && hasMermaid(root)) {
        void ensureMermaid(root, resolvedTheme());
      }
      break;
    }

    case "revealLine": {
      const root = getRoot();
      if (!root) break;
      // Map the source line to a scrollTop via the offset map and apply it,
      // opening the echo-suppression window so the resulting scroll event is
      // not posted back as `scrolled` (T10).
      applyRevealLine(root, msg.line);
      break;
    }

    case "copied": {
      // Host acked a copyCode round-trip — flash the last-clicked button.
      markLastCopied();
      break;
    }
  }
});

// Post ready after the listener is attached — the host re-sends the render on
// receiving this, making the initial postRender race-free.
window.addEventListener("error", (event) => {
  console.error("[Penmark] uncaught error:", event.error ?? event.message);
  const root = getRoot();
  if (!root || root.querySelector(".pmk-render-error")) return;
  const loadingOnly =
    root.childElementCount === 1 && root.querySelector(".pmk-loading") !== null;
  if (loadingOnly || root.childElementCount === 0) {
    showRenderError(root, event.error ?? event.message);
  }
});

try {
  const _bootState = vscode.getState() as PersistedState | undefined;
  applyTheme(_bootState?.theme ?? "auto");
} catch (err) {
  console.error("[Penmark] bootstrap theme failed:", err);
  const root = getRoot();
  if (root) showRenderError(root, err);
}
console.info("[Penmark] posting ready");
function postReady(): void {
  vscode.postMessage({ v: 1, type: "ready" });
}
postReady();
for (const delayMs of [400, 1200]) {
  setTimeout(() => {
    if (_renderReceived) return;
    console.info("[Penmark] re-posting ready (no render yet)");
    postReady();
  }, delayMs);
}

setTimeout(() => {
  if (_renderReceived) return;
  const root = getRoot();
  if (!root?.querySelector(".pmk-loading")) return;
  showRenderError(
    root,
    "No render message from the extension host. Open Output → Penmark for host logs, then reload the window.",
  );
}, 4000);

// Make TypeScript treat this as an ES module.
export {};
