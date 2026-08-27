/**
 * Display decoding is a presentation pass, not part of the codec (spec §6).
 *
 * Agent tools that hand-write review entries often encode punctuation as
 * decimal character references, so a reader must render those for a human. The
 * risk is applying that pass too early: `reconcile` matches an entry's quote
 * against raw document bytes (§8.2), and `encodeEntryText` cannot restore a
 * reference it never wrote. These tests pin the seam in place.
 */

import { describe, it, expect } from "vitest";
import { parseDoc } from "./parser.js";
import { reconcile, type ReconcileResult } from "./reconcile.js";
import { buildReviewPrompt } from "./exportPrompt.js";
import { encodeEntryText, decodeEntryText, decodeDisplayText } from "./escape.js";

function run(text: string): ReconcileResult {
  return reconcile(text, parseDoc(text));
}

function withReview(body: string, entry: string): string {
  return `${body}\n<!-- pmk:review v1 -->\n${entry}\n<!-- /pmk:review -->\n`;
}

function entry(id: string, quote: string, bodyText = "comment body"): string {
  return `<!--pmk:c ${id}\ncarlos (human) · 2026-06-12 09:02 +10:00\n> ${quote}\n\n${bodyText}\n-->`;
}

/**
 * The quote exactly as the webview receives it. `analyzeComments` lives in
 * src/vscode and cannot be imported here, so this mirrors its one relevant
 * decision: the wire quote is the parsed quote, unrendered.
 */
function wireQuoteFor(doc: string, storedQuote: string): string {
  const text = withReview(doc, entry("aaaaaaaa", storedQuote));
  return run(text).comments[0]!.entry.quote;
}

describe("quote recovery survives a document that contains character references", () => {
  it("recovers a destroyed closer when the quoted passage holds a literal reference", () => {
    // A document about HTML escaping is exactly Penmark's audience. The quote is
    // stored verbatim (it holds no bare `--`), so the parser must hand reconcile
    // those same bytes or the §8.2 search can never match.
    const text = withReview(
      "Lead <!--pmk:s aaaaaaaa-->in. Write &#8212; for an em dash, always.",
      entry("aaaaaaaa", "Write &#8212; for an em dash"),
    );
    const c = run(text).comments.find((x) => x.entry.id === "aaaaaaaa");
    expect(c?.state).toBe("degraded-recovered");
    expect(text.slice(c!.extent!.start, c!.extent!.end)).toBe("Write &#8212; for an em dash");
  });

  it("keeps the parsed quote byte-faithful to the document", () => {
    const text = withReview(
      "Use <!--pmk:s bbbbbbbb-->&#45; here<!--/pmk:s bbbbbbbb--> for a hyphen.",
      entry("bbbbbbbb", "&#45; here"),
    );
    const c = run(text).comments.find((x) => x.entry.id === "bbbbbbbb");
    expect(c?.entry.quote).toBe("&#45; here");
    expect(decodeDisplayText(c!.entry.quote)).toBe("- here");
  });
});

describe("re-anchor keeps a comment recoverable", () => {
  it("the quote a re-anchor stores still matches the document", () => {
    // Re-anchor re-adds the SAME quote at a new location, so a rendered quote
    // would be stored and could never match the source again: the next anchor
    // loss would orphan a comment that would otherwise recover.
    const doc = "Lead <!--pmk:s aaaaaaaa-->in. Write &#8212;force here.";
    const stored = "Write &#8212;force here";
    const reAnchored = wireQuoteFor(doc, stored);
    expect(doc.includes(reAnchored)).toBe(true);

    const again = withReview(doc, entry("aaaaaaaa", reAnchored));
    expect(run(again).comments[0]?.state).toBe("degraded-recovered");
  });
});

describe("export-as-prompt quotes the file, renders the note", () => {
  it("emits the quote verbatim so an agent can find it, and decodes the body", () => {
    // A single reference, not the `&#45;&#45;` storage sentinel: the sentinel is
    // the codec's own output and is decoded by the codec, as it always was.
    const text = withReview(
      "Prose with <!--pmk:s cccccccc-->&#8212;force<!--/pmk:s cccccccc--> in it.",
      entry("cccccccc", "&#8212;force", "Rename this to &#8212;overwrite instead."),
    );
    const prompt = buildReviewPrompt("docs/design.md", run(text).comments);
    // The quote is a locator: an agent greps the file for it, so it stays as the
    // document spells it.
    expect(prompt).toContain("> &#8212;force");
    expect(text).toContain("&#8212;force");
    // The body is prose for the agent to read, so the reference is rendered.
    expect(prompt).toContain("Rename this to \u2014overwrite instead.");
  });
});

describe("the codec stays a strict inverse", () => {
  it("round-trips text holding references that display decoding would render", () => {
    for (const s of ["a &#45; b", "use &#8212; here", "&#38;#45;", "&#0;", "&#55296;"]) {
      expect(decodeEntryText(encodeEntryText(s))).toBe(s);
    }
  });

  it("does not decay a reference across repeated store-and-read cycles", () => {
    // The failure this guards: decode-all at parse time strips one level per
    // pass, so text the user never edited changes on every save.
    let s = "&#38;#45;";
    for (let i = 0; i < 5; i++) s = decodeEntryText(encodeEntryText(s));
    expect(s).toBe("&#38;#45;");
  });
});
