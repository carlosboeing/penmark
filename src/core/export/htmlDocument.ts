/**
 * Standalone HTML document assembly for export (R17, ADR 0007).
 *
 * Pure string assembly — no vscode, no node imports (ADR 0001). The caller
 * (src/vscode/exportDocument.ts) supplies the captured preview DOM and the
 * stylesheet contents; this module only wraps them into a self-contained,
 * JavaScript-free HTML document.
 *
 * Exports are ALWAYS light-themed (maintainer decision 2026-07-07): shared
 * documents read on white regardless of the author's IDE theme, so only the
 * light token stylesheet is inlined and the body pins `theme-light`.
 *
 * Trust boundary: `contentHtml`, `frontmatterHtml`, and `tocHtml` come from
 * the live preview DOM, which is DOMPurify-sanitized before insertion (D6) —
 * this builder embeds them verbatim and never re-interprets them. Everything
 * else (title, classes, styles) is escaped or emitted from fixed
 * vocabularies. A defense-in-depth CSP meta blocks scripts even if a
 * sanitizer bug let one through.
 */

import type { ContentWidth, PdfMarginPreset } from "../protocol/messages.js";

/** Paper size for the print stylesheet's `@page` rule (penmark.export.pdfPageSize). */
export type PdfPageSize = "a4" | "letter";

/**
 * `@page` setup for the standalone HTML export, so printing it from a browser
 * approximates the PDF command. The PDF path OMITS this (undefined): paper
 * size, margins, and header/footer space are controlled by the print call
 * itself (CDP printToPDF), and an `@page` margin would compound with them.
 */
export interface PageSetup {
  size: PdfPageSize;
  margin: PdfMarginPreset;
}

export interface ExportDocumentOptions {
  /** Document title (the markdown file's basename). Escaped into <title>. */
  title: string;
  /** Cleaned innerHTML of #penmark-root, sanitized in the webview. */
  contentHtml: string;
  /** Optional outerHTML of the frontmatter card, placed before the root. */
  frontmatterHtml?: string;
  /** Optional generated table of contents, placed at the top of the root. */
  tocHtml?: string;
  /** Content column width (export option). */
  width: ContentWidth;
  /** Inline style of #penmark-root (typography CSS custom properties). */
  rootStyle?: string;
  /** Stylesheet contents inlined in order (light tokens, base, export). */
  css: string[];
  /** Emit `@page` for browser printing; omit on the CDP-printed PDF path. */
  pageSetup?: PageSetup;
  /** Generator note embedded as a meta tag (escaped). */
  generator?: string;
}

const PAGE_SIZE_CSS: Record<PdfPageSize, string> = {
  a4: "A4",
  letter: "letter",
};

/** Margin presets in millimetres (vertical horizontal). */
export const PAGE_MARGIN_CSS: Record<PdfMarginPreset, string> = {
  narrow: "12mm 12mm",
  normal: "18mm 16mm",
  wide: "25mm 22mm",
};

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
  const bodyClasses = ["theme-light", `pmk-content-${opts.width}`, "pmk-export"];

  const styleBlocks = opts.css.map((css) => `  <style>\n${css}\n  </style>`).join("\n");

  const pageRule = opts.pageSetup
    ? `  <style>\n@page { size: ${PAGE_SIZE_CSS[opts.pageSetup.size]}; margin: ${PAGE_MARGIN_CSS[opts.pageSetup.margin]}; }\n  </style>\n`
    : "";

  const generatorMeta = opts.generator
    ? `  <meta name="generator" content="${escapeHtml(opts.generator)}">\n`
    : "";

  const rootStyleAttr = opts.rootStyle ? ` style="${escapeHtml(opts.rootStyle)}"` : "";

  const frontmatter = opts.frontmatterHtml ? `  ${opts.frontmatterHtml}\n` : "";
  const toc = opts.tocHtml ? `${opts.tocHtml}\n` : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${EXPORT_CSP}">
${generatorMeta}  <title>${escapeHtml(opts.title)}</title>
${styleBlocks}
${pageRule}</head>
<body class="${bodyClasses.join(" ")}" data-theme="light">
${frontmatter}  <div id="penmark-root"${rootStyleAttr}>
${toc}${opts.contentHtml}
  </div>
</body>
</html>
`;
}
