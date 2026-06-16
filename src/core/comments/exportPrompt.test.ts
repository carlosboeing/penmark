import { describe, it, expect } from "vitest";
import { parseDoc } from "./parser.js";
import { reconcile } from "./reconcile.js";
import { buildReviewPrompt } from "./exportPrompt.js";

/** A 3-comment document: two intact spans + one orphan (entry with no anchor). */
const threeComments =
  "The renderer uses <!--pmk:s aaaaaaaa-->markdown-it<!--/pmk:s aaaaaaaa--> under the hood.\n\n" +
  "It ships a <!--pmk:s bbbbbbbb-->slim bundle<!--/pmk:s bbbbbbbb--> via esbuild.\n\n" +
  "<!-- pmk:review v1 -->\n" +
  "<!--pmk:c aaaaaaaa\nAda (human) · 2026-06-14 09:00 +10:00\n> markdown-it\n\nWhich major version?\n-->\n" +
  "<!--pmk:c bbbbbbbb\nGrace (agent) · 2026-06-14 09:05 +10:00\n> slim bundle\n\nCite the measured size.\n-->\n" +
  "<!--pmk:c cccccccc\nLin (human) · 2026-06-14 09:10 +10:00\n> deleted phrase\n\nThis section was removed — confirm intentional.\n-->\n" +
  "<!-- /pmk:review -->\n";

function promptFor(source: string, docPath = "docs/design.md"): string {
  const result = reconcile(source, parseDoc(source));
  return buildReviewPrompt(docPath, result.comments);
}

describe("buildReviewPrompt (R9)", () => {
  it("emits a header, an instruction, and one section per comment in document order", () => {
    expect(promptFor(threeComments)).toMatchInlineSnapshot(`
      "# Penmark review — docs/design.md

      You are addressing reviewer comments on the markdown file above. There are 3 open comments. For each, the blockquote shows the passage it refers to, followed by the reviewer's note. Apply the requested changes to the file.

      ## 1. Ada (human) · 2026-06-14 09:00 +10:00

      > markdown-it

      Which major version?

      ## 2. Grace (agent) · 2026-06-14 09:05 +10:00

      > slim bundle

      Cite the measured size.

      ## 3. Lin (human) · 2026-06-14 09:10 +10:00 (location lost — quote only)

      > deleted phrase

      This section was removed — confirm intentional.
      "
    `);
  });

  it("notes orphan comments (anchor lost) so the agent locates them by quote", () => {
    const prompt = promptFor(threeComments);
    expect(prompt).toContain(
      "## 3. Lin (human) · 2026-06-14 09:10 +10:00 (location lost — quote only)",
    );
  });

  it("ends in exactly one trailing newline", () => {
    const prompt = promptFor(threeComments);
    expect(prompt.endsWith("\n")).toBe(true);
    expect(prompt.endsWith("\n\n")).toBe(false);
  });

  it("handles a document with no open comments", () => {
    expect(buildReviewPrompt("a.md", [])).toBe("# Penmark review — a.md\n\nNo open comments.\n");
  });

  it("renders a multi-line quote as consecutive blockquote lines", () => {
    const doc =
      "Body.\n\n<!-- pmk:review v1 -->\n" +
      "<!--pmk:c aaaaaaaa\nA (human) · 2026-06-14 09:00 +10:00\n> first line\n> second line\n\nthe note\n-->\n" +
      "<!-- /pmk:review -->\n";
    expect(promptFor(doc)).toContain("> first line\n> second line");
  });

  it("omits the blockquote when a comment has no advisory quote", () => {
    const doc =
      "Body.\n\n<!-- pmk:review v1 -->\n" +
      "<!--pmk:c aaaaaaaa\nA (human) · 2026-06-14 09:00 +10:00\n\nthe note\n-->\n" +
      "<!-- /pmk:review -->\n";
    const prompt = promptFor(doc);
    expect(prompt).not.toContain("> ");
    expect(prompt).toContain("the note");
  });

  it("shows a placeholder for a comment with an empty body", () => {
    const doc =
      "Body.\n\n<!-- pmk:review v1 -->\n" +
      "<!--pmk:c aaaaaaaa\nA (human) · 2026-06-14 09:00 +10:00\n> q\n\n-->\n" +
      "<!-- /pmk:review -->\n";
    expect(promptFor(doc)).toContain("_(no note)_");
  });
});
