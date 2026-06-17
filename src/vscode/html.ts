import * as crypto from "crypto";
import * as vscode from "vscode";
import type { ContentWidth, HighlightIntensity } from "../core/protocol/messages.js";

export type { HighlightIntensity };

/**
 * Generate a cryptographically random nonce for CSP.
 * 16 bytes → 128 bits of entropy; base64 encoded for the CSP nonce attribute.
 */
export function generateNonce(): string {
  return crypto.randomBytes(16).toString("base64");
}

/**
 * Build the webview shell HTML.
 *
 * The nonce is per-render (changes each time the panel HTML is set) so that
 * the inline script tag in the shell is allowed by the CSP while all other
 * inline scripts are blocked.
 *
 * D6: sanitization is webview-side. This shell loads the webview bundle which
 * handles DOMPurify. The host sends raw HTML in `render` messages.
 *
 * CSP:
 *   - default-src 'none'            — deny everything by default
 *   - img-src <cspSource> data:     — allow extension-scoped and data URIs
 *   - script-src 'nonce-...'        — allow only the nonce-tagged script
 *   - style-src <cspSource> 'nonce-…' — extension stylesheets + nonce-tagged inline
 *   - font-src <cspSource>          — allow extension-bundled fonts
 */
export function buildShellHtml(
  webview: vscode.Webview,
  nonce: string,
  scriptUri: vscode.Uri,
  extensionUri: vscode.Uri,
  contentWidth: ContentWidth = "full",
  highlightIntensity: HighlightIntensity = "medium",
  /** Resolved light/dark for first paint before the webview bundle runs. */
  initialResolvedTheme: "light" | "dark" = "light",
): string {
  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource} data:`,
    `script-src 'nonce-${nonce}'`,
    `style-src ${webview.cspSource} 'nonce-${nonce}'`,
    `font-src ${webview.cspSource}`,
  ].join("; ");

  // CSS files live in dist/media/ (copied there by esbuild.mjs).
  // Load order: theme tokens first (light), then base structure.
  // main.ts re-applies theme on render/setTheme; the shell seeds tokens for first paint.
  const cssFiles = ["theme-light.css", "theme-dark.css", "penmark.css"];
  const cssLinks = cssFiles
    .map((f) => {
      const uri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "dist", "media", f));
      return `  <link rel="stylesheet" nonce="${nonce}" href="${uri.toString()}">`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>Penmark Preview</title>
  <style nonce="${nonce}">
    /* Critical first-paint fallbacks when linked theme CSS is slow or blocked. */
    body{margin:0;background-color:#fff;color:#1f2328}
    body.theme-dark,body[data-theme="dark"]{background-color:#0d1117;color:#fff}
    #penmark-root{min-height:1px}
    .pmk-loading,.pmk-render-error{margin:24px 0;font-size:14px;line-height:1.5}
  </style>
${cssLinks}
</head>
<body class="pmk-content-${contentWidth} pmk-hl-${highlightIntensity} theme-${initialResolvedTheme}" data-theme="${initialResolvedTheme}">
  <div id="penmark-topbar"></div>
  <div id="penmark-root"><p class="pmk-loading">Loading preview…</p></div>
  <script nonce="${nonce}">
    window.__penmarkApi = acquireVsCodeApi();
    window.addEventListener("error", function (event) {
      var root = document.getElementById("penmark-root");
      if (!root) return;
      var message = event.error && event.error.message ? event.error.message : event.message;
      root.innerHTML =
        '<p class="pmk-render-error">Preview script error: ' + String(message) + "</p>";
    });
  </script>
  <script nonce="${nonce}" src="${webview.asWebviewUri(scriptUri).toString()}"></script>
</body>
</html>`;
}
