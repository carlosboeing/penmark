import { describe, expect, it } from "vitest";
import { resolveTypography, textSizeBasePx, typographyCssVars } from "./typography.js";

describe("resolveTypography", () => {
  it("github preset uses medium 16px body", () => {
    const t = resolveTypography({ preset: "github" });
    expect(t.textSize).toBe("medium");
    expect(t.lineHeight).toBe(1.5);
    expect(textSizeBasePx(t.textSize)).toBe(16);
  });

  it("reading preset uses serif and comfortable width", () => {
    const t = resolveTypography({ preset: "reading" });
    expect(t.fontFamily).toContain("Georgia");
    expect(t.contentWidth).toBe("comfortable");
    expect(t.textSize).toBe("large");
  });

  it("custom preset keeps explicit knobs", () => {
    const t = resolveTypography({
      preset: "custom",
      textSize: "x-large",
      lineHeight: 1.9,
      fontFamily: "Comic Sans MS",
    });
    expect(t.textSize).toBe("x-large");
    expect(t.lineHeight).toBe(1.9);
    expect(t.fontFamily).toBe("Comic Sans MS");
  });
});

describe("typographyCssVars", () => {
  it("emits heading scale from base size", () => {
    const vars = typographyCssVars(resolveTypography({ preset: "github" }));
    expect(vars["--pmk-text-size-base"]).toBe("16px");
    expect(vars["--pmk-h1-size"]).toBe("32px");
    expect(vars["--pmk-h2-size"]).toBe("24px");
  });
});
