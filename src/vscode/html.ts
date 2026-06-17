import * as crypto from "crypto";
import * as vscode from "vscode";
import type { ContentWidth, HighlightIntensity } from "../core/protocol/messages.js";

/**
 * Comment highlight intensity (penmark.comments.highlightIntensity). Applied as a
 * `pmk-hl-*` body class on the shell; media/penmark.css maps each to a tint alpha.
 * Comments are always highlighted (never "off", design §6).
 */
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
 *   - style-src 'nonce-...'         — allow only nonce-tagged styles
 *   - font-src <cspSource>          — allow extension-bundled fonts
 */
export function buildShellHtml(
  webview: vscode.Webview,
  nonce: string,
  scriptUri: vscode.Uri,
  extensionUri: vscode.Uri,
  contentWidth: ContentWidth = "full",
  highlightIntensity: HighlightIntensity = "medium",
): string {
  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource} data:`,
    `script-src 'nonce-${nonce}'`,
    `style-src 'nonce-${nonce}'`,
    `font-src ${webview.cspSource}`,
  ].join("; ");

  // CSS files live in dist/media/ (copied there by esbuild.mjs).
  // Load order: theme tokens first (light), then base structure.
  // main.ts applies the correct theme class on first render/setTheme.
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
${cssLinks}
</head>
<body class="pmk-content-${contentWidth} pmk-hl-${highlightIntensity}">
  <div id="penmark-topbar"></div>
  <div id="penmark-root"></div>
  <script nonce="${nonce}" src="${webview.asWebviewUri(scriptUri).toString()}"></script>
</body>
</html>`;
}
