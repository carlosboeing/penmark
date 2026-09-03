import { describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - plain ESM script, typed via scripts/check-version-coherence.mjs.d.ts
import { checkVersionCoherence } from "../../../scripts/check-version-coherence.mjs";

const MATCHING_SOURCES = {
  packageVersion: "0.5.6",
  lockfileVersion: "0.5.6",
  vsixPackageVersion: "0.5.6",
  manifestVersion: "0.5.6",
};

describe("checkVersionCoherence", () => {
  it("accepts matching packaged versions without a release tag", () => {
    expect(checkVersionCoherence(MATCHING_SOURCES)).toEqual({
      expectedVersion: "0.5.6",
      errors: [],
      passed: true,
    });
  });

  it("accepts a matching three-component release tag", () => {
    expect(
      checkVersionCoherence({
        ...MATCHING_SOURCES,
        tagName: "v0.5.6",
      }),
    ).toEqual({
      expectedVersion: "0.5.6",
      errors: [],
      passed: true,
    });
  });

  it("rejects a tag whose version differs from the packaged version", () => {
    const result = checkVersionCoherence({
      ...MATCHING_SOURCES,
      tagName: "v0.5.7",
    });

    expect(result.passed).toBe(false);
    expect(result.errors).toContain("tag v0.5.7 does not match package version 0.5.6");
  });

  it("rejects a packaged version mismatch", () => {
    const result = checkVersionCoherence({
      ...MATCHING_SOURCES,
      manifestVersion: "0.5.5",
    });

    expect(result.passed).toBe(false);
    expect(result.errors).toContain(
      "VSIX manifest version 0.5.5 does not match package version 0.5.6",
    );
  });

  it("rejects a non-release tag shape", () => {
    const result = checkVersionCoherence({
      ...MATCHING_SOURCES,
      tagName: "v0.5",
    });

    expect(result.passed).toBe(false);
    expect(result.errors).toContain("tag v0.5 must match vMAJOR.MINOR.PATCH");
  });
});
