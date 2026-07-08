import { describe, it, expect, beforeEach, vi } from "vitest";
import * as vscode from "vscode";
import { handleExportHtml } from "./exportDocument.js";
import type { ExportOptions } from "../core/protocol/messages.js";

vi.mock("./previewPanel.js", () => ({
  requestExportCapture: vi.fn(async () => ({
    requestId: "test-request",
    ok: true,
    html: "<p>exported</p>",
    rootStyle: "",
  })),
  requestExportDialog: vi.fn(),
}));

const seam = vscode as unknown as {
  workspace: {
    fs: {
      writeFile: (uri: { fsPath: string }, content: Uint8Array) => Promise<void>;
    };
    _writtenFiles: Map<string, string>;
    _resetEdits: () => void;
  };
  window: {
    _warnings: string[];
    _infos: string[];
    _resetMessages: () => void;
  };
};

const OPTIONS: ExportOptions = {
  includeFrontmatter: false,
  includeToc: false,
  width: "full",
  pdfPageSize: "a4",
  pdfMargin: "normal",
  pdfHeaderFooter: true,
};

beforeEach(() => {
  seam.workspace._resetEdits();
  seam.window._resetMessages();
});

function fakeContext(): vscode.ExtensionContext {
  return {
    extensionUri: vscode.Uri.file("/ext"),
    extension: { packageJSON: { version: "test" } },
  } as unknown as vscode.ExtensionContext;
}

function fakeDoc(): vscode.TextDocument {
  return {
    uri: vscode.Uri.file("/tmp/source.md"),
    fileName: "/tmp/source.md",
  } as unknown as vscode.TextDocument;
}

describe("handleExportHtml", () => {
  it("surfaces write failures and returns undefined", async () => {
    const originalWriteFile = seam.workspace.fs.writeFile;
    seam.workspace.fs.writeFile = async () => {
      throw new Error("EACCES: permission denied");
    };
    try {
      const result = await handleExportHtml(
        fakeContext(),
        fakeDoc(),
        OPTIONS,
        vscode.Uri.file("/tmp/source.html"),
      );

      expect(result).toBeUndefined();
      expect(seam.window._warnings.join("\n")).toContain(
        "Penmark: HTML export failed — EACCES: permission denied",
      );
      expect(seam.window._infos).toHaveLength(0);
    } finally {
      seam.workspace.fs.writeFile = originalWriteFile;
    }
  });
});
