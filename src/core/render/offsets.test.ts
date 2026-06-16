import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { createRenderer } from "./markdown.js";

const FIXTURES = resolve(__dirname, "../../../test/fixtures/render");

function fixture(name: string): string {
  return readFileSync(resolve(FIXTURES, name), "utf8");
}

describe("data-pmk-offset source positions", () => {
  it("stamps data-pmk-offset on every top-level block element", () => {
    const md = fixture("offsets-doc.md");
    const html = createRenderer({}).render(md);

    // Every top-level block must carry data-pmk-offset
    expect(html).toContain('data-pmk-offset="0:1"'); // # Introduction (line 0)
    expect(html).toContain('data-pmk-offset="2:3"'); // paragraph (line 2)
    expect(html).toContain('data-pmk-offset="4:7"'); // fenced code block (lines 4-6, end exclusive 7)
    expect(html).toContain('data-pmk-offset="8:12"'); // bullet list (lines 8-11, end exclusive 12)
    expect(html).toContain('data-pmk-offset="12:13"'); // blockquote (line 12)
    expect(html).toContain('data-pmk-offset="14:15"'); // hr (line 14)
    expect(html).toContain('data-pmk-offset="16:17"'); // final paragraph (line 16)
  });

  it("stamps data-pmk-coff with each block's source char-start (R10 base)", () => {
    // "# Title\n\nA paragraph here.\n"
    //   line 0 "# Title" starts at char 0; line 2 "A paragraph here." starts at 9.
    const html = createRenderer({}).render("# Title\n\nA paragraph here.\n");
    expect(html).toContain('data-pmk-coff="0"'); // heading block
    expect(html).toContain('data-pmk-coff="9"'); // paragraph block
  });

  it("does not stamp data-pmk-offset on inline or nested tokens", () => {
    const md = fixture("offsets-doc.md");
    const html = createRenderer({}).render(md);

    // Inline content inside blocks must not have the attribute
    // (list items, blockquote content, etc. are nested level > 0)
    const innerLiPattern = /<li[^>]*data-pmk-offset/;
    expect(html).not.toMatch(innerLiPattern);
    const innerPPattern = /<p[^>]*data-pmk-offset/g;
    // Only the two standalone paragraphs at level 0 should have it,
    // not paragraphs nested inside blockquote or list
    const matches = [...html.matchAll(innerPPattern)];
    // The two top-level paragraphs get the attribute; blockquote's inner p does not
    expect(matches.length).toBe(2);
  });

  it("offsets at level 0 are monotonic non-decreasing and non-overlapping", () => {
    const md = fixture("offsets-doc.md");
    const html = createRenderer({}).render(md);

    // Extract all data-pmk-offset values from the HTML
    const offsetPattern = /data-pmk-offset="(\d+):(\d+)"/g;
    const offsets: Array<[number, number]> = [];
    for (const match of html.matchAll(offsetPattern)) {
      const s = match[1] ?? "0";
      const e = match[2] ?? "0";
      offsets.push([parseInt(s, 10), parseInt(e, 10)]);
    }

    expect(offsets.length).toBeGreaterThan(0);

    for (let i = 0; i < offsets.length; i++) {
      const entry = offsets[i];
      if (!entry) continue;
      const [start, end] = entry;
      // Each offset must be a valid range
      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeGreaterThan(start);

      if (i > 0) {
        const prev = offsets[i - 1];
        if (prev) {
          const [prevStart] = prev;
          // Non-decreasing start lines
          expect(start).toBeGreaterThanOrEqual(prevStart);
        }
      }
    }

    // Non-overlapping: each start >= previous end
    for (let i = 1; i < offsets.length; i++) {
      const prev = offsets[i - 1];
      const curr = offsets[i];
      if (!prev || !curr) continue;
      const [, prevEnd] = prev;
      const [start] = curr;
      expect(start).toBeGreaterThanOrEqual(prevEnd);
    }
  });

  it("createRenderer offsets work on a minimal inline document", () => {
    // Verify offsets round-trip on a simple two-block document
    const html = createRenderer({}).render("# Hello\n\nWorld paragraph.\n");
    expect(html).toContain('data-pmk-offset="0:1"');
    expect(html).toContain('data-pmk-offset="2:3"');
  });
});
