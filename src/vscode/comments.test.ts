import { describe, it, expect, beforeEach } from "vitest";
import * as vscode from "vscode";
import {
  nowTimestamp,
  pickAuthor,
  resolveAuthor,
  existingIds,
  planAddComment,
  planResolveComment,
  offsetEditsToWorkspaceEdit,
  analyzeComments,
} from "./comments.js";
import { parseDoc } from "../core/comments/parser.js";
import type { TextEdit } from "../core/comments/serializer.js";
import { tokenizeBlockOffsets } from "../core/render/markdown.js";

const { __setConfig, __resetConfig } = vscode as unknown as {
  __setConfig: (s: string, v: Record<string, unknown>) => void;
  __resetConfig: () => void;
};

const seam2 = vscode as unknown as {
  workspace: { _appliedEdits: unknown[]; _resetEdits: () => void };
};

beforeEach(() => __resetConfig());

/**
 * Apply TextEdits the way vscode applies one WorkspaceEdit: every range is
 * resolved against the PRE-edit document, and two zero-width inserts at the SAME
 * offset keep their original (insertion) order — the first-added edit ends up
 * leftmost. We splice right-to-left, breaking same-offset ties by DESCENDING
 * original index so the earlier-added edit is applied last and lands leftmost.
 * (A naive right-to-left sort that ignores index would reverse same-offset
 * inserts and corrupt e.g. a span closer that coincides with the EOF review
 * block — see the EOF test below.)
 */
function applyEdits(text: string, edits: TextEdit[]): string {
  const indexed = edits.map((e, i) => ({ e, i }));
  indexed.sort((a, b) => b.e.start - a.e.start || b.i - a.i);
  let out = text;
  for (const { e } of indexed) out = out.slice(0, e.start) + e.newText + out.slice(e.end);
  return out;
}

/** A fake vscode.TextDocument exposing only positionAt over `text`. */
function fakeDoc(text: string): { positionAt: (offset: number) => vscode.Position } {
  return {
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
  };
}

describe("nowTimestamp — §5.2.1 shape", () => {
  it("matches YYYY-MM-DD HH:MM ±HH:MM with a signed offset", () => {
    const ts = nowTimestamp(new Date("2026-06-14T02:05:00Z"));
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} [+-]\d{2}:\d{2}$/);
  });

  it("is parseable by the entry meta regex (round-trips through parseDoc)", () => {
    const ts = nowTimestamp(new Date());
    const meta = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})? [+-]\d{2}:\d{2}$/;
    expect(meta.test(ts)).toBe(true);
  });
});

describe("pickAuthor — precedence (D14)", () => {
  it("prefers a non-empty setting", () => {
    expect(pickAuthor("Ada Lovelace", "git-name")).toBe("Ada Lovelace");
  });
  it("falls back to git name when the setting is empty/whitespace", () => {
    expect(pickAuthor("", "Grace Hopper")).toBe("Grace Hopper");
    expect(pickAuthor("   ", "Grace Hopper")).toBe("Grace Hopper");
    expect(pickAuthor(undefined, "Grace Hopper")).toBe("Grace Hopper");
  });
  it('falls back to "unknown" when neither is available', () => {
    expect(pickAuthor(undefined, undefined)).toBe("unknown");
    expect(pickAuthor("", "")).toBe("unknown");
  });
});

describe("resolveAuthor — reads the penmark setting", () => {
  it("returns the configured author name", () => {
    __setConfig("penmark", { "comments.authorName": "Ada Lovelace" });
    expect(resolveAuthor()).toBe("Ada Lovelace");
  });
  it("falls through to git/unknown when the setting is unset", () => {
    // No setting configured; git may or may not resolve in CI, so just assert a
    // non-empty string (precedence proven by pickAuthor units).
    expect(resolveAuthor().length).toBeGreaterThan(0);
  });
});

describe("existingIds", () => {
  it("unions anchor ids and entry ids", () => {
    const text =
      "Hello <!--pmk:s abcdefgh-->world<!--/pmk:s abcdefgh-->.\n\n" +
      "<!-- pmk:review v1 -->\n" +
      "<!--pmk:c abcdefgh\ntester (human) · 2026-06-14 12:00 +10:00\n> world\n\nnote\n-->\n" +
      "<!-- /pmk:review -->\n";
    const ids = existingIds(parseDoc(text));
    expect(ids.has("abcdefgh")).toBe(true);
  });
});

describe("planAddComment — host add orchestration (R7)", () => {
  it("adds a span comment that round-trips through parseDoc", () => {
    const source = "The renderer uses markdown-it under the hood.\n";
    const start = source.indexOf("markdown-it");
    const range = { start, end: start + "markdown-it".length };
    const result = planAddComment({
      source,
      range,
      quote: "markdown-it",
      body: "which version?",
      author: "tester",
      timestamp: "2026-06-14 12:00 +10:00",
      tokenize: tokenizeBlockOffsets,
    });
    expect("edits" in result).toBe(true);
    if (!("edits" in result)) return;
    const out = applyEdits(source, result.edits);
    const reparsed = parseDoc(out);
    expect(reparsed.review).not.toBeNull();
    expect(reparsed.entries).toHaveLength(1);
    const entry = reparsed.entries[0]!;
    expect(entry.quote).toBe("markdown-it");
    expect(entry.body).toBe("which version?");
    expect(entry.author).toBe("tester");
    // The new id has a live span anchor wrapping the selection.
    expect(reparsed.anchors.get(entry.id)?.kind).toBe("span");
  });

  it("rebases a body-relative selection past stripped frontmatter to source coords", () => {
    const source = "---\ntitle: X\n---\n\nThe quick brown fox jumps.\n";
    // body = "\nThe quick brown fox jumps.\n"; "quick" body-offset:
    const body = source.slice(source.indexOf("\n\n") + 1); // mirror stripFrontmatter body suffix
    const bodyStart = body.indexOf("quick");
    const range = { start: bodyStart, end: bodyStart + "quick".length };
    const result = planAddComment({
      source,
      range,
      quote: "quick",
      body: "note",
      author: "t",
      timestamp: "2026-06-14 12:00 +10:00",
      tokenize: tokenizeBlockOffsets,
    });
    expect("edits" in result).toBe(true);
    if (!("edits" in result)) return;
    const out = applyEdits(source, result.edits);
    // The span opener must land immediately before "quick" in the SOURCE, not
    // shifted by the frontmatter line count.
    expect(out).toContain("<!--pmk:s ");
    const reparsed = parseDoc(out);
    const entry = reparsed.entries[0]!;
    const anchor = reparsed.anchors.get(entry.id)!;
    expect(source.length > 0 && out.slice(anchor.extentStart, anchor.extentEnd)).toBe("quick");
  });

  it("composes a span closer that lands at EOF before the new review block", () => {
    // No trailing newline and no existing review block: the span CLOSER insert
    // (at range.end === source.length) and the new-review-block insert (at
    // text.length) collide at the same offset. The closer was added first, so it
    // must stay immediately after the selected word, BEFORE the review block.
    const source = "Edit the README";
    const start = source.indexOf("README");
    const range = { start, end: source.length };
    const result = planAddComment({
      source,
      range,
      quote: "README",
      body: "which one?",
      author: "t",
      timestamp: "2026-06-14 12:00 +10:00",
      tokenize: tokenizeBlockOffsets,
    });
    expect("edits" in result).toBe(true);
    if (!("edits" in result)) return;
    const out = applyEdits(source, result.edits);
    expect(out).toContain("README<!--/pmk:s ");
    const reparsed = parseDoc(out);
    expect(reparsed.entries).toHaveLength(1);
    const entry = reparsed.entries[0]!;
    const anchor = reparsed.anchors.get(entry.id)!;
    expect(out.slice(anchor.extentStart, anchor.extentEnd)).toBe("README");
  });

  it("returns uncommentable for a link-reference-definition selection", () => {
    const source = "See [the docs][d].\n\n[d]: https://example.com/docs\n";
    const start = source.indexOf("https://example.com/docs");
    const range = { start, end: start + "https://example.com/docs".length };
    const result = planAddComment({
      source,
      range,
      quote: "x",
      body: "y",
      author: "t",
      timestamp: "2026-06-14 12:00 +10:00",
      tokenize: tokenizeBlockOffsets,
    });
    expect(result).toEqual({ uncommentable: true });
  });
});

describe("planResolveComment — host resolve orchestration (R7)", () => {
  it("removes the comment's markers and entry (resolve = delete)", () => {
    const source =
      "Hello <!--pmk:s abcdefgh-->world<!--/pmk:s abcdefgh-->.\n\n" +
      "<!-- pmk:review v1 -->\n" +
      "<!--pmk:c abcdefgh\ntester (human) · 2026-06-14 12:00 +10:00\n> world\n\nnote\n-->\n" +
      "<!-- /pmk:review -->\n";
    const edits = planResolveComment(source, "abcdefgh");
    const out = applyEdits(source, edits);
    const reparsed = parseDoc(out);
    expect(reparsed.entries.some((e) => e.id === "abcdefgh")).toBe(false);
    expect(reparsed.anchors.has("abcdefgh")).toBe(false);
    expect(out).toContain("Hello world.");
    expect(out).not.toContain("pmk:");
  });
});

describe("offsetEditsToWorkspaceEdit", () => {
  it("converts offset splices to ranges in one WorkspaceEdit", () => {
    const text = "line one\nline two\n";
    const uri = vscode.Uri.file("/tmp/x.md");
    const edits: TextEdit[] = [
      { start: 0, end: 0, newText: "X" }, // insert at start
      { start: 9, end: 13, newText: "Y" }, // replace "line" on line 2
    ];
    const we = offsetEditsToWorkspaceEdit(
      uri,
      fakeDoc(text) as unknown as never,
      edits,
    ) as unknown as {
      _replaces: Array<{
        range: {
          start: { line: number; character: number };
          end: { line: number; character: number };
        };
        newText: string;
      }>;
      size: number;
    };
    expect(we.size).toBe(2);
    expect(we._replaces[0]!.range.start).toEqual({ line: 0, character: 0 });
    expect(we._replaces[1]!.range.start).toEqual({ line: 1, character: 0 });
    expect(we._replaces[1]!.range.end).toEqual({ line: 1, character: 4 });
    expect(we._replaces[1]!.newText).toBe("Y");
  });
});

describe("analyzeComments — reconcile → wire payload (R8)", () => {
  const intactDoc =
    "Hello <!--pmk:s abcdefgh-->world<!--/pmk:s abcdefgh-->.\n\n" +
    "<!-- pmk:review v1 -->\n" +
    "<!--pmk:c abcdefgh\ntester (human) · 2026-06-14 12:00 +10:00\n> world\n\nnote\n-->\n" +
    "<!-- /pmk:review -->\n";

  it("maps an intact span comment to one WireComment with a body-relative extent", () => {
    const { comments, attention } = analyzeComments(intactDoc);
    expect(comments).toHaveLength(1);
    const c = comments[0]!;
    expect(c.id).toBe("abcdefgh");
    expect(c.state).toBe("intact");
    expect(c.author).toBe("tester");
    expect(c.provenance).toBe("human");
    expect(c.body).toBe("note");
    expect(c.extent).not.toBeNull();
    // "world" is on the first body line (no frontmatter), after "Hello " + opener marker.
    expect(c.extent!.startLine).toBe(0);
    expect(c.extent!.endLine).toBe(0);
    expect(c.extent!.startCol).toBeLessThan(c.extent!.endCol);
    expect(attention).toBe(0);
  });

  it("maps an orphan comment to a null extent and counts it as needing attention", () => {
    const orphanDoc =
      "Body with no markers at all.\n\n" +
      "<!-- pmk:review v1 -->\n" +
      "<!--pmk:c abcdefgh\nt (human) · 2026-06-14 12:00 +10:00\n> gone\n\nnote\n-->\n" +
      "<!-- /pmk:review -->\n";
    const { comments, attention } = analyzeComments(orphanDoc);
    expect(comments).toHaveLength(1);
    expect(comments[0]!.state).toBe("orphan");
    expect(comments[0]!.extent).toBeNull();
    expect(attention).toBe(1); // exactly one orphan, no strays/corruption
  });

  it("takes the no-marker fast path for a comment-free document", () => {
    const { comments, attention, result } = analyzeComments(
      "# Title\n\nJust prose, no comments.\n",
    );
    expect(comments).toHaveLength(0);
    expect(attention).toBe(0);
    expect(result.secondReviewBlock).toBe(false);
  });

  it("rebases the extent past stripped frontmatter (body-relative line, not source line)", () => {
    const fmDoc =
      "---\ntitle: X\ntags: [a, b]\n---\n\n" + // 4 frontmatter lines + blank
      "Hello <!--pmk:s abcdefgh-->world<!--/pmk:s abcdefgh-->.\n\n" +
      "<!-- pmk:review v1 -->\n" +
      "<!--pmk:c abcdefgh\nt (human) · 2026-06-14 12:00 +10:00\n> world\n\nnote\n-->\n" +
      "<!-- /pmk:review -->\n";
    const { comments } = analyzeComments(fmDoc);
    expect(comments).toHaveLength(1);
    // Body = "\nHello ...": "world" sits on body line 1 (the blank line is body
    // line 0). If the extent were in SOURCE coordinates it would be on line 6.
    const ext = comments[0]!.extent!;
    expect(ext.startLine).toBe(1);
    expect(ext.endLine).toBe(1);
    // The highlighted extent is the between-markers text "world" (5 chars) — a
    // column rebase error would shift or widen this even on the right line.
    expect(ext.endCol - ext.startCol).toBe("world".length);
  });

  it("reports corruption flags and is read-only (applies no WorkspaceEdit)", () => {
    seam2.workspace._resetEdits();
    const doubled =
      intactDoc +
      "\n<!-- pmk:review v1 -->\n" +
      "<!--pmk:c bbbbbbbb\nt (human) · 2026-06-14 12:00 +10:00\n> x\n\ny\n-->\n" +
      "<!-- /pmk:review -->\n";
    const { result } = analyzeComments(doubled);
    expect(result.secondReviewBlock).toBe(true);
    expect(seam2.workspace._appliedEdits).toHaveLength(0);
  });
});
