import { describe, it, expect } from "vitest";
import { resolveTypography, typographyCssVars } from "./typography.js";

const vars = (preset: string): Record<string, string> =>
  typographyCssVars(resolveTypography({ preset }));

describe("four distinct presets", () => {
  it("gives each preset a distinct body size, leading and column", () => {
    const seen = new Set<string>();
    for (const p of ["github", "reading", "compact", "focus"]) {
      const t = resolveTypography({ preset: p });
      seen.add(`${t.textSize}|${t.lineHeight}|${t.contentWidth}|${t.fontFamily}`);
    }
    expect(seen.size).toBe(4);
  });

  it("differentiates heading scale, not only body size", () => {
    // h1 relative to its own body size must differ between compact and focus.
    const ratio = (p: string): number => {
      const v = vars(p);
      return parseFloat(v["--pmk-h1-size"]!) / parseFloat(v["--pmk-text-size-base"]!);
    };
    expect(ratio("compact")).toBeLessThan(ratio("github"));
    expect(ratio("focus")).toBeGreaterThan(ratio("github"));
  });

  it("uses a serif body for Reading only", () => {
    expect(resolveTypography({ preset: "reading" }).fontFamily).toContain("Georgia");
    for (const p of ["github", "compact", "focus"]) {
      expect(resolveTypography({ preset: p }).fontFamily).not.toContain("Georgia");
    }
  });

  it("never renders h4 or h5 smaller than body text", () => {
    for (const p of ["github", "reading", "compact", "focus"]) {
      const v = vars(p);
      const base = parseFloat(v["--pmk-text-size-base"]!);
      expect(parseFloat(v["--pmk-h4-size"]!)).toBeGreaterThanOrEqual(base);
      expect(parseFloat(v["--pmk-h5-size"]!)).toBeGreaterThanOrEqual(base);
    }
  });

  it("degrades a retired preset name to the github baseline", () => {
    expect(resolveTypography({ preset: "print" })).toEqual(
      expect.objectContaining({ textSize: "medium", lineHeight: 1.5, contentWidth: "full" }),
    );
  });

  it("keeps h1 above h2 above h3 in every preset", () => {
    for (const p of ["github", "reading", "compact", "focus"]) {
      const v = vars(p);
      const h = (n: number): number => parseFloat(v[`--pmk-h${n}-size`]!);
      expect(h(1)).toBeGreaterThan(h(2));
      expect(h(2)).toBeGreaterThan(h(3));
    }
  });
});
