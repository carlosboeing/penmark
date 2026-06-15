import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  loadHighlighterIfNeeded,
  __resetHighlighterCache,
} from "../../../src/vscode/hljsLoader.js";
import { highlight } from "../../../src/hljs.js";

beforeEach(() => {
  __resetHighlighterCache();
});

describe("loadHighlighterIfNeeded", () => {
  it("does NOT import dist/hljs.js when the document has no language-tagged fence", async () => {
    const importer = vi.fn(async () => ({ highlight }));
    const result = await loadHighlighterIfNeeded(
      "# Heading\n\nProse with `inline code` and a bare fence:\n\n```\nplain\n```\n",
      importer,
    );
    expect(result).toBeUndefined();
    expect(importer).not.toHaveBeenCalled();
  });

  it("imports once and caches when a language-tagged fence is present", async () => {
    const importer = vi.fn(async () => ({ highlight }));
    const source = "```ts\nconst x = 1;\n```\n";

    const first = await loadHighlighterIfNeeded(source, importer);
    expect(first).toBe(highlight);
    expect(importer).toHaveBeenCalledTimes(1);

    // Second call reuses the cached highlighter — no re-import.
    const second = await loadHighlighterIfNeeded(source, importer);
    expect(second).toBe(highlight);
    expect(importer).toHaveBeenCalledTimes(1);
  });

  it("detects tilde fences with a language too", async () => {
    const importer = vi.fn(async () => ({ highlight }));
    const result = await loadHighlighterIfNeeded("~~~python\nx = 1\n~~~\n", importer);
    expect(result).toBe(highlight);
    expect(importer).toHaveBeenCalledTimes(1);
  });
});
