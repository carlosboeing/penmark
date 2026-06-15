/**
 * Copy-to-clipboard buttons on code blocks for the Penmark webview (T8).
 *
 * The host sends plain `<pre><code>…</code></pre>` HTML with no buttons, and
 * morphdom (D5, see dom.ts) reconciles the live DOM to match that HTML on every
 * render — so any button added here is stripped on the next render. The fix is
 * not to make morphdom preserve buttons but to re-install them after each
 * `renderInto` (see main.ts). installCopyButtons is therefore idempotent: it
 * skips any `pre` that already carries a button.
 *
 * The copied text is read from the `<code>` element's textContent specifically
 * (never `pre.textContent`) so the "Copy"/"Copied" button label never leaks into
 * the payload, and newlines are preserved.
 *
 * ADR 0001: no vscode imports — host communication via postMessage only.
 * No inline style attributes (CSP blocks them); the button is styled via the
 * .pmk-copy-btn class in media/penmark.css.
 */

import type { WebviewToHost } from "../core/protocol/messages.js";

type PostMessage = (msg: WebviewToHost) => void;

const COPY_LABEL = "Copy";
const COPIED_LABEL = "Copied ✓";
const REVERT_MS = 1200;

// Interaction is serial (one click at a time), so a single module-level
// reference to the last-clicked button is sufficient — no per-button id needed.
let _lastClicked: HTMLButtonElement | null = null;
let _revertTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Install a copy button on every `pre` that contains a `code` child and does
 * not already have one. Safe to call on every render (idempotent).
 *
 * @param root        The container holding the rendered markdown.
 * @param postMessage Function used to send messages to the extension host.
 */
export function installCopyButtons(root: HTMLElement, postMessage: PostMessage): void {
  const pres = root.querySelectorAll("pre");
  for (const pre of pres) {
    const code = pre.querySelector("code");
    if (!code) continue;
    // Idempotent: skip a pre that already has a button (e.g. double install).
    if (pre.querySelector(".pmk-copy-btn")) continue;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pmk-copy-btn";
    btn.textContent = COPY_LABEL;
    btn.setAttribute("aria-label", "Copy code");

    btn.addEventListener("click", () => {
      // Read the exact code text from the `code` element — never pre.textContent,
      // which would include the button label. textContent preserves newlines.
      const text = code.textContent ?? "";
      _lastClicked = btn;
      postMessage({ v: 1, type: "copyCode", text });
    });

    pre.appendChild(btn);
  }
}

/**
 * Flash the last-clicked copy button into its `Copied ✓` state, reverting to
 * `Copy` after a short delay. Called by main.ts when the host acks the copy
 * with a `copied` message (the round-trip confirms the clipboard write).
 */
export function markLastCopied(): void {
  const btn = _lastClicked;
  if (!btn) return;

  btn.textContent = COPIED_LABEL;
  btn.classList.add("pmk-copy-btn--copied");

  if (_revertTimer !== null) {
    clearTimeout(_revertTimer);
  }
  _revertTimer = setTimeout(() => {
    btn.textContent = COPY_LABEL;
    btn.classList.remove("pmk-copy-btn--copied");
    _revertTimer = null;
  }, REVERT_MS);
}
