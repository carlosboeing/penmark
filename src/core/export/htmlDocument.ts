/**
 * Standalone HTML document assembly for export (R17, ADR 0007).
 *
 * Pure string assembly — no vscode, no node imports (ADR 0001). The caller
 * (src/vscode/exportDocument.ts) supplies the captured preview DOM and the
 * stylesheet contents; this module only wraps them into a self-contained,
 * JavaScript-free HTML document.
 *
 * Trust boundary: `contentHtml` and `frontmatterHtml` come from the live
 * preview DOM, which is DOMPurify-sanitized before insertion (D6) — this
 * builder embeds them verbatim and never re-interprets them. Everything else
 * (title, classes, styles) is escaped or emitted from fixed vocabularies. A
 * defense-in-depth CSP meta blocks scripts even if a sanitizer bug let one
 * through.
 */

import type { ContentWidth } from "../protocol/messages.js";

/** Paper size for the print stylesheet's `@page` rule (penmark.export.pdfPageSize). */
export type PdfPageSize = "a4" | "letter";

export interface ExportDocumentOptions {
  /** Document title (the markdown file's basename). Escaped into <title>. */
  title: string;
  /** Cleaned innerHTML of #penmark-root, sanitized in the webview. */
  contentHtml: string;
  /** Optional outerHTML of the frontmatter card, placed before the root. */
  frontmatterHtml?: string;
  /** Resolved theme at capture time — pins the body theme class. */
  theme: "light" | "dark";
  /** Content-width preset active at capture time (body class). */
  contentWidth: ContentWidth;
  /** Inline style of #penmark-root (typography CSS custom properties). */
  rootStyle?: string;
  /** Stylesheet contents inlined in order (theme tokens, base, export). */
  css: string[];
  /** Emits `@page { size: … }` for print/PDF. */
  pageSize?: PdfPageSize;
  /** Generator note embedded as a meta tag (escaped). */
  generator?: string;
}

const PAGE_SIZE_CSS: Record<PdfPageSize, string> = {
  a4: "A4",
  letter: "letter",
};

/**
 * Fixed print margin (see design doc): generous enough for reading and hole
 * punching, symmetric so double-sided printing works without mirroring.
 */
const PAGE_MARGIN = "18mm 16mm";

/** Escape a string for safe embedding in HTML text/attribute context. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Defense-in-depth CSP for the exported file. The content is already
 * sanitized; this additionally blocks scripts outright, allows images only as
 * data URIs (local images are inlined) or https (remote references pass
 * through unchanged), and permits the inline styles the export relies on
 * (inlined stylesheets + mermaid's rehydrated style attributes).
 */
const EXPORT_CSP =
  "default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; font-src data:";

/**
 * Assemble the self-contained export document. The output contains no
 * <script> and references no external resources besides https images the
 * source markdown linked explicitly.
 */
export function buildExportHtml(opts: ExportDocumentOptions): string {
  const bodyClasses = [`theme-${opts.theme}`, `pmk-content-${opts.contentWidth}`, "pmk-export"];

  const styleBlocks = opts.css
    .map((css) => `  <style>\n${css}\n  </style>`)
    .join("\n");

  const pageRule = opts.pageSize
    ? `  <style>\n@page { size: ${PAGE_SIZE_CSS[opts.pageSize]}; margin: ${PAGE_MARGIN}; }\n  </style>\n`
    : "";

  const generatorMeta = opts.generator
    ? `  <meta name="generator" content="${escapeHtml(opts.generator)}">\n`
    : "";

  const rootStyleAttr = opts.rootStyle ? ` style="${escapeHtml(opts.rootStyle)}"` : "";

  const frontmatter = opts.frontmatterHtml ? `  ${opts.frontmatterHtml}\n` : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${EXPORT_CSP}">
${generatorMeta}  <title>${escapeHtml(opts.title)}</title>
${styleBlocks}
${pageRule}</head>
<body class="${bodyClasses.join(" ")}" data-theme="${opts.theme}">
${frontmatter}  <div id="penmark-root"${rootStyleAttr}>
${opts.contentHtml}
  </div>
</body>
</html>
`;
}
