import { describe, it, expect, beforeEach } from "vitest";
import * as vscode from "vscode";
import {
  handleAddComment,
  handleResolveComment,
  handleEditComment,
  handleExportReview,
  handleUpdateSetting,
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
  window: { _infos: string[]; _quickPickChoice: string | undefined; _resetMessages: () => void };
  env: { clipboard: { _text: string } };
};

/** A fake TextDocument exposing only what the host handlers touch. */
function fakeDoc(text: string, fsPath = "/tmp/doc.md"): vscode.TextDocument {
  return {
    uri: vscode.Uri.file(fsPath),
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
  seam.env.clipboard._text = "";
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

    expect(seam.workspace._configUpdates.map((u) => [u.key, u.value])).toEqual([
      ["preset", "reading"],
      ["textSize", "large"],
      ["contentWidth", "comfortable"],
      ["comments.highlightIntensity", "strong"],
      ["lineHeight", 1.65],
    ]);
  });

  it("rejects invalid preview settings without writing config", async () => {
    await handleUpdateSetting("preset", "neon");
    await handleUpdateSetting("lineHeight", 9);
    await handleUpdateSetting("theme", "solarized");

    expect(seam.workspace._configUpdates).toHaveLength(0);
  });
});
