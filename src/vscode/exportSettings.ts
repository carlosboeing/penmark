/**
 * Export defaults from penmark.* settings (R17). Separate from
 * exportDocument.ts so previewPanel.ts can embed defaults in render payloads
 * without importing the command layer (no import cycle).
 */

import * as vscode from "vscode";
import type { ExportOptions } from "../core/protocol/messages.js";
import { resolveTypography } from "../core/settings/typography.js";

/**
 * Resolve the export dialog defaults. `export.width` = "preview" resolves to
 * the effective typography content width, so the dialog opens showing what
 * the preview currently uses.
 */
export function exportDefaultsFromSettings(): ExportOptions {
  const config = vscode.workspace.getConfiguration("penmark");
  const rawWidth = config.get<string>("export.width", "preview");
  const width =
    rawWidth === "comfortable" || rawWidth === "wide" || rawWidth === "full"
      ? rawWidth
      : resolveTypography({
          preset: config.get<string>("preset"),
          contentWidth: config.get<"comfortable" | "wide" | "full">("contentWidth"),
        }).contentWidth;
  const rawMargin = config.get<string>("export.pdfMargin", "normal");
  return {
    includeFrontmatter: config.get<boolean>("export.includeFrontmatter", false),
    includeToc: config.get<boolean>("export.toc", false),
    width,
    pdfPageSize: config.get<string>("export.pdfPageSize", "a4") === "letter" ? "letter" : "a4",
    pdfMargin: rawMargin === "narrow" || rawMargin === "wide" ? rawMargin : "normal",
    pdfHeaderFooter: config.get<boolean>("export.pdfHeaderFooter", true),
  };
}
