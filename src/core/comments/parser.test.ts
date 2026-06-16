import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { parseDoc } from "./parser.js";

const CONFORMANCE = resolve(__dirname, "../../../spec/conformance");
const fixture = (name: string): string => readFileSync(resolve(CONFORMANCE, name), "utf8");

describe("parseDoc — span extents", () => {
  it("records opener/closer offsets and the between-markers extent", () => {
    const text = "x <!--pmk:s aaaaaaaa-->hi<!--/pmk:s aaaaaaaa--> y";
    const doc = parseDoc(text);
    const a = doc.anchors.get("aaaaaaaa");
    expect(a).toBeDefined();
    expect(a?.kind).toBe("span");
    expect(text.slice(a?.extentStart, a?.extentEnd)).toBe("hi");
    expect(text.slice(a?.openerStart, a?.openerEnd)).toBe("<!--pmk:s aaaaaaaa-->");
    expect(text.slice(a?.closerStart, a?.closerEnd)).toBe("<!--/pmk:s aaaaaaaa-->");
  });

  it("classifies an empty span pair with extentStart === extentEnd (13/§8.3)", () => {
    const doc = parseDoc(fixture("13-empty-span.md"));
    const empties = [...doc.anchors.values()].filter((a) => a.kind === "span");
    expect(empties).toHaveLength(2);
    for (const a of empties) {
      expect(a.extentStart).toBe(a.extentEnd);
      expect(a.closerStart).toBe(a.openerEnd);
    }
  });

  it("treats a lone span opener as a live anchor with no closer (14/§8.2)", () => {
    const doc = parseDoc(fixture("14-degraded-states.md"));
    const spans = [...doc.anchors.values()].filter((a) => a.kind === "span");
    expect(spans).toHaveLength(2);
    for (const a of spans) {
      expect(a.closerStart).toBeUndefined();
      expect(a.extentStart).toBeUndefined();
    }
    expect(doc.corruption).toHaveLength(0); // lone opener is NOT corruption
  });

  it("matches openers to closers in document order across two same-id-less pairs", () => {
    const text =
      "<!--pmk:s aaaaaaaa-->one<!--/pmk:s aaaaaaaa--> <!--pmk:s bbbbbbbb-->two<!--/pmk:s bbbbbbbb-->";
    const doc = parseDoc(text);
    expect(
      text.slice(doc.anchors.get("aaaaaaaa")?.extentStart, doc.anchors.get("aaaaaaaa")?.extentEnd),
    ).toBe("one");
    expect(
      text.slice(doc.anchors.get("bbbbbbbb")?.extentStart, doc.anchors.get("bbbbbbbb")?.extentEnd),
    ).toBe("two");
  });
});

describe("parseDoc — block anchors (§4.2)", () => {
  it("records own-line block anchors with blockMarkerLineOwnLine true", () => {
    const doc = parseDoc(fixture("03-block-anchors.md"));
    const blocks = [...doc.anchors.values()].filter((a) => a.kind === "block");
    expect(blocks).toHaveLength(4);
    for (const b of blocks) {
      expect(b.blockMarkerLineOwnLine).toBe(true);
      expect(b.closerStart).toBeUndefined();
    }
  });

  it("treats a leading-whitespace-only line as own-line", () => {
    const doc = parseDoc("   <!--pmk:b aaaaaaaa-->\nblock\n");
    expect(doc.anchors.get("aaaaaaaa")?.kind).toBe("block");
    expect(doc.corruption).toHaveLength(0);
  });

  it("classifies a block marker sharing a line as corruption (§4.2)", () => {
    const doc = parseDoc("text before <!--pmk:b aaaaaaaa--> more text\n");
    expect(doc.anchors.size).toBe(0);
    expect(doc.corruption.map((c) => c.rule)).toEqual(["§4.2-block-not-own-line"]);
  });
});

describe("parseDoc — range pairs (§4.3)", () => {
  it("records a range pair with extent spanning the wrapped run (04)", () => {
    const doc = parseDoc(fixture("04-range-pair.md"));
    const ranges = [...doc.anchors.values()].filter((a) => a.kind === "range");
    expect(ranges).toHaveLength(1);
    const r = ranges[0];
    expect(r?.closerStart).toBeGreaterThan(r?.openerEnd ?? 0);
    expect(r?.extentStart).toBe(r?.openerEnd);
    expect(r?.extentEnd).toBe(r?.closerStart);
  });

  it("flags a range opener with no closer as half-pair (§8.4)", () => {
    const doc = parseDoc("<!--pmk:r aaaaaaaa o-->\nblock\n");
    expect(doc.anchors.size).toBe(0);
    expect(doc.corruption.map((c) => c.rule)).toEqual(["§8.4-range-half-pair"]);
  });

  it("flags a range closer with no opener as half-pair (§8.4)", () => {
    const doc = parseDoc("block\n<!--pmk:r aaaaaaaa c-->\n");
    expect(doc.anchors.size).toBe(0);
    expect(doc.corruption.map((c) => c.rule)).toEqual(["§8.4-range-half-pair"]);
  });
});

describe("parseDoc — entries (§5.2)", () => {
  it("decodes a multi-line advisory quote joined with newlines (06)", () => {
    const doc = parseDoc(fixture("06-hard-wrapped.md"));
    const e = doc.entries.find((x) => x.id === "h5j6k2lz");
    expect(e?.quote).toBe("read-only\ndefault is the whole point");
  });

  it("parses author, provenance, and timestamp from the meta line", () => {
    const doc = parseDoc(fixture("01-plain-prose-spans.md"));
    const e = doc.entries[0];
    expect(e?.author).toBe("carlos");
    expect(e?.provenance).toBe("human");
    expect(e?.timestamp).toBe("2026-06-12 09:02 +10:00");
  });

  it("parses an agent entry", () => {
    const doc = parseDoc(fixture("01-plain-prose-spans.md"));
    const e = doc.entries.find((x) => x.id === "r6t2v4hq");
    expect(e?.provenance).toBe("agent");
    expect(e?.author).toBe("claude-code");
  });

  it("decodes &#45;&#45; back to -- in quote and body (05/§6)", () => {
    const doc = parseDoc(fixture("05-review-block-escapes.md"));
    const e = doc.entries.find((x) => x.id === "m6n3b2vc");
    expect(e?.body).toContain("--production");
    expect(e?.body).toContain("--watch");
    const e2 = doc.entries.find((x) => x.id === "q4w7e2rt");
    expect(e2?.body).toContain("budget delta -- current size");
  });

  it("preserves entry append order and rawStart/rawEnd offsets", () => {
    const doc = parseDoc(fixture("01-plain-prose-spans.md"));
    expect(doc.entries.map((e) => e.id)).toEqual(["k7m2q5ax", "w3n6d5pz", "r6t2v4hq"]);
    for (const e of doc.entries) {
      expect(e.rawEnd).toBeGreaterThan(e.rawStart);
    }
  });

  it("parses a timestamp with seconds", () => {
    const text =
      "<!-- pmk:review v1 -->\n<!--pmk:c aaaaaaaa\nbob (human) · 2026-06-12 09:02:33 +10:00\n> q\n\nbody\n-->\n<!-- /pmk:review -->\n";
    const doc = parseDoc(text);
    expect(doc.entries[0]?.timestamp).toBe("2026-06-12 09:02:33 +10:00");
  });

  it("parses an entry with zero quote lines", () => {
    const text =
      "<!-- pmk:review v1 -->\n<!--pmk:c aaaaaaaa\nbob (human) · 2026-06-12 09:02 +10:00\n\nbody only\n-->\n<!-- /pmk:review -->\n";
    const doc = parseDoc(text);
    expect(doc.entries[0]?.quote).toBe("");
    expect(doc.entries[0]?.body).toBe("body only");
  });

  it("parses a multi-line body", () => {
    const text =
      "<!-- pmk:review v1 -->\n<!--pmk:c aaaaaaaa\nbob (human) · 2026-06-12 09:02 +10:00\n> q\n\nline one\nline two\n-->\n<!-- /pmk:review -->\n";
    const doc = parseDoc(text);
    expect(doc.entries[0]?.body).toBe("line one\nline two");
  });

  it("parses-but-ignores a v2 ` re <parent>` reply tag (§5.3)", () => {
    const text =
      "<!-- pmk:review v1 -->\n<!--pmk:c bbbbbbbb re aaaaaaaa\nbob (human) · 2026-06-12 09:02 +10:00\n> q\n\nreply body\n-->\n<!-- /pmk:review -->\n";
    const doc = parseDoc(text);
    expect(doc.entries[0]?.id).toBe("bbbbbbbb");
    expect(doc.entries[0]?.parentId).toBe("aaaaaaaa");
  });

  it("skips a malformed entry (bad meta line) without throwing", () => {
    const text =
      "<!-- pmk:review v1 -->\n<!--pmk:c aaaaaaaa\nno provenance tag here\n> q\n\nbody\n-->\n<!-- /pmk:review -->\n";
    const doc = parseDoc(text);
    expect(doc.entries).toHaveLength(0);
  });

  it("skips an entry with a malformed line 1", () => {
    const text =
      "<!-- pmk:review v1 -->\n<!--pmk:c BADID\nbob (human) · 2026-06-12 09:02 +10:00\n> q\n\nbody\n-->\n<!-- /pmk:review -->\n";
    const doc = parseDoc(text);
    expect(doc.entries).toHaveLength(0);
  });

  it("skips an entry missing the blank separator line", () => {
    const text =
      "<!-- pmk:review v1 -->\n<!--pmk:c aaaaaaaa\nbob (human) · 2026-06-12 09:02 +10:00\n> q\nbody-with-no-blank\n-->\n<!-- /pmk:review -->\n";
    const doc = parseDoc(text);
    expect(doc.entries).toHaveLength(0);
  });
});

describe("parseDoc — review block detection (§5.1)", () => {
  it("returns review:null and zero entries when there is no review block", () => {
    const doc = parseDoc("# just prose\n\nno comments here.\n");
    expect(doc.review).toBeNull();
    expect(doc.reviewCount).toBe(0);
    expect(doc.entries).toHaveLength(0);
  });

  it("sets atEof true when only whitespace follows the closer", () => {
    const doc = parseDoc(fixture("01-plain-prose-spans.md"));
    expect(doc.review?.atEof).toBe(true);
  });

  it("sets atEof false when meaningful content follows the closer", () => {
    const text =
      "<!-- pmk:review v1 -->\n<!--pmk:c aaaaaaaa\nbob (human) · 2026-06-12 09:02 +10:00\n> q\n\nbody\n-->\n<!-- /pmk:review -->\n\ntrailing content here\n";
    const doc = parseDoc(text);
    expect(doc.review?.atEof).toBe(false);
  });

  it("sets atEof false when the closing delimiter is missing", () => {
    const text =
      "<!-- pmk:review v1 -->\n<!--pmk:c aaaaaaaa\nbob (human) · 2026-06-12 09:02 +10:00\n> q\n\nbody\n-->\n";
    const doc = parseDoc(text);
    expect(doc.review).not.toBeNull();
    expect(doc.review?.atEof).toBe(false);
  });

  it("flags a second review block as corruption and treats the EOF one as authoritative", () => {
    const text =
      "<!-- pmk:review v1 -->\n<!--pmk:c aaaaaaaa\nbob (human) · 2026-06-12 09:02 +10:00\n> q\n\nfirst\n-->\n<!-- /pmk:review -->\n\nmid\n\n<!-- pmk:review v1 -->\n<!--pmk:c bbbbbbbb\nbob (human) · 2026-06-12 09:03 +10:00\n> q\n\nsecond\n-->\n<!-- /pmk:review -->\n";
    const doc = parseDoc(text);
    expect(doc.reviewCount).toBe(2);
    expect(doc.corruption.map((c) => c.rule)).toContain("§5.1-second-review-block");
    // EOF block is authoritative -> its entry (bbbbbbbb) is the parsed one.
    expect(doc.entries.map((e) => e.id)).toEqual(["bbbbbbbb"]);
    expect(doc.review?.atEof).toBe(true);
  });
});

describe("parseDoc — corruption classification (§9)", () => {
  it("rejects an invalid-alphabet id without producing a live anchor (12)", () => {
    const doc = parseDoc("<!--pmk:s k7m2q9ax-->t<!--/pmk:s k7m2q9ax-->");
    expect(doc.anchors.size).toBe(0);
    expect(doc.corruption.every((c) => c.rule === "§3-invalid-alphabet")).toBe(true);
    expect(doc.corruption).toHaveLength(2); // opener + closer
  });

  it("rejects a wrong-length id", () => {
    const doc = parseDoc("<!--pmk:s abc2-->t<!--/pmk:s abc2-->");
    expect(doc.anchors.size).toBe(0);
    expect(doc.corruption.map((c) => c.rule)).toEqual(["§3-wrong-length", "§3-wrong-length"]);
  });

  it("flags a stray closer with no opener (§9)", () => {
    const doc = parseDoc("prose <!--/pmk:s aaaaaaaa--> more");
    expect(doc.anchors.size).toBe(0);
    expect(doc.corruption.map((c) => c.rule)).toEqual(["§9-stray-closer"]);
  });

  it("flags an unknown kind letter (§4)", () => {
    const doc = parseDoc("<!--pmk:x q4w7e2rt-->u<!--/pmk:x q4w7e2rt-->");
    expect(doc.anchors.size).toBe(0);
    expect(doc.corruption.map((c) => c.rule)).toEqual(["§4-unknown-kind", "§4-unknown-kind"]);
  });

  it("flags a malformed review header (§5.1)", () => {
    const doc = parseDoc("text <!-- pmk:review v0 --> and <!-- pmk:reviewv1 -->\n");
    expect(doc.review).toBeNull();
    expect(doc.corruption.map((c) => c.rule)).toEqual([
      "§5.1-malformed-review-header",
      "§5.1-malformed-review-header",
    ]);
  });

  it("flags generic pmk: residue (§9)", () => {
    const doc = parseDoc("<!--pmk:garbage-->\n");
    expect(doc.corruption.map((c) => c.rule)).toEqual(["§9-residue"]);
  });

  it("never throws on the negative fixture and keeps zero live anchors (12)", () => {
    expect(() => parseDoc(fixture("12-negative-malformed.md"))).not.toThrow();
    const doc = parseDoc(fixture("12-negative-malformed.md"));
    expect(doc.anchors.size).toBe(0);
  });

  it("keeps well-formed comments intact around corruption", () => {
    const text =
      "<!--pmk:s aaaaaaaa-->good<!--/pmk:s aaaaaaaa--> <!--/pmk:s bbbbbbbb-->\n" +
      "<!-- pmk:review v1 -->\n<!--pmk:c aaaaaaaa\nbob (human) · 2026-06-12 09:02 +10:00\n> good\n\nbody\n-->\n<!-- /pmk:review -->\n";
    const doc = parseDoc(text);
    expect(doc.anchors.get("aaaaaaaa")?.kind).toBe("span");
    expect(doc.entries).toHaveLength(1);
    expect(doc.corruption.map((c) => c.rule)).toEqual(["§9-stray-closer"]);
  });
});

describe("parseDoc — review robustness (R2 review fixes)", () => {
  it("parses a CRLF-authored document identically to LF (no silent entry loss)", () => {
    const lf = fixture("01-plain-prose-spans.md");
    const crlf = lf.replace(/\n/g, "\r\n");
    const docLf = parseDoc(lf);
    const docCrlf = parseDoc(crlf);
    // Entries must survive CRLF: same ids, decoded quote/body identical.
    expect(docCrlf.entries.map((e) => e.id)).toEqual(docLf.entries.map((e) => e.id));
    expect(docCrlf.entries).toHaveLength(docLf.entries.length);
    expect(docCrlf.entries.length).toBeGreaterThan(0);
    for (let i = 0; i < docLf.entries.length; i++) {
      expect(docCrlf.entries[i]?.author).toBe(docLf.entries[i]?.author);
      expect(docCrlf.entries[i]?.provenance).toBe(docLf.entries[i]?.provenance);
      expect(docCrlf.entries[i]?.timestamp).toBe(docLf.entries[i]?.timestamp);
      // Quote/body are normalized to LF joins regardless of source endings.
      expect(docCrlf.entries[i]?.quote).toBe(docLf.entries[i]?.quote);
      expect(docCrlf.entries[i]?.body).toBe(docLf.entries[i]?.body);
    }
    expect(docCrlf.corruption).toHaveLength(0);
  });

  it("CRLF: parses a seconds timestamp and multi-line body", () => {
    const text =
      "<!-- pmk:review v1 -->\r\n<!--pmk:c aaaaaaaa\r\nbob (human) · 2026-06-12 09:02:33 +10:00\r\n> q one\r\n> q two\r\n\r\nline one\r\nline two\r\n-->\r\n<!-- /pmk:review -->\r\n";
    const doc = parseDoc(text);
    expect(doc.entries).toHaveLength(1);
    expect(doc.entries[0]?.timestamp).toBe("2026-06-12 09:02:33 +10:00");
    expect(doc.entries[0]?.quote).toBe("q one\nq two");
    expect(doc.entries[0]?.body).toBe("line one\nline two");
    expect(doc.corruption).toHaveLength(0);
  });

  it("a genuinely-closed block is not hijacked by a later unclosed stray header (F2)", () => {
    const closed =
      "<!-- pmk:review v1 -->\n<!--pmk:c aaaaaaaa\nbob (human) · 2026-06-12 09:02 +10:00\n> q\n\nreal comment\n-->\n<!-- /pmk:review -->\n";
    // A later, unclosed duplicate header with trailing prose must NOT win authority.
    const text = closed + "\nstray notes\n\n<!-- pmk:review v1 -->\nleftover junk, never closed\n";
    const doc = parseDoc(text);
    // The closed block's real entry must be preserved, not lost.
    expect(doc.entries.map((e) => e.id)).toEqual(["aaaaaaaa"]);
    expect(doc.entries[0]?.body).toBe("real comment");
    expect(doc.reviewCount).toBe(2);
    // The stray later header is flagged, not the authoritative closed one.
    expect(doc.corruption.map((c) => c.rule)).toContain("§5.1-second-review-block");
  });

  it("surfaces an unclosed authoritative header as corruption while still parsing its entry (F4)", () => {
    const text =
      "<!-- pmk:review v1 -->\n<!--pmk:c aaaaaaaa\nbob (human) · 2026-06-12 09:02 +10:00\n> q\n\nbody\n-->\n";
    const doc = parseDoc(text);
    expect(doc.review).not.toBeNull();
    expect(doc.review?.atEof).toBe(false);
    expect(doc.entries.map((e) => e.id)).toEqual(["aaaaaaaa"]); // entry not lost
    expect(doc.corruption.map((c) => c.rule)).toContain("§5.1-unclosed-review-block");
  });

  it("surfaces a malformed pmk:c entry as corruption instead of dropping it silently (F3)", () => {
    const text =
      "<!-- pmk:review v1 -->\n<!--pmk:c aaaaaaaa\nthis meta line is broken\n> q\n\nbody\n-->\n<!-- /pmk:review -->\n";
    const doc = parseDoc(text);
    expect(doc.entries).toHaveLength(0);
    expect(doc.corruption.map((c) => c.rule)).toEqual(["§5.2-malformed-entry"]);
    expect(doc.corruption[0]?.index).toBeGreaterThanOrEqual(0);
  });

  it("classifies a valid-kind valid-id but wrongly-spaced marker as residue (§9 fall-through)", () => {
    // Wide `<!-- ... -->` spacing means the strict anchor matcher rejects it, but
    // the id is valid and the kind is known — it must fall through to §9-residue.
    const doc = parseDoc("text <!-- pmk:s aaaaaaaa --> more\n");
    expect(doc.anchors.size).toBe(0);
    expect(doc.corruption.map((c) => c.rule)).toEqual(["§9-residue"]);
  });

  it("reports the exact char offset of a corruption item (not just >= 0)", () => {
    const text = "prose <!--/pmk:s aaaaaaaa--> more";
    const doc = parseDoc(text);
    expect(doc.corruption).toHaveLength(1);
    expect(doc.corruption[0]?.rule).toBe("§9-stray-closer");
    expect(doc.corruption[0]?.index).toBe(text.indexOf("<!--/pmk:s aaaaaaaa-->"));
  });
});

describe("parseDoc — unicode and density", () => {
  it("handles markers adjacent to multi-byte text (09)", () => {
    const doc = parseDoc(fixture("09-unicode.md"));
    const a = doc.anchors.get("n7m4b2vc");
    expect(a).toBeDefined();
    const text = fixture("09-unicode.md");
    expect(text.slice(a?.extentStart, a?.extentEnd)).toBe(
      "markers sit directly next to multi-byte characters",
    );
  });

  it("parses 50 dense anchors and 50 entries (10)", () => {
    const doc = parseDoc(fixture("10-dense-anchors.md"));
    expect(doc.anchors.size).toBe(50);
    expect(doc.entries).toHaveLength(50);
    expect(doc.corruption).toHaveLength(0);
  });

  it("does not throw on empty input", () => {
    const doc = parseDoc("");
    expect(doc.anchors.size).toBe(0);
    expect(doc.entries).toHaveLength(0);
    expect(doc.review).toBeNull();
    expect(doc.corruption).toHaveLength(0);
  });
});
