import { describe, it, expect } from "vitest";
import { encodeEntryText, decodeEntryText, decodeDisplayText } from "./escape.js";

describe("encodeEntryText (spec §6)", () => {
  it("encodes every bare -- as &#45;&#45;", () => {
    expect(encodeEntryText("--production")).toBe("&#45;&#45;production");
    expect(encodeEntryText("a--b--c")).toBe("a&#45;&#45;b&#45;&#45;c");
  });

  it("escapes the comment terminator so no bare -- survives", () => {
    expect(encodeEntryText("-->")).toBe("&#45;&#45;>");
    expect(encodeEntryText("end of comment -->")).not.toContain("--");
  });

  it("leaves text without -- untouched", () => {
    expect(encodeEntryText("plain prose")).toBe("plain prose");
    expect(encodeEntryText("a-b-c")).toBe("a-b-c"); // single hyphens are legal
    expect(encodeEntryText("")).toBe("");
  });

  it("guarantees no bare -- in the output for any input", () => {
    for (const s of ["--", "---", "----", "-----", "a--", "--a", "x-->y", "----->"]) {
      expect(encodeEntryText(s)).not.toContain("--");
    }
  });
});

describe("decodeEntryText (spec §6)", () => {
  it("decodes &#45;&#45; back to --", () => {
    expect(decodeEntryText("&#45;&#45;production")).toBe("--production");
    expect(decodeEntryText("a&#45;&#45;b&#45;&#45;c")).toBe("a--b--c");
  });

  it("leaves a lone &#45; untouched", () => {
    expect(decodeEntryText("&#45;")).toBe("&#45;");
    expect(decodeEntryText("a &#45; b")).toBe("a &#45; b");
  });

  it("leaves every other decimal character reference untouched", () => {
    // The codec is not a general entity decoder: display decoding is a separate
    // pass so that reconcile (§8.2) keeps matching quotes against raw bytes.
    expect(decodeEntryText("use &#8212; here")).toBe("use &#8212; here");
    expect(decodeEntryText("&#38;#45;")).toBe("&#38;#45;");
  });
});

describe("decodeDisplayText (spec §6 display decoding)", () => {
  it("renders agent-authored decimal character references as punctuation", () => {
    expect(decodeDisplayText("Layer&#45;1&#45;first")).toBe("Layer-1-first");
    expect(decodeDisplayText("a &#45; b")).toBe("a - b");
    expect(decodeDisplayText("use &#8212; here")).toBe("use \u2014 here");
  });

  it("still renders the paired storage sentinel", () => {
    expect(decodeDisplayText("&#45;&#45;production")).toBe("--production");
  });

  it("leaves out-of-range references literal", () => {
    expect(decodeDisplayText("&#1114112;")).toBe("&#1114112;");
  });

  it("leaves surrogates literal so no ill-formed text can be produced", () => {
    // String.fromCodePoint(0xD800) yields a lone surrogate, which a UTF-8 write
    // turns into U+FFFD. markdown-it's validity rule rejects the whole range.
    for (const cp of [0xd800, 0xdbff, 0xdc00, 0xdfff]) {
      const reference = `&#${cp};`;
      expect(decodeDisplayText(reference)).toBe(reference);
    }
  });

  it("leaves NUL and C0/C1 control references literal", () => {
    for (const cp of [0, 1, 8, 11, 31, 127, 128, 159]) {
      const reference = `&#${cp};`;
      expect(decodeDisplayText(reference)).toBe(reference);
    }
  });

  it("leaves noncharacter references literal", () => {
    expect(decodeDisplayText("&#65534;")).toBe("&#65534;");
    expect(decodeDisplayText("&#65535;")).toBe("&#65535;");
  });

  it("never emits an unpaired surrogate for any decimal reference", () => {
    // Sweep the whole range: a lone surrogate here would become U+FFFD the
    // moment anything wrote it out as UTF-8.
    for (let cp = 0; cp <= 0x10ffff; cp += 997) {
      const out = decodeDisplayText(`&#${cp};`);
      for (let i = 0; i < out.length; i++) {
        const unit = out.charCodeAt(i);
        if (unit >= 0xd800 && unit <= 0xdbff) {
          const next = out.charCodeAt(i + 1);
          expect(next >= 0xdc00 && next <= 0xdfff).toBe(true);
          i++;
        } else {
          expect(unit >= 0xdc00 && unit <= 0xdfff).toBe(false);
        }
      }
    }
  });

  it("leaves &#38; literal so a display pass cannot build a new reference", () => {
    // Rendering &#38; would put a fresh `&` beside what follows, so this input
    // would become the literal storage sentinel &#45;&#45; and read back as --.
    expect(decodeDisplayText("&#38;#45;&#38;#45;")).toBe("&#38;#45;&#38;#45;");
    expect(decodeDisplayText("&#38;")).toBe("&#38;");
  });

  it("leaves an over-long digit run literal, as the preview does", () => {
    expect(decodeDisplayText("&#00000045;")).toBe("&#00000045;");
  });

  it("leaves hex and named references literal (decimal-only by design)", () => {
    expect(decodeDisplayText("&#x2d;")).toBe("&#x2d;");
    expect(decodeDisplayText("&amp;")).toBe("&amp;");
  });
});

describe("round-trip decode(encode(s)) === s (spec §6)", () => {
  const cases = [
    "--production",
    "a--b--c",
    "-->",
    "end of comment -->",
    "plain prose",
    "a-b-c",
    "",
    "uses &#45; as an entity reference", // pre-existing single &#45;
    "uses &#8212; as an entity reference",
    "double-encoded &#38;#45; stays put",
    "---",
    "-----",
    "----->",
    "line one\nline two with --flag",
    "emoji 🚀 and -- dash",
  ];
  for (const s of cases) {
    it(`round-trips ${JSON.stringify(s)}`, () => {
      expect(decodeEntryText(encodeEntryText(s))).toBe(s);
    });
  }

  it("round-trips realistic fuzzed strings (no literal &#45;&#45; sentinel)", () => {
    // The escape sentinel is &#45;&#45;; the round-trip property holds for any
    // string that does not already contain that literal sequence (spec §6).
    const alphabet = "ab-> \n&#;45";
    let asserted = 0;
    for (let n = 0; n < 2000; n++) {
      let s = "";
      const len = Math.floor(Math.random() * 24);
      for (let i = 0; i < len; i++) {
        s += alphabet[Math.floor(Math.random() * alphabet.length)];
      }
      if (s.includes("&#45;&#45;")) continue;
      expect(decodeEntryText(encodeEntryText(s))).toBe(s);
      asserted++;
    }
    // A floor on coverage: a regression that skipped every sample would
    // otherwise pass this test silently.
    expect(asserted).toBeGreaterThan(1900);
  });
});
