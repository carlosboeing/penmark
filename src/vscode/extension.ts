import * as vscode from "vscode";
import {
  handleExportReview,
  setExportRequestHandler,
  openPreview,
  PreviewPanelSerializer,
  registerChangeListener,
  previewManager,
  registerCustomEditorPreview,
} from "./previewPanel.js";

/** Public API returned from activate() — the test seam lives here. */
export interface ExtensionApi {
  previewManager: typeof previewManager;
}

export function activate(context: vscode.ExtensionContext): ExtensionApi {
  // Register the preview command.
  context.subscriptions.push(
    vscode.commands.registerCommand("penmark.openPreview", () => {
      openPreview(context);
    }),
  );

  // Register the openCustomEditor command to open via vscode.openWith
  context.subscriptions.push(
    vscode.commands.registerCommand("penmark.openCustomEditor", async (uri?: vscode.Uri) => {
      const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (!targetUri) {
        void vscode.window.showInformationMessage(
          "Penmark: Please focus or select a Markdown file to open.",
        );
        return;
      }
      await vscode.commands.executeCommand("vscode.openWith", targetUri, "penmark.previewEditor");
    }),
  );

  // Register the export-review command (R9). Targets the active Markdown editor.
  context.subscriptions.push(
    vscode.commands.registerCommand("penmark.exportReview", () => {
      const doc = vscode.window.activeTextEditor?.document;
      if (!doc || doc.languageId !== "markdown") {
        void vscode.window.showInformationMessage(
          "Penmark: open a Markdown file to export its review.",
        );
        return;
      }
      void handleExportReview(doc);
    }),
  );

  // Register the HTML/PDF export commands (R17, ADR 0007). The export module
  // is imported lazily so its print/inlining machinery never costs activation
  // time; the actual work snapshots the preview webview.
  // The commands open the export options dialog in the preview (R17); the
  // dialog posts `exportRequest`, routed to runExport via the handler below.
  // `targetUri` (+ optional options) bypass the dialog — the extension-test
  // seam (same pattern as handleExportReview's file mode).
  const exportCommand =
    (kind: "html" | "pdf") =>
    async (
      uri?: vscode.Uri,
      targetUri?: vscode.Uri,
      options?: import("../core/protocol/messages.js").ExportOptions,
    ): Promise<vscode.Uri | undefined> => {
      let doc = vscode.window.activeTextEditor?.document;
      if (uri && doc?.uri.toString() !== uri.toString()) {
        doc = await vscode.workspace.openTextDocument(uri);
      }
      if (!doc || doc.languageId !== "markdown") {
        void vscode.window.showInformationMessage(
          `Penmark: open a Markdown file to export it as ${kind.toUpperCase()}.`,
        );
        return undefined;
      }
      const mod = await import("./exportDocument.js");
      if (targetUri) {
        return mod.runExport(context, doc, kind, options, targetUri);
      }
      await mod.openExportOptions(context, doc, kind);
      return undefined;
    };
  context.subscriptions.push(
    vscode.commands.registerCommand("penmark.exportHtml", exportCommand("html")),
    vscode.commands.registerCommand("penmark.exportPdf", exportCommand("pdf")),
  );
  // Route dialog confirmations (webview `exportRequest`) into the export
  // pipeline. Registered here so previewPanel does not import exportDocument
  // (which imports previewPanel — a cycle).
  setExportRequestHandler(async (doc, kind, options) => {
    const mod = await import("./exportDocument.js");
    await mod.runExport(context, doc, kind, options);
  });

  // Register the document-change listener for debounced re-renders.
  context.subscriptions.push(registerChangeListener());

  // Register the webview panel serializer so VS Code can restore the panel
  // when the window is reopened (onWebviewPanel:penmark.preview activation event).
  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer(
      "penmark.preview",
      new PreviewPanelSerializer(context),
    ),
  );

  // Register the custom editor provider
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      "penmark.previewEditor",
      new PenmarkCustomEditorProvider(context),
      {
        webviewOptions: {
          enableFindWidget: true,
          retainContextWhenHidden: false, // In alignment with ADR 0001
        },
        supportsMultipleEditorsPerDocument: true,
      },
    ),
  );

  // Return the test seam so layer-4 tests can observe panel state via
  // vscode.extensions.getExtension(...).exports.previewManager.
  return { previewManager };
}

export function deactivate(): void {}

class PenmarkCustomEditorProvider implements vscode.CustomTextEditorProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
  ): Promise<void> {
    await registerCustomEditorPreview(this.context, document, webviewPanel);
  }
}
