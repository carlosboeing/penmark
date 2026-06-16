import * as nodePath from "path";
import * as vscode from "vscode";
import { injectHighlights } from "../core/comments/highlight.js";
import { stripFrontmatter } from "../core/render/frontmatter.js";
import { createRenderer } from "../core/render/markdown.js";
import type { HostToWebview, ThemeMode } from "../core/protocol/messages.js";
import { PROTOCOL_VERSION } from "../core/protocol/messages.js";
import type { CommentAnalysis } from "./comments.js";

// Re-exported so previewPanel can reach the markdown-it block tokenizer (R7
// anchor placement) through the SAME lazily-loaded render chunk — keeping
// markdown-it out of extension.js / the activation path (T12, design §8).
export { tokenizeBlockOffsets, type BlockOffset } from "../core/render/markdown.js";

/**
 * Render a markdown document to a `render` message payload.
 *
 * Pipeline (D6 compliant):
 *   stripFrontmatter → createRenderer({ resolveImage }) → .render(body) → payload
 *
 * D6: do NOT sanitize here. DOMPurify runs in the webview (browser window required).
 * The CSP nonce + localResourceRoots are the defense-in-depth for the host side.
 *
 * @param source   Raw markdown source text.
 * @param docUri   The VS Code URI of the document (used to resolve relative image paths).
 * @param docName  Display name for the document (shown in the panel title).
 * @param theme    Current theme mode to embed in the message.
 * @param webview  The webview instance used to resolve local resource URIs.
 * @param highlight  Optional synchronous syntax highlighter (lazily loaded by
 *                   the host via hljsLoader.ts; omitted when the document has
 *                   no language-tagged code fences).
 * @param mermaid    Whether to emit ```mermaid fences as pmk-mermaid containers
 *                   (penmark.mermaid.enabled). When false they render as plain
 *                   code blocks and the webview never loads the mermaid chunk.
 * @param analysis   Precomputed comment analysis (R8 `analyzeComments`): the
 *                   wire comments + attention count for the payload, and the
 *                   reconcile result used to inject highlight `<mark>`s (R13).
 *                   Omitted/undefined for a document with no comments.
 */
export function renderDocument(
  source: string,
  docUri: vscode.Uri,
  docName: string,
  theme: ThemeMode,
  webview: vscode.Webview,
  highlight?: (code: string, lang: string) => string,
  mermaid = true,
  analysis?: CommentAnalysis,
): Extract<HostToWebview, { type: "render" }> {
  const { body } = stripFrontmatter(source);

  // Base directory of the document file, used to resolve relative image paths.
  const docDir = nodePath.dirname(docUri.fsPath);

  const renderer = createRenderer({
    highlight,
    mermaid,
    resolveImage: (src: string) => {
      // Absolute http(s) and data URIs are passed through unchanged.
      if (/^https?:\/\//i.test(src) || src.startsWith("data:")) {
        return src;
      }
      try {
        // Resolve relative paths against the document directory.
        const absolutePath = nodePath.isAbsolute(src) ? src : nodePath.resolve(docDir, src);
        const fileUri = vscode.Uri.file(absolutePath);
        return webview.asWebviewUri(fileUri).toString();
      } catch {
        // If URI construction fails, return the original src.
        return src;
      }
    },
  });

  let html = renderer.render(body);

  // R13: rewrite the body's pmk anchor markers into highlight <mark>/block/range
  // wrappers, keyed by reconcile state — AFTER markdown-it, BEFORE the webview's
  // DOMPurify (which is allow-listed to keep data-pmk-* on <mark>, R12). Run it
  // whenever the rendered HTML actually contains a marker (the substring `pmk:`
  // appears only in `<!--pmk:…-->` markers, never in `data-pmk-offset`), so even
  // a marker with no live entry — an orphaned pair left by corruption or a hand
  // edit — is stripped DETERMINISTICALLY here (injectHighlights drops unknown-id
  // markers) rather than relying on DOMPurify to remove the leftover comment. A
  // clean document has no markers, so the regex passes are skipped.
  const recon = analysis?.result;
  if (recon && html.includes("pmk:")) {
    html = injectHighlights(html, recon);
  }

  return {
    v: PROTOCOL_VERSION as 1,
    type: "render",
    html,
    theme,
    docName,
    comments: analysis?.comments ?? [],
    attention: analysis?.attention ?? 0,
  };
}
