import { describe, expect, it } from "vitest";
import { readingMetrics } from "./readingMetrics.js";

describe("readingMetrics", () => {
  it.each([
    ["", 0, 0, "0 words · 0 min read"],
    ["one", 1, 1, "1 word · 1 min read"],
    ["one two", 2, 1, "2 words · 1 min read"],
  ])("formats zero, singular, and plural words", (text, words, minutes, label) => {
    expect(readingMetrics(text, "en-US")).toEqual({ words, minutes, label });
  });

  it("formats word counts with the active locale", () => {
    const text = Array.from({ length: 2_140 }, () => "word").join(" ");

    expect(readingMetrics(text, "en-US").label).toBe("2,140 words · 9 min read");
    expect(readingMetrics(text, "de-DE").label).toBe("2.140 words · 9 min read");
  });

  it("uses a 240 WPM ceiling with a one-minute minimum for non-empty text", () => {
    const words = (count: number): string => Array.from({ length: count }, () => "word").join(" ");

    expect(readingMetrics(words(240), "en-US").minutes).toBe(1);
    expect(readingMetrics(words(241), "en-US").minutes).toBe(2);
  });

  it("counts non-empty whitespace-delimited visible text rather than Markdown source", () => {
    expect(readingMetrics("Heading\n\nvisible   linked text", "en-US")).toMatchObject({
      words: 4,
      label: "4 words · 1 min read",
    });
  });
});
