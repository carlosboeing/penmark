/**
 * `decodeDisplayText` reimplements markdown-it's `isValidEntityCode` rather than
 * importing it, because importing `markdown-it/lib/common/utils.mjs` drags in
 * `entities` and `mdurl` and triples the eager extension bundle (53 KB -> 136 KB).
 *
 * A copy is only safe while something pins it to the original. markdown-it is a
 * devDependency-free direct dependency and this test file never ships, so the
 * import here costs nothing at runtime.
 */

import { describe, it, expect } from "vitest";
import { isValidEntityCode } from "markdown-it/lib/common/utils.mjs";
import { decodeDisplayText } from "./escape.js";

/** `&#38;` is a deliberate divergence: rendering it can build a new reference. */
const AMPERSAND = 38;

describe("decodeDisplayText matches markdown-it's validity rule", () => {
  it("agrees on every code point in the Unicode range", () => {
    const disagreements: number[] = [];
    for (let cp = 0; cp <= 0x10ffff; cp++) {
      const rendered = decodeDisplayText(`&#${cp};`) !== `&#${cp};`;
      const expected = isValidEntityCode(cp) && cp !== AMPERSAND;
      if (rendered !== expected) disagreements.push(cp);
    }
    expect(disagreements).toEqual([]);
  });

  it("agrees on the boundaries of each rejected range", () => {
    for (const cp of [
      0x00, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x1f, 0x20, 0x7e, 0x7f, 0x9f, 0xa0, 0xd7ff,
      0xd800, 0xdfff, 0xe000, 0xfdcf, 0xfdd0, 0xfdef, 0xfdf0, 0xfffd, 0xfffe, 0xffff, 0x10000,
      0x10fffe, 0x10ffff,
    ]) {
      const rendered = decodeDisplayText(`&#${cp};`) !== `&#${cp};`;
      expect([cp, rendered]).toEqual([cp, isValidEntityCode(cp) && cp !== AMPERSAND]);
    }
  });

  it("caps the digit run where markdown-it's DIGITAL_RE caps it", () => {
    // DIGITAL_RE is /^&#((?:x[a-f0-9]{1,6}|[0-9]{1,7}));/i — seven digits.
    expect(decodeDisplayText("&#0000045;")).toBe("-"); // 7 digits, rendered
    expect(decodeDisplayText("&#00000045;")).toBe("&#00000045;"); // 8 digits, literal
  });
});
