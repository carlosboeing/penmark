// Extension integration smoke test — runs inside VS Code via @vscode/test-electron.
// Verifies the extension activates and penmark.openPreview command is registered.
import * as assert from "assert";
import * as vscode from "vscode";

describe("Penmark extension smoke", () => {
  it("activates without error", async () => {
    // The extension activates on the penmark.preview webview panel type.
    // We trigger activation by executing the registered command; if it throws
    // the extension did not activate cleanly.
    await vscode.commands.executeCommand("penmark.openPreview");
    // If we reach here, the command ran without throwing.
    assert.ok(true, "penmark.openPreview executed without error");
  });

  it("penmark.openPreview command is registered", async () => {
    const all = await vscode.commands.getCommands(true);
    assert.ok(
      all.includes("penmark.openPreview"),
      "penmark.openPreview must be in the registered command list",
    );
  });
});
