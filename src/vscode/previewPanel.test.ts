import { describe, it, expect, beforeEach, vi } from "vitest";
import * as vscode from "vscode";
import {
  handleAddComment,
  handleResolveComment,
  handleEditComment,
  handleExportReview,
  handleUpdateSetting,
  openFind,
  openPreview,
  PreviewPanelSerializer,
  previewManager,
  pushConfiguredPreviewUpdates,
  enqueueMutation,
} from "./previewPanel.js";
import type { PanelEntry } from "./previewPanel.js";

// Test seams exposed by the vscode mock (test/setup/vscode-mock.ts).
const seam = vscode as unknown as {
  __resetConfig: () => void;
  workspace: {
    _appliedEdits: unknown[];
    _configUpdates: Array<{ section: string; key: string; value: unknown; target: unknown }>;
    _writtenFiles: Map<string, string>;
    _resetEdits: () => void;
  };
  window: {
    activeTextEditor:
      | {
          document: vscode.TextDocument;
        }
      | undefined;
    _createWebviewPanelCalls: Array<{
      viewType: string;
      title: string;
      showOptions: unknown;
      options: unknown;
    }>;
    _createdWebviewPanels: Array<{ dispose: () => void }>;
    visibleTextEditors: Array<{
      document: { uri: { toString: () => string } };
      edit: (
        callback: (builder: { replace: (range: vscode.Range, newText: string) => void }) => void,
        options?: { undoStopBefore: boolean; undoStopAfter: boolean },
      ) => Promise<boolean>;
    }>;
    _infos: string[];
    _quickPickChoice: string | undefined;
    _resetMessages: () => void;
  };
  env: { clipboard: { _text: string } };
};

/** A fake TextDocument exposing only what the host handlers touch. */
function fakeDoc(text: string, fsPath = "/tmp/doc.md"): vscode.TextDocument {
  return {
    uri: vscode.Uri.file(fsPath),
    fileName: fsPath,
    getText: () => text,
    positionAt(offset: number): vscode.Position {
      const clamped = Math.max(0, Math.min(offset, text.length));
      let line = 0;
      let lastNl = -1;
      for (let i = 0; i < clamped; i++) {
        if (text.charAt(i) === "\n") {
          line++;
          lastNl = i;
        }
      }
      return new vscode.Position(line, clamped - lastNl - 1);
    },
    save: async () => true,
  } as unknown as vscode.TextDocument;
}

beforeEach(() => {
  seam.__resetConfig();
  seam.workspace._resetEdits();
  seam.window._resetMessages();
  seam.window.visibleTextEditors.length = 0;
  seam.window.activeTextEditor = undefined;
  seam.window._createWebviewPanelCalls.length = 0;
  seam.window._createdWebviewPanels.length = 0;
  seam.env.clipboard._text = "";
});

describe("openPreview — native Find", () => {
  it("enables the native Find widget when creating the command preview panel", () => {
    const document = fakeDoc("# Find me\n");
    Object.defineProperty(document, "languageId", { value: "markdown" });
    seam.window.activeTextEditor = { document };

    openPreview({ extensionUri: vscode.Uri.file("/extension") } as vscode.ExtensionContext);

    expect(seam.window._createWebviewPanelCalls).toHaveLength(1);
    expect(seam.window._createWebviewPanelCalls[0]).toMatchObject({
      viewType: "penmark.preview",
      title: "Penmark Preview",
      showOptions: { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      options: {
        enableScripts: true,
        enableFindWidget: true,
      },
    });
    expect(
      (
        seam.window._createWebviewPanelCalls[0]?.options as {
          localResourceRoots: Array<{ fsPath: string }>;
        }
      ).localResourceRoots.map((uri) => uri.fsPath),
    ).toEqual(["/extension/dist"]);

    seam.window._createdWebviewPanels[0]?.dispose();
    expect(previewManager.panelCount()).toBe(0);
  });
});

describe("openFind — webview readiness", () => {
  it("delivers immediately after revealing a hidden webview that retained its listener", async () => {
    let disposePanel: (() => void) | undefined;
    let reveals = 0;
    const posted: unknown[] = [];
    const disposable = { dispose(): void {} };
    const panel = {
      active: false,
      viewColumn: vscode.ViewColumn.One,
      reveal(): void {
        reveals++;
      },
      webview: {
        cspSource: "test-csp",
        html: "",
        asWebviewUri: (uri: vscode.Uri) => uri,
        postMessage: async (message: unknown) => {
          posted.push(message);
          return true;
        },
        onDidReceiveMessage(): vscode.Disposable {
          return disposable;
        },
      },
      onDidDispose(callback: () => void): vscode.Disposable {
        disposePanel = callback;
        return disposable;
      },
    } as unknown as vscode.WebviewPanel;

    await new PreviewPanelSerializer({ extensionUri: vscode.Uri.file("/extension") } as vscode.ExtensionContext)
      .deserializeWebviewPanel(panel, undefined);

    openFind();

    expect(reveals).toBe(1);
    expect(posted).toEqual([{ v: 1, type: "openFind" }]);
    disposePanel?.();
  });

  it("waits for a newly created webview listener before posting the command once", async () => {
    let receiveMessage: ((message: unknown) => void) | undefined;
    let disposePanel: (() => void) | undefined;
    const posted: unknown[] = [];
    const disposable = { dispose(): void {} };
    const panel = {
      active: true,
      viewColumn: vscode.ViewColumn.One,
      webview: {
        cspSource: "test-csp",
        html: "",
        asWebviewUri: (uri: vscode.Uri) => uri,
        postMessage: async (message: unknown) => {
          posted.push(message);
          return true;
        },
        onDidReceiveMessage(callback: (message: unknown) => void): vscode.Disposable {
          receiveMessage = callback;
          return disposable;
        },
      },
      onDidDispose(callback: () => void): vscode.Disposable {
        disposePanel = callback;
        return disposable;
      },
    } as unknown as vscode.WebviewPanel;

    await new PreviewPanelSerializer({ extensionUri: vscode.Uri.file("/extension") } as vscode.ExtensionContext)
      .deserializeWebviewPanel(panel, undefined);

    openFind();
    expect(posted).toEqual([]);

    receiveMessage!({ v: 1, type: "ready" });
    expect(posted).toEqual([{ v: 1, type: "openFind" }]);

    receiveMessage!({ v: 1, type: "ready" });
    expect(posted).toEqual([{ v: 1, type: "openFind" }]);
    disposePanel?.();
  });

  it("retries after ready when revealing recreated webview drops the first delivery", async () => {
    let receiveMessage: ((message: unknown) => void) | undefined;
    let disposePanel: (() => void) | undefined;
    let reveals = 0;
    const posted: unknown[] = [];
    const disposable = { dispose(): void {} };
    const panel = {
      active: false,
      viewColumn: vscode.ViewColumn.One,
      reveal(): void {
        reveals++;
      },
      webview: {
        cspSource: "test-csp",
        html: "",
        asWebviewUri: (uri: vscode.Uri) => uri,
        postMessage: async (message: unknown) => {
          posted.push(message);
          return true;
        },
        onDidReceiveMessage(callback: (message: unknown) => void): vscode.Disposable {
          receiveMessage = callback;
          return disposable;
        },
      },
      onDidDispose(callback: () => void): vscode.Disposable {
        disposePanel = callback;
        return disposable;
      },
    } as unknown as vscode.WebviewPanel;

    await new PreviewPanelSerializer({ extensionUri: vscode.Uri.file("/extension") } as vscode.ExtensionContext)
      .deserializeWebviewPanel(panel, undefined);

    openFind();
    expect(reveals).toBe(1);
    expect(posted).toEqual([{ v: 1, type: "openFind" }]);

    receiveMessage!({ v: 1, type: "ready" });
    expect(posted).toEqual([{ v: 1, type: "openFind" }, { v: 1, type: "openFind" }]);
    disposePanel?.();
  });
});

describe("handleAddComment — host wiring (R7)", () => {
  it("applies exactly one WorkspaceEdit for a commentable selection, no message", async () => {
    const text = "The renderer uses markdown-it under the hood.\n";
    const start = text.indexOf("markdown-it");
    await handleAddComment(
      fakeDoc(text),
      { start, end: start + "markdown-it".length },
      "markdown-it",
      "which version?",
    );
    expect(seam.workspace._appliedEdits).toHaveLength(1);
    expect(seam.window._infos).toHaveLength(0);
  });

  it("does not force-save after applying the edit so undo remains available", async () => {
    const text = "The renderer uses markdown-it under the hood.\n";
    const start = text.indexOf("renderer");
    let saves = 0;
    const doc = fakeDoc(text);
    doc.save = async () => {
      saves++;
      return true;
    };
    await handleAddComment(
      doc,
      { start, end: start + "renderer".length },
      "renderer",
      "which one?",
    );
    expect(seam.workspace._appliedEdits).toHaveLength(1);
    expect(saves).toBe(0);
  });

  it("uses the visible source editor edit stack with explicit undo stops", async () => {
    const text = "The renderer uses markdown-it under the hood.\n";
    const start = text.indexOf("renderer");
    const doc = fakeDoc(text);
    const replacements: Array<{ range: vscode.Range; newText: string }> = [];
    let undoOptions: { undoStopBefore: boolean; undoStopAfter: boolean } | undefined;
    seam.window.visibleTextEditors.push({
      document: { uri: doc.uri },
      edit: async (callback, options) => {
        undoOptions = options;
        callback({
          replace: (range, newText) => replacements.push({ range, newText }),
        });
        return true;
      },
    });

    await handleAddComment(
      doc,
      { start, end: start + "renderer".length },
      "renderer",
      "which one?",
    );

    expect(seam.workspace._appliedEdits).toHaveLength(0);
    expect(replacements.length).toBeGreaterThan(0);
    expect(undoOptions).toEqual({ undoStopBefore: true, undoStopAfter: true });
  });

  it("shows a discreet message and applies NO edit for an uncommentable selection (§4.1)", async () => {
    const text = "See [the docs][d].\n\n[d]: https://example.com/docs\n";
    const start = text.indexOf("https://example.com/docs");
    await handleAddComment(
      fakeDoc(text),
      { start, end: start + "https://example.com/docs".length },
      "x",
      "y",
    );
    expect(seam.workspace._appliedEdits).toHaveLength(0);
    expect(seam.window._infos).toHaveLength(1);
  });
});

describe("handleResolveComment — host wiring (R7)", () => {
  const withComment =
    "Hello <!--pmk:s abcdefgh-->world<!--/pmk:s abcdefgh-->.\n\n" +
    "<!-- pmk:review v1 -->\n" +
    "<!--pmk:c abcdefgh\nt (human) · 2026-06-14 12:00 +10:00\n> world\n\nnote\n-->\n" +
    "<!-- /pmk:review -->\n";

  it("applies one WorkspaceEdit when the id exists", async () => {
    await handleResolveComment(fakeDoc(withComment), "abcdefgh");
    expect(seam.workspace._appliedEdits).toHaveLength(1);
  });

  it("does not force-save after applying the edit so undo remains available", async () => {
    let saves = 0;
    const doc = fakeDoc(withComment);
    doc.save = async () => {
      saves++;
      return true;
    };
    await handleResolveComment(doc, "abcdefgh");
    expect(seam.workspace._appliedEdits).toHaveLength(1);
    expect(saves).toBe(0);
  });

  it("is a no-op (no edit) when the id is absent", async () => {
    await handleResolveComment(fakeDoc(withComment), "nope0000");
    expect(seam.workspace._appliedEdits).toHaveLength(0);
  });
});

describe("handleEditComment — host wiring (R7)", () => {
  const withComment =
    "Hello <!--pmk:s abcdefgh-->world<!--/pmk:s abcdefgh-->.\n\n" +
    "<!-- pmk:review v1 -->\n" +
    "<!--pmk:c abcdefgh\nt (human) · 2026-06-14 12:00 +10:00\n> world\n\nnote\n-->\n" +
    "<!-- /pmk:review -->\n";

  it("applies one WorkspaceEdit when the id exists", async () => {
    await handleEditComment(fakeDoc(withComment), "abcdefgh", "new note text");
    expect(seam.workspace._appliedEdits).toHaveLength(1);
  });

  it("does not force-save after applying the edit so undo remains available", async () => {
    let saves = 0;
    const doc = fakeDoc(withComment);
    doc.save = async () => {
      saves++;
      return true;
    };
    await handleEditComment(doc, "abcdefgh", "new note text");
    expect(seam.workspace._appliedEdits).toHaveLength(1);
    expect(saves).toBe(0);
  });

  it("is a no-op (no edit) when the id is absent", async () => {
    await handleEditComment(fakeDoc(withComment), "nope0000", "new note text");
    expect(seam.workspace._appliedEdits).toHaveLength(0);
  });
});

describe("enqueueMutation — serializes overlapping mutations (R7)", () => {
  it("runs ops strictly in order even when an earlier op is slower", async () => {
    const entry = {} as PanelEntry;
    const order: string[] = [];
    enqueueMutation(entry, async () => {
      await new Promise((r) => setTimeout(r, 15));
      order.push("a");
    });
    enqueueMutation(entry, async () => {
      order.push("b");
    });
    await entry.mutationChain;
    // "b" must wait for the slower "a" to finish — no overlap, no stale read.
    expect(order).toEqual(["a", "b"]);
  });

  it("a failed op does not break the chain for the next op", async () => {
    const entry = {} as PanelEntry;
    const order: string[] = [];
    enqueueMutation(entry, async () => {
      throw new Error("boom");
    });
    enqueueMutation(entry, async () => {
      order.push("after-failure");
    });
    await entry.mutationChain;
    expect(order).toEqual(["after-failure"]);
  });
});

describe("handleExportReview — host wiring (R9)", () => {
  const oneComment =
    "Hello <!--pmk:s abcdefgh-->world<!--/pmk:s abcdefgh-->.\n\n" +
    "<!-- pmk:review v1 -->\n" +
    "<!--pmk:c abcdefgh\nAda (human) · 2026-06-14 12:00 +10:00\n> world\n\nclarify this\n-->\n" +
    "<!-- /pmk:review -->\n";

  it("copies the review prompt to the clipboard (default choice)", async () => {
    seam.window._quickPickChoice = "Copy to clipboard";
    await handleExportReview(fakeDoc(oneComment));
    expect(seam.env.clipboard._text).toContain("# Penmark review");
    expect(seam.env.clipboard._text).toContain("clarify this");
    expect(seam.workspace._writtenFiles.size).toBe(0);
  });

  it("saves the review beside the document as <basename>.review.md", async () => {
    seam.window._quickPickChoice = "Save to file";
    await handleExportReview(fakeDoc(oneComment));
    expect(seam.workspace._writtenFiles.has("/tmp/doc.review.md")).toBe(true);
    expect(seam.workspace._writtenFiles.get("/tmp/doc.review.md")).toContain("# Penmark review");
    expect(seam.env.clipboard._text).toBe("");
  });

  it("does nothing when the quick-pick is dismissed", async () => {
    seam.window._quickPickChoice = undefined;
    await handleExportReview(fakeDoc(oneComment));
    expect(seam.env.clipboard._text).toBe("");
    expect(seam.workspace._writtenFiles.size).toBe(0);
  });

  it("exports a 'No open comments.' stub for a comment-free document (never inert)", async () => {
    seam.window._quickPickChoice = "Copy to clipboard";
    await handleExportReview(fakeDoc("# Heading\n\nProse only, no comments.\n"));
    expect(seam.env.clipboard._text).toContain("No open comments.");
  });

  it("derives the .review.md name correctly for a multi-dot filename", async () => {
    seam.window._quickPickChoice = "Save to file";
    await handleExportReview(fakeDoc(oneComment, "/tmp/design.v1.md"));
    expect(seam.workspace._writtenFiles.has("/tmp/design.v1.review.md")).toBe(true);
  });
});

describe("handleUpdateSetting — preview settings panel host wiring", () => {
  it("persists valid preview settings globally", async () => {
    await handleUpdateSetting("preset", "reading");
    await handleUpdateSetting("textSize", "large");
    await handleUpdateSetting("contentWidth", "comfortable");
    await handleUpdateSetting("comments.highlightIntensity", "strong");
    await handleUpdateSetting("lineHeight", 1.65);
    await handleUpdateSetting("codeBlockWrap", false);

    expect(seam.workspace._configUpdates.map((u) => [u.key, u.value])).toEqual([
      ["preset", "reading"],
      ["textSize", "large"],
      ["contentWidth", "comfortable"],
      ["comments.highlightIntensity", "strong"],
      ["lineHeight", 1.65],
      ["codeBlockWrap", false],
    ]);
  });

  it("rejects invalid preview settings without writing config", async () => {
    await handleUpdateSetting("preset", "neon");
    await handleUpdateSetting("lineHeight", 9);
    await handleUpdateSetting("theme", "solarized");

    expect(seam.workspace._configUpdates).toHaveLength(0);
  });

  it("accepts only booleans for codeBlockWrap", async () => {
    await handleUpdateSetting("codeBlockWrap", true);
    await handleUpdateSetting("codeBlockWrap", "true");
    await handleUpdateSetting("codeBlockWrap", 1);

    expect(seam.workspace._configUpdates.map((u) => [u.key, u.value])).toEqual([
      ["codeBlockWrap", true],
    ]);
  });

  it("pushes an external codeBlockWrap change without rendering or assigning webview.html", () => {
    (
      vscode as unknown as {
        __setConfig: (section: string, values: Record<string, unknown>) => void;
      }
    ).__setConfig("penmark", { codeBlockWrap: false });
    const posted: unknown[] = [];
    let htmlAssignments = 0;
    const webview = {
      get html(): string {
        return "shell";
      },
      set html(_value: string) {
        htmlAssignments++;
      },
      postMessage(message: unknown): Promise<boolean> {
        posted.push(message);
        return Promise.resolve(true);
      },
    };
    const entry = {
      panel: { webview },
      renderCount: 4,
      html: "shell",
    } as unknown as PanelEntry;

    pushConfiguredPreviewUpdates(entry, (section) => section === "penmark.codeBlockWrap");

    expect(posted).toEqual([{ v: 1, type: "setCodeBlockWrap", codeBlockWrap: false }]);
    expect(entry.renderCount).toBe(4);
    expect(entry.html).toBe("shell");
    expect(htmlAssignments).toBe(0);
  });

  it("rejects malformed setting values at the webview message boundary", async () => {
    let receiveMessage: ((message: unknown) => void) | undefined;
    let disposePanel: (() => void) | undefined;
    const disposable = { dispose(): void {} };
    const workspace = vscode.workspace as unknown as {
      onDidChangeConfiguration?: (listener: (event: unknown) => void) => vscode.Disposable;
    };
    const window = vscode.window as unknown as {
      onDidChangeTextEditorVisibleRanges?: (listener: (event: unknown) => void) => vscode.Disposable;
    };
    const originalConfigListener = workspace.onDidChangeConfiguration;
    const originalVisibleRangeListener = window.onDidChangeTextEditorVisibleRanges;
    workspace.onDidChangeConfiguration = () => disposable;
    window.onDidChangeTextEditorVisibleRanges = () => disposable;

    const webview = {
      cspSource: "test-csp",
      html: "",
      asWebviewUri: (uri: vscode.Uri) => uri,
      postMessage: async () => true,
      onDidReceiveMessage(callback: (message: unknown) => void): vscode.Disposable {
        receiveMessage = callback;
        return disposable;
      },
    };
    const panel = {
      viewColumn: 1,
      webview,
      onDidDispose(callback: () => void): vscode.Disposable {
        disposePanel = callback;
        return disposable;
      },
    } as unknown as vscode.WebviewPanel;
    const context = {
      extensionUri: vscode.Uri.file("/extension"),
    } as vscode.ExtensionContext;

    try {
      await new PreviewPanelSerializer(context).deserializeWebviewPanel(panel, undefined);
      expect(receiveMessage).toBeTypeOf("function");

      receiveMessage!({ v: 1, type: "updateSetting", key: "codeBlockWrap", value: "true" });
      receiveMessage!({ v: 1, type: "updateSetting", key: "codeBlockWrap", value: 1 });
      receiveMessage!({ v: 1, type: "updateSetting", key: "preset", value: true });
      receiveMessage!({ v: 1, type: "updateSetting", key: "codeBlockWrap", value: false });

      expect(seam.workspace._configUpdates.map((update) => [update.key, update.value])).toEqual([
        ["codeBlockWrap", false],
      ]);
    } finally {
      disposePanel?.();
      workspace.onDidChangeConfiguration = originalConfigListener;
      window.onDidChangeTextEditorVisibleRanges = originalVisibleRangeListener;
    }
  });
});

describe("openPenmarkSettings — host wiring", () => {
  it("runs the fixed openSettings command and ignores webview-provided URI data", async () => {
    let receiveMessage: ((message: unknown) => void) | undefined;
    let disposePanel: (() => void) | undefined;
    const disposable = { dispose(): void {} };
    const workspace = vscode.workspace as unknown as {
      onDidChangeConfiguration?: (listener: (event: unknown) => void) => vscode.Disposable;
    };
    const window = vscode.window as unknown as {
      onDidChangeTextEditorVisibleRanges?: (listener: (event: unknown) => void) => vscode.Disposable;
    };
    const originalConfigListener = workspace.onDidChangeConfiguration;
    const originalVisibleRangeListener = window.onDidChangeTextEditorVisibleRanges;
    workspace.onDidChangeConfiguration = () => disposable;
    window.onDidChangeTextEditorVisibleRanges = () => disposable;

    const webview = {
      cspSource: "test-csp",
      html: "",
      asWebviewUri: (uri: vscode.Uri) => uri,
      postMessage: async () => true,
      onDidReceiveMessage(callback: (message: unknown) => void): vscode.Disposable {
        receiveMessage = callback;
        return disposable;
      },
    };
    const panel = {
      viewColumn: 1,
      webview,
      onDidDispose(callback: () => void): vscode.Disposable {
        disposePanel = callback;
        return disposable;
      },
    } as unknown as vscode.WebviewPanel;
    const context = {
      extensionUri: vscode.Uri.file("/extension"),
    } as vscode.ExtensionContext;

    const executeCommand = vi.spyOn(vscode.commands, "executeCommand");
    const openExternal = vi.spyOn(vscode.env, "openExternal");
    try {
      await new PreviewPanelSerializer(context).deserializeWebviewPanel(panel, undefined);
      expect(receiveMessage).toBeTypeOf("function");

      receiveMessage!({ v: 1, type: "openPenmarkSettings" });
      expect(executeCommand).toHaveBeenCalledTimes(1);
      expect(executeCommand).toHaveBeenCalledWith("workbench.action.openSettings", "penmark");

      executeCommand.mockClear();
      // Nearby URI-like fields must not redirect the fixed target, and a wrong
      // protocol version must be ignored entirely.
      receiveMessage!({
        v: 1,
        type: "openPenmarkSettings",
        url: "https://evil.example",
        href: "vscode://settings/evil",
        uri: "file:///etc/passwd",
      });
      receiveMessage!({ v: 2, type: "openPenmarkSettings" });

      expect(executeCommand).toHaveBeenCalledTimes(1);
      expect(executeCommand).toHaveBeenCalledWith("workbench.action.openSettings", "penmark");
      // No URI is ever built or opened for this message — the settings hand-off
      // must not depend on a product-specific vscode:// scheme.
      expect(openExternal).not.toHaveBeenCalled();
    } finally {
      executeCommand.mockRestore();
      openExternal.mockRestore();
      disposePanel?.();
      workspace.onDidChangeConfiguration = originalConfigListener;
      window.onDidChangeTextEditorVisibleRanges = originalVisibleRangeListener;
    }
  });
});
