import { describe, it, expect } from "vitest";
import { buildBlockMap, planAnchor } from "./placement.js";
import type { BlockMap, SourceRange } from "./placement.js";

/**
 * Locate the char offset of the start of a substring in a doc. Test helper:
 * keeps the snap-matrix assertions readable (`offsetOf(doc, "linkify")`) instead
 * of hand-counting char positions.
 */
function offsetOf(text: string, needle: string, from = 0): number {
  const i = text.indexOf(needle, from);
  if (i === -1) throw new Error(`needle not found: ${JSON.stringify(needle)}`);
  return i;
}

function rangeOf(text: string, needle: string, from = 0): SourceRange {
  const start = offsetOf(text, needle, from);
  return { start, end: start + needle.length };
}

/** Build a BlockMap by handing buildBlockMap the markdown-it-style line offsets. */
function mapFrom(
  text: string,
  offsets: ReadonlyArray<{ line0: number; line1: number; type: string }>,
): BlockMap {
  return buildBlockMap(text, offsets);
}

describe("buildBlockMap", () => {
  it("translates line ranges into char offsets, end-exclusive on the line", () => {
    const text = "para one\n\npara two\n";
    const map = mapFrom(text, [
      { line0: 0, line1: 1, type: "paragraph" },
      { line0: 2, line1: 3, type: "paragraph" },
    ]);
    expect(map.blocks).toHaveLength(2);
    const b0 = map.blocks[0]!;
    const b1 = map.blocks[1]!;
    expect(text.slice(b0.startOffset, b0.endOffset)).toBe("para one\n");
    expect(text.slice(b1.startOffset, b1.endOffset)).toBe("para two\n");
    expect(b0.line0).toBe(0);
    expect(b0.line1).toBe(1);
    expect(b0.type).toBe("paragraph");
  });

  it('maps an unknown markdown-it type to "other"', () => {
    const text = "x\n";
    const map = mapFrom(text, [{ line0: 0, line1: 1, type: "definition" }]);
    expect(map.blocks[0]!.type).toBe("other");
  });

  it("recognizes every known block type", () => {
    const text = "x\n";
    for (const t of [
      "paragraph",
      "table",
      "fence",
      "image",
      "heading",
      "list",
      "blockquote",
      "html",
    ]) {
      const map = mapFrom(text, [{ line0: 0, line1: 1, type: t }]);
      expect(map.blocks[0]!.type).toBe(t);
    }
  });

  it("clamps a line1 past EOF to the document length", () => {
    const text = "no trailing newline";
    const map = mapFrom(text, [{ line0: 0, line1: 5, type: "paragraph" }]);
    expect(map.blocks[0]!.endOffset).toBe(text.length);
  });
});

describe("planAnchor — span (inside a single block, inline-safe)", () => {
  it("plain-prose word selection → span with the exact range", () => {
    const text = "The renderer pipeline uses markdown-it under the hood.\n";
    const map = mapFrom(text, [{ line0: 0, line1: 1, type: "paragraph" }]);
    const sel = rangeOf(text, "renderer pipeline");
    const r = planAnchor(text, sel, map);
    expect(r).toEqual({ kind: "span", range: sel });
  });
});

describe("planAnchor — span inline-safety snapping (§4.1)", () => {
  it("selection straddling the OPENING backtick of inline code → trims out the partial code span", () => {
    const text = "We rely on `linkify` for autolinks.\n";
    const map = mapFrom(text, [{ line0: 0, line1: 1, type: "paragraph" }]);
    const start = offsetOf(text, "`linkify`");
    const end = offsetOf(text, "kify`") + "li".length; // mid inline-code: "...link|ify`"
    const r = planAnchor(text, { start, end }, map);
    const codeStart = offsetOf(text, "`linkify`");
    const codeEnd = codeStart + "`linkify`".length;
    const insideCode = (p: number): boolean => p > codeStart && p < codeEnd;
    if ("kind" in r && r.kind === "span") {
      expect(insideCode(r.range.start)).toBe(false);
      expect(insideCode(r.range.end)).toBe(false);
    } else {
      expect(r).toEqual({ kind: "block", blockLineStart: 0 });
    }
  });

  it("selection landing INSIDE an inline-code span on both ends → snaps outward or block-falls-back", () => {
    const text = "Use `data-pmk-offset` to anchor.\n";
    const map = mapFrom(text, [{ line0: 0, line1: 1, type: "paragraph" }]);
    const sel = rangeOf(text, "pmk-offset");
    const r = planAnchor(text, sel, map);
    const codeStart = offsetOf(text, "`data-pmk-offset`");
    const codeEnd = codeStart + "`data-pmk-offset`".length;
    if ("kind" in r && r.kind === "span") {
      const insideCode = (p: number): boolean => p > codeStart && p < codeEnd;
      expect(insideCode(r.range.start)).toBe(false);
      expect(insideCode(r.range.end)).toBe(false);
    } else {
      expect(r).toEqual({ kind: "block", blockLineStart: 0 });
    }
  });

  it("selection splitting an emphasis run → allows selecting inside without snapping to delimiters, expanding to word boundaries", () => {
    const text = "This is *very important* text here.\n";
    const map = mapFrom(text, [{ line0: 0, line1: 1, type: "paragraph" }]);
    const sel = rangeOf(text, "very impo");
    const r = planAnchor(text, sel, map);
    expect(r).toEqual({ kind: "span", range: rangeOf(text, "very important") });
  });

  it("selection splitting a link [text](url) → does not land inside the link delimiters", () => {
    const text = "See the [DOMPurify docs](https://example.com/x) for the API.\n";
    const map = mapFrom(text, [{ line0: 0, line1: 1, type: "paragraph" }]);
    const sel = rangeOf(text, "DOMPurify docs](https");
    const r = planAnchor(text, sel, map);
    const linkStart = offsetOf(text, "[DOMPurify docs](https://example.com/x)");
    const linkEnd = linkStart + "[DOMPurify docs](https://example.com/x)".length;
    if ("kind" in r && r.kind === "span") {
      const insideLink = (p: number): boolean => p > linkStart && p < linkEnd;
      expect(insideLink(r.range.start)).toBe(false);
      expect(insideLink(r.range.end)).toBe(false);
    } else {
      expect(r).toEqual({ kind: "block", blockLineStart: 0 });
    }
  });

  it("a safe selection adjacent to inline code is kept as a span", () => {
    const text = "We rely on `linkify` for autolinks here.\n";
    const map = mapFrom(text, [{ line0: 0, line1: 1, type: "paragraph" }]);
    const sel = rangeOf(text, "for autolinks");
    const r = planAnchor(text, sel, map);
    expect(r).toEqual({ kind: "span", range: sel });
  });

  it("clamps a selection that starts before the block to the block content", () => {
    // selection start sits in the blank line before the paragraph; it overlaps
    // the paragraph and must be clamped to the block's bounds (clamp lower edge).
    const text = "intro.\n\nThe quick brown fox jumps.\n";
    const map = mapFrom(text, [
      { line0: 0, line1: 1, type: "paragraph" },
      { line0: 2, line1: 3, type: "paragraph" },
    ]);
    const blankNewline = offsetOf(text, "\n\n") + 1; // the blank line's char
    const para = map.blocks[1]!;
    const wordEnd = offsetOf(text, "brown") + "brown".length;
    const r = planAnchor(text, { start: blankNewline, end: wordEnd }, map);
    expect(r).toEqual({ kind: "span", range: { start: para.startOffset, end: wordEnd } });
  });

  it("clamps selection start to after heading prefix", () => {
    const text = "## The short version\n";
    const map = mapFrom(text, [{ line0: 0, line1: 1, type: "heading" }]);
    const r = planAnchor(text, { start: 0, end: 3 }, map, "The"); // selection "The" (rendered 0:3)
    expect(r).toEqual({ kind: "span", range: rangeOf(text, "The") });
  });

  it("falls back to block anchor when selection only covers heading prefix", () => {
    const text = "## The short version\n";
    const map = mapFrom(text, [{ line0: 0, line1: 1, type: "heading" }]);
    const r = planAnchor(text, { start: 0, end: 0 }, map); // selection inside prefix (caret at start)
    expect(r).toEqual({ kind: "block", blockLineStart: 0 });
  });

  it("clamps selection start to after list marker prefix", () => {
    const text = "- first point\n";
    const map = mapFrom(text, [{ line0: 0, line1: 1, type: "list" }]);
    const r = planAnchor(text, { start: 0, end: 5 }, map, "first"); // selection "first" (rendered 0:5)
    expect(r).toEqual({ kind: "span", range: rangeOf(text, "first") });
  });

  it("clamps selection start to after blockquote prefix", () => {
    const text = "> quoted text\n";
    const map = mapFrom(text, [{ line0: 0, line1: 1, type: "blockquote" }]);
    const r = planAnchor(text, { start: 0, end: 6 }, map, "quoted"); // selection "quoted" (rendered 0:6)
    expect(r).toEqual({ kind: "span", range: rangeOf(text, "quoted") });
  });

  it("falls back to block when no safe inline boundary exists (whole content is one code span)", () => {
    const text = "`only-code-here`\n";
    const map = mapFrom(text, [{ line0: 0, line1: 1, type: "paragraph" }]);
    const sel = rangeOf(text, "only-code");
    const r = planAnchor(text, sel, map);
    expect(r).toEqual({ kind: "block", blockLineStart: 0 });
  });

  it("allows selecting a single word inside a strong formatting block without snapping to whole block", () => {
    const text = "This is **very important** text.\n";
    const map = mapFrom(text, [{ line0: 0, line1: 1, type: "paragraph" }]);
    const sel = rangeOf(text, "important");
    const r = planAnchor(text, sel, map);
    expect(r).toEqual({ kind: "span", range: sel });
  });

  it("allows selecting a single word inside emphasis without snapping to whole block", () => {
    const text = "This is *very important* text.\n";
    const map = mapFrom(text, [{ line0: 0, line1: 1, type: "paragraph" }]);
    const sel = rangeOf(text, "very");
    const r = planAnchor(text, sel, map);
    expect(r).toEqual({ kind: "span", range: sel });
  });

  it("snaps to whole formatting block if selection crosses boundaries (inside/outside)", () => {
    const text = "This is **very important** text.\n";
    const map = mapFrom(text, [{ line0: 0, line1: 1, type: "paragraph" }]);
    // "important** text" starts inside strong block and ends in plain text
    const sel = rangeOf(text, "important** text");
    const r = planAnchor(text, sel, map);
    expect(r).toEqual({ kind: "span", range: rangeOf(text, "**very important** text") });
  });

  it("allows selecting a word inside link text without wrapping whole link", () => {
    const text = "Click [here to download](http://example.com) now.\n";
    const map = mapFrom(text, [{ line0: 0, line1: 1, type: "paragraph" }]);
    const sel = rangeOf(text, "download");
    const r = planAnchor(text, sel, map);
    expect(r).toEqual({ kind: "span", range: sel });
  });

  it("snaps to whole link if selection crosses link text and URL destination", () => {
    const text = "Click [here to download](http://example.com) now.\n";
    const map = mapFrom(text, [{ line0: 0, line1: 1, type: "paragraph" }]);
    // "download](http://example" crosses link text and URL
    const sel = rangeOf(text, "download](http://example");
    const r = planAnchor(text, sel, map);
    expect(r).toEqual({
      kind: "span",
      range: rangeOf(text, "[here to download](http://example.com)"),
    });
  });

  it("aligns approximate selection coordinates using the quote inside a strong block", () => {
    const text = "This is **very important** text.\n";
    // Rendered text is "This is very important text.\n"
    // "important" starts at index 13 in rendered text.
    // So webview sends start: 13, end: 22.
    // The source has "**", so actual start in source is 15.
    const map = mapFrom(text, [{ line0: 0, line1: 1, type: "paragraph" }]);
    const r = planAnchor(text, { start: 13, end: 22 }, map, "important");
    expect(r).toEqual({ kind: "span", range: rangeOf(text, "important") });
  });

  it("aligns approximate selection coordinates using the quote inside a heading block", () => {
    const text = "## The short version\n";
    // Rendered text is "The short version\n"
    // "short" starts at index 4 in rendered text.
    // So webview sends start: 4, end: 9.
    // The source has "## ", so actual start in source is 7.
    const map = mapFrom(text, [{ line0: 0, line1: 1, type: "heading" }]);
    const r = planAnchor(text, { start: 4, end: 9 }, map, "short");
    expect(r).toEqual({ kind: "span", range: rangeOf(text, "short") });
  });

  it("reproduces Bug 2: selecting AI in 'no decision is made by AI'", () => {
    const text =
      "We're preparing the founding-structure decision the way an investor would later examine it: **evidence first, opinions second, every rule applied equally to both sides, and every step documented so it can be checked or challenged.** Research shows founding teams that _deliberate_ their equity split do measurably better than teams that settle it with a quick handshake — so we're doing the deliberate version, properly. AI tools help us do the heavy analysis consistently and at speed, but **no decision is made by AI**: the process produces evidence and options; the founders decide.\n";
    const map = mapFrom(text, [{ line0: 0, line1: 1, type: "paragraph" }]);
    const renderedText =
      "We're preparing the founding-structure decision the way an investor would later examine it: evidence first, opinions second, every rule applied equally to both sides, and every step documented so it can be checked or challenged. Research shows founding teams that deliberate their equity split do measurably better than teams that settle it with a quick handshake — so we're doing the deliberate version, properly. AI tools help us do the heavy analysis consistently and at speed, but no decision is made by AI: the process produces evidence and options; the founders decide.";
    const renderedIdx = renderedText.lastIndexOf("AI");
    const r = planAnchor(text, { start: renderedIdx, end: renderedIdx + 2 }, map, "AI");
    expect(r).toEqual({
      kind: "span",
      range: { start: text.lastIndexOf("AI"), end: text.lastIndexOf("AI") + 2 },
    });
  });

  it("reproduces Bug: selecting 'I' in '**In one line:**' does not swallow delimiters and expands to whole word", () => {
    const text = "**In one line:**\n";
    const map = mapFrom(text, [{ line0: 0, line1: 1, type: "paragraph" }]);
    // Rendered text is "In one line:"
    // "I" starts at index 0 in rendered text.
    const r = planAnchor(text, { start: 0, end: 1 }, map, "I");
    expect(r).toEqual({
      kind: "span",
      range: { start: 2, end: 4 }, // Index 2:4 in source is "In"
    });
  });

  it("automatically expands partial word selections to the full word boundaries", () => {
    const text = "Overflow signed an agreement.\n";
    const map = mapFrom(text, [{ line0: 0, line1: 1, type: "paragraph" }]);
    // Selecting "ver" (rendered index 2:5)
    const r = planAnchor(text, { start: 2, end: 5 }, map, "ver");
    expect(r).toEqual({
      kind: "span",
      range: { start: 0, end: 8 }, // Full word "Overflow"
    });
  });
});

describe("planAnchor — block (§4.2)", () => {
  it("selection inside a fenced code block → block anchor on the fence", () => {
    const text = "intro\n\n```ts\nconst x = 1;\n```\n";
    const map = mapFrom(text, [
      { line0: 0, line1: 1, type: "paragraph" },
      { line0: 2, line1: 5, type: "fence" },
    ]);
    const sel = rangeOf(text, "const x = 1;");
    const r = planAnchor(text, sel, map);
    const fenceStart = offsetOf(text, "```ts");
    expect(r).toEqual({ kind: "block", blockLineStart: fenceStart });
  });

  it("selection of a whole table → block", () => {
    const text = "before\n\n| a | b |\n|---|---|\n| 1 | 2 |\n";
    const map = mapFrom(text, [
      { line0: 0, line1: 1, type: "paragraph" },
      { line0: 2, line1: 5, type: "table" },
    ]);
    const tableStart = offsetOf(text, "| a | b |");
    const sel: SourceRange = {
      start: tableStart,
      end: offsetOf(text, "| 1 | 2 |") + "| 1 | 2 |".length,
    };
    const r = planAnchor(text, sel, map);
    expect(r).toEqual({ kind: "block", blockLineStart: tableStart });
  });

  it("selection inside table internals (one cell) → span", () => {
    const text = "before\n\n| a | b |\n|---|---|\n| 1 | 2 |\n";
    const map = mapFrom(text, [
      { line0: 0, line1: 1, type: "paragraph" },
      { line0: 2, line1: 5, type: "table" },
    ]);
    const sel = rangeOf(text, "1"); // a cell value
    const r = planAnchor(text, sel, map, "1");
    expect(r).toEqual({ kind: "span", range: sel });
  });

  it("selection inside table crossing cell separator → block", () => {
    const text = "before\n\n| a | b |\n|---|---|\n| 1 | 2 |\n";
    const map = mapFrom(text, [
      { line0: 0, line1: 1, type: "paragraph" },
      { line0: 2, line1: 5, type: "table" },
    ]);
    const tableStart = offsetOf(text, "| a | b |");
    const sel = rangeOf(text, "1 | 2"); // spans cell separator |
    const r = planAnchor(text, sel, map, "1 | 2");
    expect(r).toEqual({ kind: "block", blockLineStart: tableStart });
  });

  it("selection inside table crossing row boundary → block", () => {
    const text = "before\n\n| a | b |\n|---|---|\n| 1 | 2 |\n";
    const map = mapFrom(text, [
      { line0: 0, line1: 1, type: "paragraph" },
      { line0: 2, line1: 5, type: "table" },
    ]);
    const tableStart = offsetOf(text, "| a | b |");
    const sel = rangeOf(text, "b |\n|---|---|\n| 1"); // spans row boundary \n
    const r = planAnchor(text, sel, map, "b | | 1");
    expect(r).toEqual({ kind: "block", blockLineStart: tableStart });
  });

  it("selection of cell content matching end of clean table text snaps correctly", () => {
    const text = "| a |\n|---|\n| 1 |\n";
    const map = mapFrom(text, [{ line0: 0, line1: 3, type: "table" }]);
    const sel = rangeOf(text, "1");
    const r = planAnchor(text, sel, map, "1");
    expect(r).toEqual({ kind: "span", range: sel });
  });

  it("aligns selection coordinates to the correct cell when a word occurs in multiple cells", () => {
    const text = "| col 1 |\n| --- |\n| person |\n| person |\n";
    const map = mapFrom(text, [{ line0: 0, line1: 4, type: "table" }]);
    // Rendered text is "col 1 person person".
    // Selecting the second "person", which starts at rendered index 11 (after "col 1" (5) + "person" (6))
    const r = planAnchor(text, { start: 11, end: 17 }, map, "person");
    expect(r).toEqual({
      kind: "span",
      range: rangeOf(text, "person", text.lastIndexOf("person")),
    });
  });

  it("selection that exactly equals one paragraph block → block", () => {
    const text = "alpha beta gamma\n";
    const map = mapFrom(text, [{ line0: 0, line1: 1, type: "paragraph" }]);
    const b0 = map.blocks[0]!;
    const sel: SourceRange = { start: b0.startOffset, end: b0.endOffset };
    const r = planAnchor(text, sel, map);
    expect(r).toEqual({ kind: "block", blockLineStart: b0.startOffset });
  });

  it("whole-content selection of an indented block (leading whitespace) → block", () => {
    // The block's char range starts with indentation; coversWholeBlock must trim
    // leading whitespace before deciding the selection covers the whole block.
    const text = "   indented paragraph content\n";
    const map = mapFrom(text, [{ line0: 0, line1: 1, type: "paragraph" }]);
    const sel = rangeOf(text, "indented paragraph content");
    const r = planAnchor(text, sel, map);
    expect(r).toEqual({ kind: "block", blockLineStart: 0 });
  });

  it("selection covering a whole paragraph minus its trailing newline → block", () => {
    const text = "alpha beta gamma\n";
    const map = mapFrom(text, [{ line0: 0, line1: 1, type: "paragraph" }]);
    const sel = rangeOf(text, "alpha beta gamma");
    const r = planAnchor(text, sel, map);
    expect(r).toEqual({ kind: "block", blockLineStart: map.blocks[0]!.startOffset });
  });
});

describe("planAnchor — range (§4.3, ≥2 contiguous blocks)", () => {
  it("selection across two paragraphs → range from first block start to last block end", () => {
    const text = "first para here.\n\nsecond para here.\n";
    const map = mapFrom(text, [
      { line0: 0, line1: 1, type: "paragraph" },
      { line0: 2, line1: 3, type: "paragraph" },
    ]);
    const start = offsetOf(text, "para here.");
    const end = offsetOf(text, "second para here.") + "second para here.".length;
    const r = planAnchor(text, { start, end }, map);
    const b0 = map.blocks[0]!;
    const b1 = map.blocks[1]!;
    expect(r).toEqual({
      kind: "range",
      firstBlockLineStart: b0.startOffset,
      lastBlockEnd: b1.endOffset,
    });
  });

  it("selection spanning three contiguous blocks → range covers first..last", () => {
    const text = "p one.\n\np two.\n\np three.\n";
    const map = mapFrom(text, [
      { line0: 0, line1: 1, type: "paragraph" },
      { line0: 2, line1: 3, type: "paragraph" },
      { line0: 4, line1: 5, type: "paragraph" },
    ]);
    const sel: SourceRange = {
      start: offsetOf(text, "p one."),
      end: offsetOf(text, "p three.") + "p three.".length,
    };
    const r = planAnchor(text, sel, map);
    expect(r).toEqual({
      kind: "range",
      firstBlockLineStart: map.blocks[0]!.startOffset,
      lastBlockEnd: map.blocks[2]!.endOffset,
    });
  });
});

describe("planAnchor — uncommentable (reject paths)", () => {
  it("selection inside YAML frontmatter → uncommentable", () => {
    const text = "---\ntitle: Hello\nstatus: draft\n---\n\nBody paragraph.\n";
    const map = mapFrom(text, [{ line0: 5, line1: 6, type: "paragraph" }]);
    const sel = rangeOf(text, "title: Hello");
    const r = planAnchor(text, sel, map);
    expect(r).toEqual({ uncommentable: true });
  });

  it("selection inside a link-reference definition → uncommentable", () => {
    const text = 'See [the docs][d].\n\n[d]: https://example.com/docs "Title"\n';
    const map = mapFrom(text, [{ line0: 0, line1: 1, type: "paragraph" }]);
    const sel = rangeOf(text, "https://example.com/docs");
    const r = planAnchor(text, sel, map);
    expect(r).toEqual({ uncommentable: true });
  });

  it("opening --- with no closing fence is NOT treated as frontmatter", () => {
    // A lone leading `---` (e.g. a thematic break / unterminated fence) must not
    // swallow the rest of the document as uncommentable frontmatter.
    const text = "---\njust a heading rule then prose.\n";
    const map = mapFrom(text, [{ line0: 1, line1: 2, type: "paragraph" }]);
    const sel = rangeOf(text, "prose");
    const r = planAnchor(text, sel, map);
    expect(r).toEqual({ kind: "span", range: sel });
  });

  it("selection that falls in no block (a blank gap) → uncommentable", () => {
    const text = "para.\n\n\nother.\n";
    const map = mapFrom(text, [
      { line0: 0, line1: 1, type: "paragraph" },
      { line0: 3, line1: 4, type: "paragraph" },
    ]);
    const gapStart = offsetOf(text, "\n\n\n") + 2;
    const r = planAnchor(text, { start: gapStart, end: gapStart }, map);
    expect(r).toEqual({ uncommentable: true });
  });
});

describe("planAnchor — property: spans are always inline-safe", () => {
  function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const bodies = [
    "We rely on `linkify` for autolinks and *emphasis* and a [link](https://x.test/y) here.",
    "The `data-pmk-offset` attribute and **bold run** plus [docs](http://d.test) end the line.",
    "Plain prose with no inline structure at all, just words and more words to select from.",
    "Mix of _underscore emphasis_ and `code one` and `code two` and a final [a](b) tail piece.",
  ];

  /** Spans inside which a marker boundary is unsafe: inline code and link URL parts. */
  function unsafeIntervals(line: string): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    const push = (re: RegExp): void => {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(line)) !== null) {
        out.push([m.index, m.index + m[0].length]);
        if (m[0].length === 0) re.lastIndex++;
      }
    };
    push(/`[^`]+`/g);
    const linkRe = /\[([^\]]*)\]\(([^)]*)\)/g;
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(line)) !== null) {
      const linkText = m[1] ?? "";
      out.push([m.index + 1 + linkText.length, m.index + m[0].length]);
    }
    return out;
  }

  it("never returns a span whose boundaries fall strictly inside an inline-unsafe run", () => {
    for (const body of bodies) {
      const text = body + "\n";
      const map = mapFrom(text, [{ line0: 0, line1: 1, type: "paragraph" }]);
      const unsafe = unsafeIntervals(body);
      const insideAny = (p: number): boolean => unsafe.some(([s, e]) => p > s && p < e);

      const rng = mulberry32(0xc0ffee ^ body.length);
      for (let trial = 0; trial < 300; trial++) {
        const a = Math.floor(rng() * (body.length + 1));
        const b = Math.floor(rng() * (body.length + 1));
        const sel: SourceRange = { start: Math.min(a, b), end: Math.max(a, b) };
        const r = planAnchor(text, sel, map);
        if ("kind" in r && r.kind === "span") {
          expect(insideAny(r.range.start)).toBe(false);
          expect(insideAny(r.range.end)).toBe(false);
          expect(r.range.start).toBeGreaterThanOrEqual(map.blocks[0]!.startOffset);
          expect(r.range.end).toBeLessThanOrEqual(map.blocks[0]!.endOffset);
        }
      }
    }
  });
});
