import * as vscode from "vscode";
import {
  handleExportReview,
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
    _token: vscode.CancellationToken,
  ): Promise<void> {
    await registerCustomEditorPreview(this.context, document, webviewPanel);
  }
}

