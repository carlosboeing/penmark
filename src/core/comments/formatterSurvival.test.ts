/**
 * Formatter-survival tests (§5.2.2, §7.2).
 *
 * The other round-trip suites are closed-loop: they serialize, then re-parse the
 * exact bytes the serializer produced. Real documents do not stay exact. They
 * are saved through Prettier, markdownlint, or an editor's
 * `files.trimTrailingWhitespace`, and whatever those tools rewrite is what the
 * parser must still be able to read.
 *
 * Two rewrites are the ones that bite, both observed in the wild:
 *   - trailing whitespace is stripped, so a quote line rendered as `"> "` for an
 *     empty quote line becomes a bare `">"`;
 *   - a review block appended straight after a list is a lazy continuation of the
 *     last list item, so the formatter indents it to the list content column.
 *
 * Either one used to make `parseEntry` reject the entry, which silently dropped
 * the comment from the preview and the drawer.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import * as prettier from "prettier";
import { parseDoc } from "./parser.js";
import { buildAddCommentEdits, type NewComment, type TextEdit } from "./serializer.js";

const CONFORMANCE = resolve(__dirname, "../../../spec/conformance");

/** Same corpus the other round-trip suites use: everything but the corruption fixtures. */
const FIXTURES = readdirSync(CONFORMANCE)
  .filter((f) => f.endsWith(".md"))
  .filter((f) => !f.startsWith("12-") && !f.startsWith("14-"))
  .sort();

function applyEdits(text: string, edits: TextEdit[]): string {
  let out = text;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, e.start) + e.newText + out.slice(e.end);
  }
  return out;
}

/** Editor `files.trimTrailingWhitespace` / Prettier / markdownlint MD009. */
function trimTrailingWhitespace(text: string): string {
  return text
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/, ""))
    .join("\n");
}

/**
 * A quote with a blank line in it — the case that produces an empty quote line,
 * and the case no existing fixture or test exercises.
 */
const QUOTE_WITH_BLANK_LINE = "first quoted para\n\nsecond quoted para";
const BODY = "reviewer body prose";

function addComment(text: string, id: string): string {
  const doc = parseDoc(text);
  // Any legal in-body offset works; placement legality is placement.ts's concern.
  const start = text.indexOf("\n\n") + 2;
  const c: NewComment = {
    id,
    author: "tester",
    provenance: "human",
    timestamp: "2026-07-26 20:39 +10:00",
    quote: QUOTE_WITH_BLANK_LINE,
    body: BODY,
    placement: { kind: "span", range: { start, end: start + 4 } },
  };
  return applyEdits(text, buildAddCommentEdits(text, doc, c));
}

describe("serialized entries survive a formatter pass", () => {
  for (const file of FIXTURES) {
    it(`${file}: entry survives trailing-whitespace trimming`, () => {
      const written = addComment(readFileSync(resolve(CONFORMANCE, file), "utf8"), "z3z3z3z3");
      expect(parseDoc(written).entries.map((e) => e.id)).toContain("z3z3z3z3");

      const trimmed = trimTrailingWhitespace(written);
      const entry = parseDoc(trimmed).entries.find((e) => e.id === "z3z3z3z3");
      expect(entry, "entry survives the trim").toBeDefined();
      expect(entry?.quote).toBe(QUOTE_WITH_BLANK_LINE);
      expect(entry?.body).toBe(BODY);
    });

    it(`${file}: entry survives Prettier`, async () => {
      const written = addComment(readFileSync(resolve(CONFORMANCE, file), "utf8"), "z3z3z3z3");
      const formatted = await prettier.format(written, { parser: "markdown" });

      const entry = parseDoc(formatted).entries.find((e) => e.id === "z3z3z3z3");
      expect(entry, "entry survives Prettier").toBeDefined();
      expect(entry?.quote).toBe(QUOTE_WITH_BLANK_LINE);
      expect(entry?.body).toBe(BODY);
    });
  }

  it("a document ending in a list does not absorb the review block", async () => {
    const base = "Intro paragraph.\n\n- first item\n- last item\n";
    const written = addComment(base, "z3z3z3z3");
    const formatted = await prettier.format(written, { parser: "markdown" });

    // The block header must stay at column 0 — indented, it is list content.
    expect(formatted).toMatch(/^<!-- pmk:review v1 -->$/m);
    expect(parseDoc(formatted).entries.map((e) => e.id)).toEqual(["z3z3z3z3"]);
  });
});

describe("writer emits bytes a formatter will not rewrite", () => {
  // Parser tolerance (below) means a `"> "` line still READS fine. This suite is
  // about the write side: emitting bytes Prettier immediately rewrites produces a
  // spurious diff on every save, so the writer must land on the stable form.
  for (const file of FIXTURES) {
    it(`${file}: emitted entry has no trailing whitespace`, () => {
      const written = addComment(readFileSync(resolve(CONFORMANCE, file), "utf8"), "z3z3z3z3");
      const review = parseDoc(written).review;
      expect(review).not.toBeNull();
      const offending = written
        .slice(review!.start, review!.end)
        .split("\n")
        .filter((l) => /[ \t]+$/.test(l));
      expect(offending, "review block lines ending in whitespace").toEqual([]);
    });
  }

  it("emits an empty quote line as a bare `>`", () => {
    const written = addComment("Body text here.\n\nMore body.\n", "z3z3z3z3");
    expect(written).toContain("> first quoted para\n>\n> second quoted para\n");
  });

  it("separates the review block from a trailing list with a blank line", () => {
    const written = addComment("Intro.\n\n- first item\n- last item\n", "z3z3z3z3");
    // Without the separator the block is a lazy continuation of the last list
    // item, which invites a reflowing tool to indent it into the list.
    expect(written).toContain("- last item\n\n<!-- pmk:review v1 -->");
  });

  it("does not add a second blank line when one is already there", () => {
    const written = addComment("Intro.\n\n- first item\n\n", "z3z3z3z3");
    expect(written).not.toContain("\n\n\n<!-- pmk:review v1 -->");
  });
});

describe("parser tolerates already-mangled documents", () => {
  const mangled = (quoteLines: string, indent: string): string =>
    "Body text here.\n\n" +
    `${indent}<!-- pmk:review v1 -->\n` +
    `${indent}<!--pmk:c z3z3z3z3\n` +
    `${indent}tester (human) · 2026-07-26 20:39 +10:00\n` +
    quoteLines +
    "\n" +
    `${indent}${BODY}\n` +
    `${indent}-->\n` +
    `${indent}<!-- /pmk:review -->\n`;

  it("reads a bare `>` as an empty quote line", () => {
    const text = mangled("> first quoted para\n>\n> second quoted para\n", "");
    const entry = parseDoc(text).entries.find((e) => e.id === "z3z3z3z3");
    expect(entry?.quote).toBe(QUOTE_WITH_BLANK_LINE);
    expect(entry?.body).toBe(BODY);
  });

  it("reads an entry indented by a list-continuation reflow", () => {
    const text = mangled("  > first quoted para\n  >\n  > second quoted para\n", "  ");
    const entry = parseDoc(text).entries.find((e) => e.id === "z3z3z3z3");
    expect(entry, "indented entry still parses").toBeDefined();
    expect(entry?.quote).toBe(QUOTE_WITH_BLANK_LINE);
    expect(entry?.body).toBe(BODY);
    expect(entry?.author).toBe("tester");
  });

  it("does not report corruption for either mangled form", () => {
    expect(parseDoc(mangled("> a\n>\n> b\n", "")).corruption).toEqual([]);
    expect(parseDoc(mangled("  > a\n  >\n  > b\n", "  ")).corruption).toEqual([]);
  });
});
