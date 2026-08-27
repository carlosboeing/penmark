import { describe, it, expect } from "vitest";
import { encodeEntryText, decodeEntryText } from "./escape.js";

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

  it("decodes individually encoded decimal character references", () => {
    expect(decodeEntryText("Layer&#45;1&#45;first")).toBe("Layer-1-first");
    expect(decodeEntryText("a &#45; b")).toBe("a - b");
  });

  it("leaves invalid decimal character references literal", () => {
    expect(decodeEntryText("&#1114112;")).toBe("&#1114112;");
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

  it("round-trips realistic fuzzed strings without decimal character references", () => {
    // Decimal character references are decoded for agent-authored comment
    // compatibility, so the round-trip property excludes their literal form.
    const alphabet = "ab-> \n&#;45";
    for (let n = 0; n < 2000; n++) {
      let s = "";
      const len = Math.floor(Math.random() * 24);
      for (let i = 0; i < len; i++) {
        s += alphabet[Math.floor(Math.random() * alphabet.length)];
      }
      if (/&#\d+;/.test(s)) continue;
      expect(decodeEntryText(encodeEntryText(s))).toBe(s);
    }
  });
});
