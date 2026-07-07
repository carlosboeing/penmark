// Layer-4 extension integration tests for R17: export as HTML / PDF.
// Runs inside VS Code via @vscode/test-electron (mocha, bdd) and drives the
// FULL production journey — command → preview panel → webview capture (real
// DOMPurify + real mermaid render) → standalone document → image inlining →
// file on disk. The optional targetUri command argument is the test seam that
// skips the save dialog.
import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { findChromium } from "../../../src/vscode/pdf.js";

// A 1x1 PNG, used both as an on-disk image (inlining path) and for reference.
const DOT_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/**
 * Materialize the showcase fixture into a temp workspace with a sibling PNG so
 * the export exercises relative-image inlining alongside diagrams and code.
 */
function writeShowcaseDir(): { mdUri: vscode.Uri; dir: string } {
  const fixture = fs.readFileSync(
    path.join(__dirname, "../../fixtures/export/showcase.md"),
    "utf8",
  );
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "penmark-export-")));
  fs.writeFileSync(path.join(dir, "dot.png"), Buffer.from(DOT_PNG_BASE64, "base64"));
  const md = `${fixture}\n![Local dot](./dot.png)\n`;
  const mdPath = path.join(dir, "showcase.md");
  fs.writeFileSync(mdPath, md, "utf8");
  return { mdUri: vscode.Uri.file(mdPath), dir };
}

async function closeAll(): Promise<void> {
  await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  await new Promise((r) => setTimeout(r, 200));
}

describe("R17 — export as HTML / PDF", function (this: { timeout(ms: number): void }) {
  // The journey includes a real webview render + the multi-MB mermaid chunk;
  // generous ceiling so slow CI runners never flake on the budget.
  this.timeout(180_000);

  afterEach(async () => {
    await closeAll();
  });

  it("(a) export commands are registered", async () => {
    const all = await vscode.commands.getCommands(true);
    assert.ok(all.includes("penmark.exportHtml"), "penmark.exportHtml must be registered");
    assert.ok(all.includes("penmark.exportPdf"), "penmark.exportPdf must be registered");
  });

  it("(b) exportHtml writes a self-contained document with diagram, highlight, and inlined image", async () => {
    const { mdUri, dir } = writeShowcaseDir();
    const doc = await vscode.workspace.openTextDocument(mdUri);
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    await new Promise((r) => setTimeout(r, 300));

    const target = vscode.Uri.file(path.join(dir, "showcase.html"));
    const result = await vscode.commands.executeCommand<vscode.Uri | undefined>(
      "penmark.exportHtml",
      mdUri,
      target,
    );

    assert.ok(result, "the command must return the written target URI");
    assert.strictEqual(result.fsPath, target.fsPath);
    const html = fs.readFileSync(target.fsPath, "utf8");

    // Standalone document shape.
    assert.ok(html.startsWith("<!DOCTYPE html>"), "must be a full HTML document");
    assert.ok(html.includes('id="penmark-root"'), "must contain the content root");
    assert.ok(html.includes("Content-Security-Policy"), "must carry the CSP meta");
    assert.ok(html.includes("@page"), "must carry the print page setup");
    assert.ok(!html.includes("<script"), "must contain no scripts");

    // Content fidelity: prose, table, footnote, REAL hljs output, REAL mermaid svg.
    assert.ok(html.includes("Export Showcase"), "prose must be present");
    assert.ok(html.includes("hljs-keyword"), "code must carry hljs token spans");
    assert.ok(html.includes("<svg"), "the mermaid diagram must be a rendered svg");
    assert.ok(html.includes('class="footnotes"'), "footnotes must be present");

    // Self-containment: every local image inlined, no webview URIs left.
    assert.ok(!html.includes("vscode-resource"), "no webview resource URIs may remain");
    const dataPngCount = html.split("data:image/png;base64").length - 1;
    assert.ok(
      dataPngCount >= 2,
      `both the fixture data URI and the inlined dot.png must be data URIs (got ${String(dataPngCount)})`,
    );

    // Review/preview artifacts stripped from content.
    assert.ok(!html.includes("data-pmk-offset"), "machine offsets must be stripped");
    assert.ok(!html.includes('class="pmk-copy-btn"'), "copy buttons must be stripped");
  });

  it("(c) exportPdf prints a valid PDF via a system browser (skips when none installed)", async function (this: {
    skip(): void;
  }) {
    const browser = await findChromium();
    if (!browser) {
      this.skip();
      return;
    }

    const { mdUri, dir } = writeShowcaseDir();
    const doc = await vscode.workspace.openTextDocument(mdUri);
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    await new Promise((r) => setTimeout(r, 300));

    const target = vscode.Uri.file(path.join(dir, "showcase.pdf"));
    const result = await vscode.commands.executeCommand<vscode.Uri | undefined>(
      "penmark.exportPdf",
      mdUri,
      target,
    );

    assert.ok(result, "the command must return the written target URI");
    const pdf = fs.readFileSync(target.fsPath);
    assert.strictEqual(
      pdf.subarray(0, 5).toString("latin1"),
      "%PDF-",
      "output must carry the PDF magic",
    );
    assert.ok(pdf.length > 10_000, `PDF must have real content (got ${String(pdf.length)} bytes)`);
  });
});
