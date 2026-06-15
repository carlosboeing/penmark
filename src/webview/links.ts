/**
 * Delegated link-click handler for the Penmark webview (ADR 0001).
 *
 * Three link classes:
 *   - http(s)://  → prevent default + post {v:1, type:"openLink", href}
 *   - #fragment   → prevent default + in-page scroll to matching element id
 *   - relative    → prevent default + post {v:1, type:"openLink", href}
 *
 * ADR 0001: no vscode imports — host communication via postMessage only.
 */

import type { WebviewToHost } from "../core/protocol/messages.js";

type PostMessage = (msg: WebviewToHost) => void;

/**
 * Install a delegated click listener on `root`.
 * All anchor clicks inside `root` are intercepted and routed appropriately.
 *
 * @param root        The container element to delegate from.
 * @param postMessage Function used to send messages to the extension host.
 */
export function installLinkHandler(root: HTMLElement, postMessage: PostMessage): void {
  root.addEventListener("click", (evt) => {
    const target = (evt.target as Element | null)?.closest("a");
    if (!target) return;

    const href = target.getAttribute("href") ?? "";

    // Fragment link — scroll in-page, no host message.
    if (href.startsWith("#")) {
      evt.preventDefault();
      const slug = href.slice(1);
      const el = document.getElementById(slug);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      return;
    }

    // External http(s) or relative path — hand off to the host.
    evt.preventDefault();

    // Use the resolved href for http(s) links (gives an absolute URL).
    // For relative paths use the attribute value so the host can resolve them
    // against the document directory.
    let resolvedHref: string;
    if (/^https?:\/\//i.test(href)) {
      resolvedHref = target.href; // browser-resolved absolute URL
    } else {
      resolvedHref = href; // pass the raw attribute; host resolves relative paths
    }

    postMessage({ v: 1, type: "openLink", href: resolvedHref });
  });
}
