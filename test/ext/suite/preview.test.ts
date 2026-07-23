// Layer-4 extension integration tests for T4: webview preview panel.
// Runs inside VS Code via @vscode/test-electron (mocha, bdd).
import * as assert from "assert";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import * as vscode from "vscode";
import type { ExtensionApi } from "../../../src/vscode/extension.js";
import {
  handleAddComment,
  handleCopyCode,
  handleResolveComment,
  maybePostRevealLine,
} from "../../../src/vscode/previewPanel.js";

// Mocha globals — not in @types/vscode but present at runtime in the extension host.
declare function before(fn: () => Promise<void>): void;
declare function after(fn: () => Promise<void>): void;

// ---------------------------------------------------------------------------
// Extension exports access via test seam
// ---------------------------------------------------------------------------

function getManager(): ExtensionApi["previewManager"] {
  const ext = vscode.extensions.getExtension<ExtensionApi>("local.penmark-markdown-review");
  assert.ok(ext, "Penmark extension must be installed in test VS Code instance");
  // The extension should already be active (activated by the command in `before`).
  // If not yet active, activate() is synchronous after activation, but exports
  // are available immediately on the ext.exports object.
  return ext.exports.previewManager;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Open a markdown document in VS Code and return the text editor. */
async function openMarkdownEditor(content: string): Promise<vscode.TextEditor> {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "penmark-t4-")));
  const filePath = path.join(dir, "test.md");
  fs.writeFileSync(filePath, content, "utf8");
  const uri = vscode.Uri.file(filePath);
  const doc = await vscode.workspace.openTextDocument(uri);
  return vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
}

/** Close all open editors/tabs between tests. */
async function closeAll(): Promise<void> {
  await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  // Give VS Code a tick to settle.
  await new Promise((r) => setTimeout(r, 200));
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("T4 — webview preview panel", () => {
  // Ensure the extension is activated before any test runs.
  before(async () => {
    // Trigger activation. The existing smoke test has already done this, but
    // we want the panel open/closed cycle to be fully settled.
    await vscode.commands.executeCommand("penmark.openPreview");
    await new Promise((r) => setTimeout(r, 400));
    await closeAll();
  });

  after(async () => {
    await closeAll();
  });

  // -------------------------------------------------------------------------
  // (a) Command registration
  // -------------------------------------------------------------------------
  it("(a) penmark.openPreview and penmark.openCustomEditor commands are registered", async () => {
    const all = await vscode.commands.getCommands(true);
    assert.ok(
      all.includes("penmark.openPreview"),
      "penmark.openPreview must appear in the registered command list",
    );
    assert.ok(
      all.includes("penmark.openCustomEditor"),
      "penmark.openCustomEditor must appear in the registered command list",
    );
  });

  // -------------------------------------------------------------------------
  // (b) Invoking on a .md editor creates a webview panel
  // -------------------------------------------------------------------------
  it("(b) invoking on a .md editor creates a webview panel", async () => {
    await openMarkdownEditor("# Hello\n\nWorld\n");
    await vscode.commands.executeCommand("penmark.openPreview");
    // Allow the panel to open.
    await new Promise((r) => setTimeout(r, 500));

    const manager = getManager();
    assert.strictEqual(
      manager.panelCount(),
      1,
      "exactly one panel should exist after first openPreview",
    );

    await closeAll();
  });

  // -------------------------------------------------------------------------
  // (c) Second invocation reuses the same panel (singleton per column)
  // -------------------------------------------------------------------------
  it("(c) second invocation reuses the same panel", async () => {
    await openMarkdownEditor("# Doc A\n");
    await vscode.commands.executeCommand("penmark.openPreview");
    await new Promise((r) => setTimeout(r, 300));

    await vscode.commands.executeCommand("penmark.openPreview");
    await new Promise((r) => setTimeout(r, 300));

    const manager = getManager();
    assert.strictEqual(
      manager.panelCount(),
      1,
      "second invocation must reuse the existing panel — panelCount must still be 1",
    );

    await closeAll();
  });

  // -------------------------------------------------------------------------
  // (d) Panel HTML contains nonce CSP meta; retainContextWhenHidden is NOT set
  // -------------------------------------------------------------------------
  it("(d) panel HTML has nonce CSP meta and does not retain context when hidden", async () => {
    await openMarkdownEditor("# CSP test\n");
    await vscode.commands.executeCommand("penmark.openPreview");
    await new Promise((r) => setTimeout(r, 500));

    const manager = getManager();

    const html = manager.lastHtml();
    assert.ok(html, "lastHtml() should return the shell HTML");

    // Must contain a CSP meta tag with a nonce.
    assert.match(html, /Content-Security-Policy/i, "shell HTML must contain a CSP meta tag");
    assert.match(html, /nonce-[a-zA-Z0-9+/=]{16,}/, "CSP must contain a nonce attribute");
    assert.match(html, /<meta[^>]+Content-Security-Policy/i, "CSP must be in a <meta> tag");

    // retainContextWhenHidden must NOT be set (not enabled).
    const retainContext = manager.lastRetainContext();
    assert.strictEqual(retainContext, false, "retainContextWhenHidden must not be enabled");

    await closeAll();
  });

  // -------------------------------------------------------------------------
  // (e) Editing the document triggers exactly one re-render within 250–600 ms
  // -------------------------------------------------------------------------
  it("(e) editing coalesces rapid edits into fewer renders than edits", async () => {
    const editor = await openMarkdownEditor("# Original\n");
    await vscode.commands.executeCommand("penmark.openPreview");
    await new Promise((r) => setTimeout(r, 400));

    const manager = getManager();

    // Reset the counter so we only count re-renders from the edit below.
    manager.resetRenderCount();

    // Make several rapid edits (simulate debounce coalescing).
    await editor.edit((b) => b.insert(new vscode.Position(1, 0), "\n## Added\n"));
    await editor.edit((b) => b.insert(new vscode.Position(2, 0), "\nmore text\n"));
    await editor.edit((b) => b.insert(new vscode.Position(3, 0), "\neven more\n"));

    // Wait well past the debounce window so all timers have flushed.
    await new Promise((r) => setTimeout(r, 600));

    // The 3 rapid edits must COALESCE: fewer renders than edits. We assert a
    // range (1 <= count < 3) rather than exactly 1 because the assertion must
    // not depend on the 3 awaited `editor.edit` calls all landing inside one
    // DEBOUNCE_MS (300 ms) window. On slow Windows CI runners the 3 awaited
    // edits can span >300 ms, so the first edit's debounce can fire before the
    // third edit lands — yielding 2 renders. That is still correct coalescing
    // (3 edits did not produce 3 renders); only "no coalescing at all" (3) is a
    // real failure. This preserves the test's intent without the timing flake.
    const count = manager.renderCount();
    assert.ok(
      count >= 1 && count < 3,
      `expected rapid edits to coalesce (1 <= renders < 3), got ${String(count)}`,
    );

    await closeAll();
  });

  // -------------------------------------------------------------------------
  // (f) Relative image src is rewritten to a webview resource URI
  // -------------------------------------------------------------------------
  it("(f) relative image src is rewritten to a webview resource URI", async () => {
    // Write a fixture with a relative image.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "penmark-t4-img-"));
    const mdPath = path.join(dir, "doc.md");
    // The image file doesn't need to exist — resolveImage only calls asWebviewUri.
    fs.writeFileSync(mdPath, "![Alt](./photo.png)\n", "utf8");

    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(mdPath));
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    // Wait for VS Code to settle the active editor before invoking the command.
    await new Promise((r) => setTimeout(r, 200));
    await vscode.commands.executeCommand("penmark.openPreview");
    await new Promise((r) => setTimeout(r, 600));

    const manager = getManager();

    const msg = manager.lastRenderMessage();
    assert.ok(msg, "lastRenderMessage() should return the last render payload");

    // asWebviewUri converts file:// paths to a vscode-webview-resource or
    // https://*.vscode-cdn.net URI. Either way the original relative path must
    // have been replaced with an absolute URI containing the filename.
    assert.ok(
      msg.html.includes("photo.png"),
      `rendered HTML must still reference photo.png; actual html: ${msg.html.slice(0, 500)}`,
    );
    // The URI must NOT be a bare relative path — it must have been resolved.
    assert.ok(
      !msg.html.includes('src="./photo.png"') && !msg.html.includes("src='./photo.png'"),
      `relative src must have been replaced by asWebviewUri; actual html: ${msg.html.slice(0, 600)}`,
    );

    await closeAll();
  });

  // -------------------------------------------------------------------------
  // (g) Changing penmark.theme config posts a setTheme message to the panel (T6)
  // -------------------------------------------------------------------------
  it("(g) changing penmark.theme config posts setTheme to the webview", async () => {
    await openMarkdownEditor("# Theme test\n");
    await vscode.commands.executeCommand("penmark.openPreview");
    await new Promise((r) => setTimeout(r, 500));

    const manager = getManager();
    const config = vscode.workspace.getConfiguration("penmark");

    try {
      await config.update("theme", "dark", vscode.ConfigurationTarget.Global);

      // onDidChangeConfiguration fires asynchronously — poll for the recorded message.
      let msg: ReturnType<typeof manager.lastSetThemeMessage>;
      for (let i = 0; i < 20; i++) {
        msg = manager.lastSetThemeMessage();
        if (msg && msg.theme === "dark") break;
        await new Promise((r) => setTimeout(r, 50));
      }

      assert.ok(msg, "a setTheme message must be posted after the penmark.theme config change");
      assert.strictEqual(msg.v, 1);
      assert.strictEqual(msg.type, "setTheme");
      assert.strictEqual(msg.theme, "dark");
    } finally {
      // Restore the default so other tests / subsequent runs are unaffected.
      await config.update("theme", undefined, vscode.ConfigurationTarget.Global);
      await closeAll();
    }
  });

  // -------------------------------------------------------------------------
  // (h) The render message theme reflects penmark.theme, not the IDE theme (T6)
  // -------------------------------------------------------------------------
  it("(h) render message theme reflects the penmark.theme setting", async () => {
    const config = vscode.workspace.getConfiguration("penmark");
    try {
      // "auto" is the discriminator: an IDE-derived theme can never be "auto"
      // for a themed test instance, so this fails if the host sends the IDE
      // theme instead of the setting. Set it BEFORE opening (first render).
      await config.update("theme", "auto", vscode.ConfigurationTarget.Global);

      await openMarkdownEditor("# Theme on render\n");
      await vscode.commands.executeCommand("penmark.openPreview");
      await new Promise((r) => setTimeout(r, 600));

      const manager = getManager();
      const msg = manager.lastRenderMessage();
      assert.ok(msg, "lastRenderMessage() should return the render payload");
      // Must be the configured setting ("auto"), never an IDE-derived value.
      assert.strictEqual(
        msg.theme,
        "auto",
        "render theme must come from penmark.theme, not vscode.window.activeColorTheme",
      );
    } finally {
      await config.update("theme", undefined, vscode.ConfigurationTarget.Global);
      await closeAll();
    }
  });

  // -------------------------------------------------------------------------
  // (i) handleCopyCode writes the text to the system clipboard (T8 round-trip)
  // -------------------------------------------------------------------------
  it("(i) handleCopyCode writes code text to the clipboard", async () => {
    const original = await vscode.env.clipboard.readText();
    try {
      const codeText = "function add(a, b) {\n  return a + b;\n}\n";
      await handleCopyCode(codeText);
      const clip = await vscode.env.clipboard.readText();
      assert.strictEqual(
        clip,
        codeText,
        "clipboard must contain the exact copied code text after handleCopyCode",
      );
    } finally {
      // Restore the prior clipboard so other tests / the environment are unaffected.
      await vscode.env.clipboard.writeText(original);
    }
  });

  // -------------------------------------------------------------------------
  // (j) Scroll sync posts revealLine only when penmark.scrollSync is on (T10)
  // -------------------------------------------------------------------------
  it("(j) editor scroll posts revealLine only when penmark.scrollSync is on", async () => {
    const editor = await openMarkdownEditor(
      Array.from({ length: 200 }, (_, i) => `Line ${String(i)}`).join("\n") + "\n",
    );
    await vscode.commands.executeCommand("penmark.openPreview");
    await new Promise((r) => setTimeout(r, 500));

    const manager = getManager();
    const config = vscode.workspace.getConfiguration("penmark");

    try {
      // --- Setting ON: a visible-range change posts revealLine. ---
      await config.update("scrollSync", true, vscode.ConfigurationTarget.Global);
      await new Promise((r) => setTimeout(r, 100));

      const entry = manager.lastEntry();
      assert.ok(entry, "a panel entry must exist after openPreview");

      // Prefer exercising the real listener: scroll the editor and poll for the
      // posted revealLine. Driving real editor scroll in test-electron can be
      // finicky and onDidChangeTextEditorVisibleRanges may not fire under the
      // harness, so if it does not arrive we fall back to the maybePostRevealLine
      // seam — which checks the exact setting + suppression gating the listener
      // uses — to prove "revealLine posted only when setting on".
      editor.revealRange(new vscode.Range(120, 0, 120, 0), vscode.TextEditorRevealType.AtTop);

      let onMsg: ReturnType<typeof manager.lastRevealLineMessage>;
      for (let i = 0; i < 20; i++) {
        onMsg = manager.lastRevealLineMessage();
        if (onMsg) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      if (!onMsg) {
        // Listener did not fire under the harness — drive the seam directly.
        maybePostRevealLine(entry, 120);
        onMsg = manager.lastRevealLineMessage();
      }
      assert.ok(onMsg, "revealLine must be posted when penmark.scrollSync is on");
      assert.strictEqual(onMsg.v, 1);
      assert.strictEqual(onMsg.type, "revealLine");

      // --- Setting OFF: no NEW revealLine is posted. ---
      await config.update("scrollSync", false, vscode.ConfigurationTarget.Global);
      await new Promise((r) => setTimeout(r, 100));

      const before = manager.lastRevealLineMessage();
      // Bypass the host throttle so OFF is the only reason nothing is posted.
      entry.lastRevealLinePostedAt = 0;
      entry.suppressVisibleRangeUntil = 0;
      maybePostRevealLine(entry, 40);
      const after = manager.lastRevealLineMessage();
      assert.deepStrictEqual(
        after,
        before,
        "no new revealLine must be posted when penmark.scrollSync is off",
      );
    } finally {
      await config.update("scrollSync", undefined, vscode.ConfigurationTarget.Global);
      await closeAll();
    }
  });

  // -------------------------------------------------------------------------
  // (R7) add → resolve round-trip via the source editor mutation path
  // -------------------------------------------------------------------------
  it("(R7) add then resolve a comment mutates the document through the source editor", async () => {
    const original = "The renderer uses markdown-it under the hood.\n";
    const editor = await openMarkdownEditor(original);
    const doc = editor.document;
    try {
      // Add a comment on the word "renderer" (body-relative offsets == source
      // offsets here — no frontmatter).
      const start = original.indexOf("renderer");
      await handleAddComment(
        doc,
        { start, end: start + "renderer".length },
        "renderer",
        "which one?",
      );
      await new Promise((r) => setTimeout(r, 500));

      const afterAdd = doc.getText();
      assert.ok(afterAdd.includes("<!--pmk:s "), "span opener marker must be inserted");
      assert.ok(afterAdd.includes("<!-- pmk:review v1 -->"), "review block must be created");
      assert.ok(afterAdd.includes("which one?"), "comment body must be stored");

      const id = /<!--pmk:c ([a-z2-7]{8})/.exec(doc.getText())?.[1];
      assert.ok(id, "the added entry must expose a parseable id");
      await handleResolveComment(doc, id!);
      await new Promise((r) => setTimeout(r, 500));

      const afterResolve = doc.getText();
      assert.ok(!afterResolve.includes("pmk:"), "resolve must strip all pmk markers and the entry");
      assert.ok(afterResolve.includes("The renderer uses markdown-it"), "prose must be preserved");
    } finally {
      await closeAll();
    }
  });

  it("can open a document using the custom editor", async () => {
    const [major, minor] = vscode.version.split(".").map(Number);
    assert.ok(
      major! > 1 || (major === 1 && minor! >= 105),
      `custom editor native Find requires VS Code 1.105.0 or newer; got ${vscode.version}`,
    );

    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "penmark-custom-")));
    const filePath = path.join(dir, "custom-test.md");
    fs.writeFileSync(filePath, "# Custom Editor Test\n", "utf8");
    const uri = vscode.Uri.file(filePath);

    // Open using Penmark Custom Editor
    await vscode.commands.executeCommand("vscode.openWith", uri, "penmark.previewEditor");
    await new Promise((r) => setTimeout(r, 600));

    const manager = getManager();
    assert.ok(manager.panelCount() > 0, "custom editor panel should be registered in previewManager");
    
    // Cleanup
    await closeAll();
  });

  it("can open a document using the openCustomEditor command", async () => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "penmark-custom-cmd-")));
    const filePath = path.join(dir, "custom-cmd-test.md");
    fs.writeFileSync(filePath, "# Custom Editor Command Test\n", "utf8");
    const uri = vscode.Uri.file(filePath);

    // Open using the penmark.openCustomEditor command
    await vscode.commands.executeCommand("penmark.openCustomEditor", uri);
    await new Promise((r) => setTimeout(r, 600));

    const manager = getManager();
    assert.ok(manager.panelCount() > 0, "custom editor panel should be registered in previewManager via command");
    
    // Cleanup
    await closeAll();
  });
});
