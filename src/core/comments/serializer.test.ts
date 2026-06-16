import { describe, it, expect } from "vitest";
import {
  buildAddCommentEdits,
  buildResolveCommentEdits,
  buildQuoteRefreshEdit,
  buildEditCommentEdits,
  type NewComment,
  type TextEdit,
} from "./serializer.js";
import { parseDoc } from "./parser.js";
import type { AnchorPlacement } from "./placement.js";

/** Splice TextEdits into `text`, applying right-to-left so earlier offsets stay valid. */
function applyEdits(text: string, edits: TextEdit[]): string {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  let out = text;
  for (const e of sorted) {
    out = out.slice(0, e.start) + e.newText + out.slice(e.end);
  }
  return out;
}

function spanPlacement(start: number, end: number): AnchorPlacement {
  return { kind: "span", range: { start, end } };
}

function newComment(over: Partial<NewComment> & { placement: AnchorPlacement }): NewComment {
  return {
    author: "carlos",
    provenance: "human",
    timestamp: "2026-06-14 09:00 +10:00",
    quote: "the quote",
    body: "the body",
    id: "aaaaaaaa",
    ...over,
  };
}

describe("buildAddCommentEdits — first comment creates the review block at EOF", () => {
  it("emits the body anchor edit(s) and a review-block creation edit at EOF", () => {
    const text = "Hello world.\n";
    const doc = parseDoc(text);
    const c = newComment({
      placement: spanPlacement(6, 11), // "world"
      id: "aaaaaaaa",
      quote: "world",
      body: "comment body",
    });
    const edits = buildAddCommentEdits(text, doc, c);
    const out = applyEdits(text, edits);

    // The body anchor wraps the selected text exactly.
    expect(out).toContain("<!--pmk:s aaaaaaaa-->world<!--/pmk:s aaaaaaaa-->");
    // The review block is created at EOF with the entry inside it.
    expect(out).toContain("<!-- pmk:review v1 -->\n");
    expect(out).toContain("<!-- /pmk:review -->\n");
    expect(out.trimEnd().endsWith("<!-- /pmk:review -->")).toBe(true);

    // Round-trips through the parser.
    const reparsed = parseDoc(out);
    expect(reparsed.reviewCount).toBe(1);
    const entry = reparsed.entries.find((e) => e.id === "aaaaaaaa");
    expect(entry).toBeDefined();
    expect(entry?.author).toBe("carlos");
    expect(entry?.provenance).toBe("human");
    expect(entry?.timestamp).toBe("2026-06-14 09:00 +10:00");
    expect(entry?.quote).toBe("world");
    expect(entry?.body).toBe("comment body");
    const anchor = reparsed.anchors.get("aaaaaaaa");
    expect(anchor?.kind).toBe("span");
    expect(out.slice(anchor?.extentStart, anchor?.extentEnd)).toBe("world");
  });

  it("produces exactly the canonical block shape on first add", () => {
    const text = "abc";
    const doc = parseDoc(text);
    const c = newComment({
      placement: spanPlacement(0, 3),
      id: "bbbbbbbb",
      quote: "abc",
      body: "note",
    });
    const out = applyEdits(text, buildAddCommentEdits(text, doc, c));
    const expectedBlock =
      "<!-- pmk:review v1 -->\n" +
      "<!--pmk:c bbbbbbbb\n" +
      "carlos (human) · 2026-06-14 09:00 +10:00\n" +
      "> abc\n" +
      "\n" +
      "note\n" +
      "-->\n" +
      "<!-- /pmk:review -->\n";
    expect(out).toContain(expectedBlock);
  });
});

describe("buildAddCommentEdits — appending to an existing review block", () => {
  it("appends an entry inside the existing block, preserving prior entries (append-only, §5.2)", () => {
    const base = "Hello world.\n";
    const first = newComment({
      placement: spanPlacement(6, 11),
      id: "aaaaaaaa",
      quote: "world",
      body: "first",
    });
    const afterFirst = applyEdits(base, buildAddCommentEdits(base, parseDoc(base), first));

    const doc2 = parseDoc(afterFirst);
    const second = newComment({
      placement: spanPlacement(0, 5), // "Hello"
      id: "cccccccc",
      quote: "Hello",
      body: "second",
    });
    const out = applyEdits(afterFirst, buildAddCommentEdits(afterFirst, doc2, second));

    const reparsed = parseDoc(out);
    expect(reparsed.reviewCount).toBe(1);
    expect(reparsed.entries.map((e) => e.id)).toEqual(["aaaaaaaa", "cccccccc"]);
    // Both anchors present.
    expect(reparsed.anchors.get("aaaaaaaa")).toBeDefined();
    expect(reparsed.anchors.get("cccccccc")).toBeDefined();
    // The new entry is appended after the existing one (append-only).
    const idxFirst = out.indexOf("pmk:c aaaaaaaa");
    const idxSecond = out.indexOf("pmk:c cccccccc");
    expect(idxFirst).toBeLessThan(idxSecond);
  });
});

describe("buildAddCommentEdits — encoding (§6)", () => {
  it("encodes -- in quote and body via escape.ts", () => {
    const text = "x--y\n";
    const doc = parseDoc(text);
    const c = newComment({
      placement: spanPlacement(0, 4),
      id: "dddddddd",
      quote: "a--b",
      body: "uses --production flag",
    });
    const out = applyEdits(text, buildAddCommentEdits(text, doc, c));

    // The emitted entry must not contain a bare -- inside its text.
    const entryStart = out.indexOf("<!--pmk:c dddddddd");
    const entryInner = out.slice(entryStart, out.indexOf("-->", entryStart));
    expect(entryInner).toContain("&#45;&#45;");
    expect(entryInner).not.toContain("a--b");

    // Decodes back exactly through the parser.
    const reparsed = parseDoc(out);
    const entry = reparsed.entries.find((e) => e.id === "dddddddd");
    expect(entry?.quote).toBe("a--b");
    expect(entry?.body).toBe("uses --production flag");
  });
});

describe("buildAddCommentEdits — placements", () => {
  it("span: inserts opener at range.start and closer at range.end (offsets adjusted)", () => {
    const text = "one two three\n";
    const doc = parseDoc(text);
    const c = newComment({
      placement: spanPlacement(4, 7), // "two"
      id: "eeeeeeee",
      quote: "two",
      body: "b",
    });
    const out = applyEdits(text, buildAddCommentEdits(text, doc, c));
    expect(out).toContain("one <!--pmk:s eeeeeeee-->two<!--/pmk:s eeeeeeee--> three");
  });

  it("block: inserts <!--pmk:b ID-->\\n on the line before the block", () => {
    const text = "para one\n\n| a | b |\n| - | - |\n";
    const doc = parseDoc(text);
    const blockLineStart = text.indexOf("| a");
    const c = newComment({
      placement: { kind: "block", blockLineStart },
      id: "ffffffff",
      quote: "| a | b |",
      body: "table note",
    });
    const out = applyEdits(text, buildAddCommentEdits(text, doc, c));
    expect(out).toContain("<!--pmk:b ffffffff-->\n| a | b |");
    const reparsed = parseDoc(out);
    const anchor = reparsed.anchors.get("ffffffff");
    expect(anchor?.kind).toBe("block");
    expect(anchor?.blockMarkerLineOwnLine).toBe(true);
  });

  it("range: inserts the o/c markers on their own lines around the run", () => {
    const text = "Intro.\n\nFirst block.\n\nLast block.\n\nOutro.\n";
    const doc = parseDoc(text);
    const firstBlockLineStart = text.indexOf("First block.");
    const lastBlockEnd = text.indexOf("Last block.") + "Last block.\n".length;
    const c = newComment({
      placement: { kind: "range", firstBlockLineStart, lastBlockEnd },
      id: "gggggggg",
      quote: "First block.",
      body: "range note",
    });
    const out = applyEdits(text, buildAddCommentEdits(text, doc, c));
    expect(out).toContain("<!--pmk:r gggggggg o-->\nFirst block.");
    expect(out).toContain("Last block.\n<!--pmk:r gggggggg c-->");
    const reparsed = parseDoc(out);
    const anchor = reparsed.anchors.get("gggggggg");
    expect(anchor?.kind).toBe("range");
  });
});

describe("buildResolveCommentEdits", () => {
  it("strips both span markers and the entry; removing the last comment removes the block", () => {
    const text = "Hello world.\n";
    const c = newComment({
      placement: spanPlacement(6, 11),
      id: "aaaaaaaa",
      quote: "world",
      body: "note",
    });
    const withComment = applyEdits(text, buildAddCommentEdits(text, parseDoc(text), c));

    const doc = parseDoc(withComment);
    const edits = buildResolveCommentEdits(withComment, doc, "aaaaaaaa");
    const out = applyEdits(withComment, edits);

    expect(out).toBe("Hello world.\n");
    expect(out).not.toContain("pmk:");
    const reparsed = parseDoc(out);
    expect(reparsed.review).toBeNull();
    expect(reparsed.entries).toHaveLength(0);
  });

  it("mid-list removal keeps the block and the other entries intact and ordered", () => {
    const base = "alpha beta gamma\n";
    let text = base;
    const ids = ["aaaaaaaa", "bbbbbbbb", "cccccccc"];
    const words = ["alpha", "beta", "gamma"];
    // Recompute the word offset against the CURRENT text each iteration, since
    // each add inserts markers that shift later offsets.
    for (let i = 0; i < ids.length; i++) {
      const word = words[i]!;
      const s = text.indexOf(word);
      const e = s + word.length;
      const c = newComment({
        placement: spanPlacement(s, e),
        id: ids[i]!,
        quote: word,
        body: `body-${i}`,
      });
      text = applyEdits(text, buildAddCommentEdits(text, parseDoc(text), c));
    }

    // Remove the middle comment.
    const doc = parseDoc(text);
    const out = applyEdits(text, buildResolveCommentEdits(text, doc, "bbbbbbbb"));
    const reparsed = parseDoc(out);

    expect(reparsed.reviewCount).toBe(1);
    expect(reparsed.entries.map((e) => e.id)).toEqual(["aaaaaaaa", "cccccccc"]);
    expect(reparsed.anchors.has("bbbbbbbb")).toBe(false);
    expect(reparsed.anchors.has("aaaaaaaa")).toBe(true);
    expect(reparsed.anchors.has("cccccccc")).toBe(true);
    // The beta text remains but is no longer wrapped by a span pair.
    expect(out).toContain(" beta ");
    expect(out).not.toContain("pmk:s bbbbbbbb");
  });

  it("strips block marker and entry on resolve", () => {
    const text = "intro\n\n| a | b |\n| - | - |\n";
    const blockLineStart = text.indexOf("| a");
    const c = newComment({
      placement: { kind: "block", blockLineStart },
      id: "ffffffff",
      quote: "| a | b |",
      body: "note",
    });
    const withComment = applyEdits(text, buildAddCommentEdits(text, parseDoc(text), c));
    const out = applyEdits(
      withComment,
      buildResolveCommentEdits(withComment, parseDoc(withComment), "ffffffff"),
    );
    expect(out).toBe(text);
    expect(parseDoc(out).anchors.has("ffffffff")).toBe(false);
  });

  it("strips both range markers and entry on resolve", () => {
    const text = "Intro.\n\nFirst block.\n\nLast block.\n\nOutro.\n";
    const firstBlockLineStart = text.indexOf("First block.");
    const lastBlockEnd = text.indexOf("Last block.") + "Last block.\n".length;
    const c = newComment({
      placement: { kind: "range", firstBlockLineStart, lastBlockEnd },
      id: "gggggggg",
      quote: "First block.",
      body: "note",
    });
    const withComment = applyEdits(text, buildAddCommentEdits(text, parseDoc(text), c));
    const out = applyEdits(
      withComment,
      buildResolveCommentEdits(withComment, parseDoc(withComment), "gggggggg"),
    );
    expect(out).toBe(text);
    expect(parseDoc(out).anchors.has("gggggggg")).toBe(false);
  });

  it("returns no edits for an unknown id", () => {
    const text = "plain text\n";
    const doc = parseDoc(text);
    expect(buildResolveCommentEdits(text, doc, "zzzzzzzz")).toEqual([]);
  });
});

describe("buildQuoteRefreshEdit (§7.6 tooling-only)", () => {
  it("rewrites just the quote lines of an entry, encoding the new quote", () => {
    const text = "Hello world.\n";
    const c = newComment({
      placement: spanPlacement(6, 11),
      id: "aaaaaaaa",
      quote: "world",
      body: "note",
    });
    const withComment = applyEdits(text, buildAddCommentEdits(text, parseDoc(text), c));

    const edit = buildQuoteRefreshEdit(
      withComment,
      parseDoc(withComment),
      "aaaaaaaa",
      "new -- quote",
    );
    expect(edit).not.toBeNull();
    const out = applyEdits(withComment, [edit!]);

    const reparsed = parseDoc(out);
    const entry = reparsed.entries.find((e) => e.id === "aaaaaaaa");
    expect(entry?.quote).toBe("new -- quote");
    expect(entry?.body).toBe("note");
    // Other content untouched.
    expect(reparsed.reviewCount).toBe(1);
    expect(reparsed.entries).toHaveLength(1);
  });

  it("returns null for an unknown id", () => {
    const text = "Hello world.\n";
    const c = newComment({
      placement: spanPlacement(6, 11),
      id: "aaaaaaaa",
      quote: "world",
      body: "note",
    });
    const withComment = applyEdits(text, buildAddCommentEdits(text, parseDoc(text), c));
    expect(buildQuoteRefreshEdit(withComment, parseDoc(withComment), "zzzzzzzz", "x")).toBeNull();
  });

  it("handles a multi-line quote", () => {
    const text = "Hello world.\n";
    const c = newComment({
      placement: spanPlacement(6, 11),
      id: "aaaaaaaa",
      quote: "world",
      body: "note",
    });
    const withComment = applyEdits(text, buildAddCommentEdits(text, parseDoc(text), c));
    const edit = buildQuoteRefreshEdit(
      withComment,
      parseDoc(withComment),
      "aaaaaaaa",
      "line one\nline two",
    );
    const out = applyEdits(withComment, [edit!]);
    const entry = parseDoc(out).entries.find((e) => e.id === "aaaaaaaa");
    expect(entry?.quote).toBe("line one\nline two");
  });

  it("refreshes an entry that has no quote lines (empty original quote)", () => {
    const text = "Hello world.\n";
    const c = newComment({
      placement: spanPlacement(6, 11),
      id: "aaaaaaaa",
      quote: "",
      body: "note",
    });
    const withComment = applyEdits(text, buildAddCommentEdits(text, parseDoc(text), c));
    expect(parseDoc(withComment).entries[0]?.quote).toBe("");
    const edit = buildQuoteRefreshEdit(
      withComment,
      parseDoc(withComment),
      "aaaaaaaa",
      "now has a quote",
    );
    const out = applyEdits(withComment, [edit!]);
    const entry = parseDoc(out).entries.find((e) => e.id === "aaaaaaaa");
    expect(entry?.quote).toBe("now has a quote");
    expect(entry?.body).toBe("note");
  });
});

describe("writer invariants (§7)", () => {
  it("an empty quote emits no `> ` lines and still round-trips", () => {
    const text = "Hello world.\n";
    const doc = parseDoc(text);
    const c = newComment({
      placement: spanPlacement(6, 11),
      id: "aaaaaaaa",
      quote: "",
      body: "body only",
    });
    const out = applyEdits(text, buildAddCommentEdits(text, doc, c));
    const entry = parseDoc(out).entries.find((e) => e.id === "aaaaaaaa");
    expect(entry?.quote).toBe("");
    expect(entry?.body).toBe("body only");
  });
});

describe("buildEditCommentEdits", () => {
  it("edits the comment body and preserves metadata and quote", () => {
    const text = "Hello world.\n";
    const c = newComment({
      placement: spanPlacement(6, 11),
      id: "aaaaaaaa",
      quote: "world",
      body: "original note",
    });
    const withComment = applyEdits(text, buildAddCommentEdits(text, parseDoc(text), c));
    
    const edits = buildEditCommentEdits(withComment, parseDoc(withComment), "aaaaaaaa", "updated note");
    expect(edits).not.toBeNull();
    const out = applyEdits(withComment, edits!);
    
    const entry = parseDoc(out).entries.find((e) => e.id === "aaaaaaaa");
    expect(entry?.body).toBe("updated note");
    expect(entry?.quote).toBe("world");
    expect(entry?.author).toBe(c.author);
  });

  it("returns null if the comment id is not found", () => {
    const text = "Hello world.\n";
    const edits = buildEditCommentEdits(text, parseDoc(text), "zzzzzzzz", "note");
    expect(edits).toBeNull();
  });
});
