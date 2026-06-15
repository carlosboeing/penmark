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

  it("leaves a lone &#45; untouched", () => {
    expect(decodeEntryText("&#45;")).toBe("&#45;");
    expect(decodeEntryText("a &#45; b")).toBe("a &#45; b");
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
    for (let n = 0; n < 2000; n++) {
      let s = "";
      const len = Math.floor(Math.random() * 24);
      for (let i = 0; i < len; i++) {
        s += alphabet[Math.floor(Math.random() * alphabet.length)];
      }
      if (s.includes("&#45;&#45;")) continue;
      expect(decodeEntryText(encodeEntryText(s))).toBe(s);
    }
  });
});
