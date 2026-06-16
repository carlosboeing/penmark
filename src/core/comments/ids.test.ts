import { describe, it, expect } from "vitest";
import { isValidId, generateId, freshId } from "./ids.js";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

/** A deterministic rng that replays a fixed sequence of values in [0, 1). */
function seqRng(values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[i % values.length] ?? 0;
    i += 1;
    return v;
  };
}

describe("isValidId (spec §3)", () => {
  it("accepts exactly 8 chars from the base32 lowercase alphabet", () => {
    expect(isValidId("abcdefgh")).toBe(true);
    expect(isValidId("a2b3c4d5")).toBe(true);
    expect(isValidId("zzzzzzzz")).toBe(true);
    expect(isValidId("234567ab")).toBe(true);
  });

  it("rejects uppercase letters", () => {
    expect(isValidId("Abcdefgh")).toBe(false);
    expect(isValidId("ABCDEFGH")).toBe(false);
  });

  it("rejects the excluded digits 0, 1, 8, 9", () => {
    expect(isValidId("0bcdefgh")).toBe(false);
    expect(isValidId("1bcdefgh")).toBe(false);
    expect(isValidId("8bcdefgh")).toBe(false);
    expect(isValidId("9bcdefgh")).toBe(false);
  });

  it("rejects the wrong length", () => {
    expect(isValidId("")).toBe(false);
    expect(isValidId("abcdefg")).toBe(false); // 7
    expect(isValidId("abcdefghi")).toBe(false); // 9
  });

  it("rejects out-of-alphabet symbols", () => {
    expect(isValidId("abcdef-h")).toBe(false);
    expect(isValidId("abcd efg")).toBe(false);
  });
});

describe("generateId (spec §3)", () => {
  it("produces a valid id for 10k samples from the default rng", () => {
    for (let i = 0; i < 10_000; i++) {
      expect(isValidId(generateId())).toBe(true);
    }
  });

  it("is deterministic given a seedable rng", () => {
    // Index 0 -> 'a', index 31 -> '7'. rng returns idx/32 so floor(rng*32)===idx.
    const rng = seqRng([0, 1 / 32, 2 / 32, 3 / 32, 4 / 32, 5 / 32, 6 / 32, 7 / 32]);
    expect(generateId(rng)).toBe("abcdefgh");
  });

  it("maps the top of the alphabet correctly", () => {
    const rng = seqRng([31 / 32]);
    expect(generateId(rng)).toBe("77777777");
  });

  it("never indexes outside the alphabet even if rng yields the boundary value", () => {
    // A misbehaving rng returning exactly 1.0 must still produce a valid char.
    const rng = seqRng([0.999999999, 1]);
    const id = generateId(rng);
    expect(id).toHaveLength(8);
    expect(isValidId(id)).toBe(true);
    for (const ch of id) expect(ALPHABET).toContain(ch);
  });
});

describe("freshId (spec §3 — collision avoidance)", () => {
  it("returns a generated id when it is not already taken", () => {
    const taken = new Set<string>();
    const id = freshId(taken, seqRng([0, 0, 0, 0, 0, 0, 0, 0]));
    expect(id).toBe("aaaaaaaa");
  });

  it("retries when the first draw collides with a taken id", () => {
    const taken = new Set<string>(["aaaaaaaa"]);
    // First 8 draws -> "aaaaaaaa" (taken), next 8 -> "bbbbbbbb" (free).
    const rng = seqRng([
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      1 / 32,
      1 / 32,
      1 / 32,
      1 / 32,
      1 / 32,
      1 / 32,
      1 / 32,
      1 / 32,
    ]);
    expect(freshId(taken, rng)).toBe("bbbbbbbb");
  });

  it("always returns an id distinct from the taken set under the default rng", () => {
    const taken = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const id = freshId(taken);
      expect(taken.has(id)).toBe(false);
      expect(isValidId(id)).toBe(true);
      taken.add(id);
    }
  });
});
