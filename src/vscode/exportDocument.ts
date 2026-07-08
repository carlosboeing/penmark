/**
 * Export commands (R17, ADR 0007): "Export as HTML" and "Export as PDF".
 *
 * Orchestration only — the moving parts live in focused modules:
 *   - previewPanel.requestExportCapture: snapshot the fully rendered preview
 *   - core/export/htmlDocument:          wrap the snapshot into a standalone doc
 *   - exportImages:                      inline local images as data: URIs
 *   - pdfCdp / pdf:                      print via a system Chromium browser
 *
 * Exports are configured in the webview's export dialog (topbar Export button,
 * or `exportShowOptions` for the palette/menu commands); the dialog posts
 * `exportRequest`, which lands in {@link runExport}. An explicit target +
 * options bypass the dialog — the extension-test seam (same pattern as
 * handleExportReview). Failures surface as error messages and are logged to
 * the Penmark output channel — never swallowed.
 */

import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "path";
import * as vscode from "vscode";
import { buildExportHtml } from "../core/export/htmlDocument.js";
import type { ExportKind, ExportOptions } from "../core/protocol/messages.js";
import { inlineLocalImages } from "./exportImages.js";
import { exportDefaultsFromSettings } from "./exportSettings.js";
import { penmarkOutput } from "./outputChannel.js";
import { findChromium, printHtmlToPdf } from "./pdf.js";
import { printHtmlToPdfViaCdp } from "./pdfCdp.js";
import { requestExportCapture, requestExportDialog } from "./previewPanel.js";

/** Stylesheets inlined into every export, in cascade order (always light). */
const EXPORT_CSS_FILES = ["theme-light.css", "penmark.css", "export.css"];

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function configuredChromiumPath(): string {
  return vscode.workspace.getConfiguration("penmark").get<string>("export.chromiumPath", "");
}

/** Read the bundled stylesheets from dist/media (shipped in the VSIX). */
async function readExportCss(context: vscode.ExtensionContext): Promise<string[]> {
  const decoder = new TextDecoder();
  return Promise.all(
    EXPORT_CSS_FILES.map(async (f) => {
      const uri = vscode.Uri.joinPath(context.extensionUri, "dist", "media", f);
      return decoder.decode(await vscode.workspace.fs.readFile(uri));
    }),
  );
}

/**
 * Capture the preview and assemble the self-contained HTML document. Throws
 * with a user-presentable message when the capture fails; embedding failures
 * for individual images are returned (and logged), not thrown — one broken
 * image must not sink the export.
 *
 * @param forPdf  The CDP print run controls page geometry itself, so the PDF
 *                temp document must NOT carry an `@page` rule (it would
 *                compound with the print margins).
 */
export async function buildStandaloneHtml(
  context: vscode.ExtensionContext,
  document: vscode.TextDocument,
  options: ExportOptions,
  forPdf: boolean,
): Promise<{ html: string; failures: string[] }> {
  const capture = await requestExportCapture(context, document, {
    includeFrontmatter: options.includeFrontmatter,
    includeToc: options.includeToc,
  });
  if (!capture.ok) {
    throw new Error(capture.error ?? "the preview could not capture the document");
  }

  const css = await readExportCss(context);
  const version = (context.extension.packageJSON as { version?: string }).version ?? "dev";

  const html = buildExportHtml({
    title: path.basename(document.fileName),
    contentHtml: capture.html,
    frontmatterHtml: capture.frontmatterHtml,
    tocHtml: capture.tocHtml,
    width: options.width,
    rootStyle: capture.rootStyle,
    css,
    pageSetup: forPdf ? undefined : { size: options.pdfPageSize, margin: options.pdfMargin },
    generator: `Penmark ${version}`,
  });

  const inlined = await inlineLocalImages(html, async (fsPath) =>
    vscode.workspace.fs.readFile(vscode.Uri.file(fsPath)),
  );
  if (inlined.failures.length > 0) {
    const channel = penmarkOutput();
    for (const f of inlined.failures) {
      channel.appendLine(
        `[${new Date().toISOString()}] export: could not embed image ${f} — kept its original reference`,
      );
    }
  }
  return { html: inlined.html, failures: inlined.failures };
}

/** Sibling path of the document with a different extension, as the dialog default. */
function siblingTarget(document: vscode.TextDocument, ext: string): vscode.Uri {
  const dir = path.dirname(document.uri.fsPath);
  const base = path.basename(document.uri.fsPath, path.extname(document.uri.fsPath));
  return vscode.Uri.file(path.join(dir, `${base}.${ext}`));
}

/** Success toast with an optional embedding-failure note and an open action. */
function showExportedMessage(target: vscode.Uri, failures: number, openLabel: string): void {
  const note = failures > 0 ? ` (${String(failures)} image(s) could not be embedded)` : "";
  void vscode.window
    .showInformationMessage(
      `Penmark: exported to ${vscode.workspace.asRelativePath(target)}${note}`,
      openLabel,
    )
    .then((choice) => {
      if (choice === openLabel) {
        void vscode.env.openExternal(target);
      }
    });
}

/**
 * Open the export options dialog in the document's preview (opens the preview
 * when needed). The dialog's `exportRequest` lands in {@link runExport}.
 */
export async function openExportOptions(
  context: vscode.ExtensionContext,
  document: vscode.TextDocument,
  kind: ExportKind,
): Promise<void> {
  await requestExportDialog(context, document, kind, exportDefaultsFromSettings());
}

/** Route a confirmed export (dialog or test seam) to the right handler. */
export async function runExport(
  context: vscode.ExtensionContext,
  document: vscode.TextDocument,
  kind: ExportKind,
  options: ExportOptions = exportDefaultsFromSettings(),
  targetUri?: vscode.Uri,
): Promise<vscode.Uri | undefined> {
  return kind === "pdf"
    ? handleExportPdf(context, document, options, targetUri)
    : handleExportHtml(context, document, options, targetUri);
}

/**
 * Export `document` as a standalone HTML file. Returns the written target, or
 * undefined when the user cancelled or the export failed (already surfaced).
 */
export async function handleExportHtml(
  context: vscode.ExtensionContext,
  document: vscode.TextDocument,
  options: ExportOptions = exportDefaultsFromSettings(),
  targetUri?: vscode.Uri,
): Promise<vscode.Uri | undefined> {
  let built: { html: string; failures: string[] };
  try {
    built = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Penmark: exporting HTML…" },
      () => buildStandaloneHtml(context, document, options, false),
    );
  } catch (err) {
    void vscode.window.showErrorMessage(`Penmark: HTML export failed — ${errMsg(err)}`);
    return undefined;
  }

  const target =
    targetUri ??
    (await vscode.window.showSaveDialog({
      defaultUri: siblingTarget(document, "html"),
      filters: { HTML: ["html"] },
    }));
  if (!target) return undefined;

  try {
    await vscode.workspace.fs.writeFile(target, Buffer.from(built.html, "utf8"));
    showExportedMessage(target, built.failures.length, "Open in Browser");
    return target;
  } catch (err) {
    penmarkOutput().appendLine(
      `[${new Date().toISOString()}] export: HTML export failed — ${errMsg(err)}`,
    );
    void vscode.window.showErrorMessage(`Penmark: HTML export failed — ${errMsg(err)}`);
    return undefined;
  }
}

/**
 * Export `document` as a PDF: CDP print (header/footer, page numbers, exact
 * margins) with the CLI printer as fallback, via a local Chromium-based
 * browser. Degrades gracefully when no browser is available: offers HTML
 * export instead (PDF is additive, never a hard dependency).
 */
export async function handleExportPdf(
  context: vscode.ExtensionContext,
  document: vscode.TextDocument,
  options: ExportOptions = exportDefaultsFromSettings(),
  targetUri?: vscode.Uri,
): Promise<vscode.Uri | undefined> {
  const explicit = configuredChromiumPath();
  const browser = await findChromium(explicit);
  if (!browser) {
    const EXPORT_HTML = "Export as HTML instead";
    const OPEN_SETTINGS = "Open Settings";
    const reason = explicit
      ? `the configured browser was not found at "${explicit}"`
      : "no Chromium-based browser (Chrome, Edge, Chromium, Brave) was found";
    // Fire-and-forget: the message promise only settles on user interaction,
    // so awaiting it would park the command indefinitely.
    void vscode.window
      .showErrorMessage(
        `Penmark: PDF export needs a local Chromium-based browser — ${reason}.`,
        EXPORT_HTML,
        OPEN_SETTINGS,
      )
      .then((choice) => {
        if (choice === EXPORT_HTML) {
          void handleExportHtml(context, document, options);
        } else if (choice === OPEN_SETTINGS) {
          void vscode.commands.executeCommand(
            "workbench.action.openSettings",
            "penmark.export.chromiumPath",
          );
        }
      });
    return undefined;
  }

  const target =
    targetUri ??
    (await vscode.window.showSaveDialog({
      defaultUri: siblingTarget(document, "pdf"),
      filters: { PDF: ["pdf"] },
    }));
  if (!target) return undefined;

  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Penmark: exporting PDF…" },
      async () => {
        const built = await buildStandaloneHtml(context, document, options, true);
        // Print in a scratch directory, then copy through workspace.fs so
        // remote/virtual targets work; the browser only ever sees local files.
        const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "penmark-export-"));
        try {
          const htmlPath = path.join(tmpDir, "document.html");
          const pdfPath = path.join(tmpDir, "document.pdf");
          await fsp.writeFile(htmlPath, built.html, "utf8");
          const printSettings = {
            pageSize: options.pdfPageSize,
            margin: options.pdfMargin,
            headerFooter: options.pdfHeaderFooter,
            title: path.basename(document.fileName),
          };
          try {
            await printHtmlToPdfViaCdp(browser, htmlPath, pdfPath, printSettings);
          } catch (cdpErr) {
            // Fall back to the flag-based printer (no header/footer) so a
            // quirky browser build still exports; the downgrade is logged.
            penmarkOutput().appendLine(
              `[${new Date().toISOString()}] export: CDP print failed (${errMsg(cdpErr)}) — falling back to --print-to-pdf without header/footer`,
            );
            await printHtmlToPdf(browser, htmlPath, pdfPath);
          }
          await vscode.workspace.fs.writeFile(target, await fsp.readFile(pdfPath));
        } finally {
          await fsp.rm(tmpDir, { recursive: true, force: true });
        }
        showExportedMessage(target, built.failures.length, "Open PDF");
      },
    );
  } catch (err) {
    penmarkOutput().appendLine(
      `[${new Date().toISOString()}] export: PDF export failed — ${errMsg(err)}`,
    );
    void vscode.window.showErrorMessage(`Penmark: PDF export failed — ${errMsg(err)}`);
    return undefined;
  }
  return target;
}
