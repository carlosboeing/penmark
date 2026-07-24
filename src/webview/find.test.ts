import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FindHighlighter,
  MAX_FIND_MATCHES,
  MAX_FIND_TEXT_CHARACTERS,
  MAX_FIND_TEXT_NODES,
} from "./find.js";

describe("FindHighlighter", () => {
  let root: HTMLElement;
  const originalMatchMedia = window.matchMedia;
  const originalScrollIntoView = Element.prototype.scrollIntoView;

  beforeEach(() => {
    document.body.innerHTML = '<div id="penmark-root"><p>Needle, needle, NEEDLE.</p></div>';
    root = document.getElementById("penmark-root")!;
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("highlights every case-insensitive match and marks the first as current", () => {
    const find = new FindHighlighter(root);

    expect(find.apply("needle")).toEqual({ count: 3, capped: false });
    expect(root.querySelectorAll("mark.pmk-search-hit")).toHaveLength(3);
    expect(root.querySelectorAll("mark.pmk-search-hit-current")).toHaveLength(1);
    expect(root.querySelector("mark.pmk-search-hit-current")?.textContent).toBe("Needle");
  });

  it("keeps scanning later text nodes after decorating an earlier match", () => {
    root.innerHTML = "<p>needle <span>needle</span> <em>needle</em></p>";
    const find = new FindHighlighter(root);

    expect(find.apply("needle")).toEqual({ count: 3, capped: false });
    expect(root.querySelectorAll("mark.pmk-search-hit")).toHaveLength(3);
  });

  it("scrolls the initial current match into view", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const find = new FindHighlighter(root);

    find.apply("needle");

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "smooth" });
  });

  it("cycles with reduced-motion scrolling", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
    const find = new FindHighlighter(root);
    find.apply("needle");

    find.next();

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "auto" });
  });

  it("wraps previous navigation to the final match", () => {
    const find = new FindHighlighter(root);
    find.apply("needle");

    find.previous();

    const current = root.querySelector(".pmk-search-hit-current");
    expect(find.currentPosition()).toBe(3);
    expect(current?.textContent).toBe("NEEDLE");
  });

  it("honours case-sensitive matching", () => {
    const find = new FindHighlighter(root);

    expect(find.apply("needle", true)).toEqual({ count: 1, capped: false });
    expect(root.querySelector(".pmk-search-hit")?.textContent).toBe("needle");
  });

  it("clears all transient search marks", () => {
    const find = new FindHighlighter(root);
    find.apply("needle");

    find.clear();

    expect(root.querySelectorAll(".pmk-search-hit")).toHaveLength(0);
    expect(root.textContent).toBe("Needle, needle, NEEDLE.");
  });

  it("re-merges split text nodes on clear so a later query matches across an old boundary", () => {
    root.innerHTML = "<p>runbook</p>";
    const first = new FindHighlighter(root);
    first.apply("run");

    first.clear();

    // Unwrapping the mark must not leave "run" and "book" as separate nodes —
    // search never crosses text-node boundaries, so the seam would hide the word.
    expect(root.querySelector("p")!.childNodes).toHaveLength(1);
    const second = new FindHighlighter(root);
    expect(second.apply("runbook")).toEqual({ count: 1, capped: false });
  });

  it("keeps matching as a query grows one character at a time", () => {
    // findSurface re-searches the same root on every keystroke (clear, then a
    // fresh highlighter). Before the clear() fix, the first query fragmented the
    // text and every longer query silently reported no results.
    root.innerHTML = "<p>Executes the runbook review gate, then the runbook sketch.</p>";
    let find: FindHighlighter | null = null;
    const counts = ["r", "ru", "run", "runb", "runbo", "runboo", "runbook"].map((query) => {
      find?.clear();
      find = new FindHighlighter(root);
      return find.apply(query).count;
    });

    // "r" also matches "review"; every longer query matches both "runbook"s.
    expect(counts).toEqual([3, 2, 2, 2, 2, 2, 2]);
    expect(root.querySelectorAll("mark.pmk-search-hit")).toHaveLength(2);
  });

  it("does not create a match across a comment anchor boundary", () => {
    root.innerHTML = '<p>Need<mark class="pmk-hl" data-pmk-id="comment1">le</mark></p>';
    const find = new FindHighlighter(root);

    expect(find.apply("needle")).toEqual({ count: 0, capped: false });
    expect(root.querySelector("[data-pmk-id='comment1']")?.textContent).toBe("le");
  });

  it("does not create transient marks inside a comment anchor wrapper", () => {
    root.innerHTML = '<p>before <mark class="pmk-hl" data-pmk-id="comment1">needle</mark> after needle</p>';
    const find = new FindHighlighter(root);

    expect(find.apply("needle")).toEqual({ count: 1, capped: false });
    expect(root.querySelector("[data-pmk-id='comment1'] mark.pmk-search-hit")).toBeNull();
    expect(root.querySelectorAll("mark.pmk-search-hit")).toHaveLength(1);
  });

  it("caps pathological queries and reports the truncation", () => {
    root.textContent = "x".repeat(MAX_FIND_MATCHES + 1);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const find = new FindHighlighter(root);

    expect(find.apply("x")).toEqual({ count: MAX_FIND_MATCHES, capped: true });
    expect(warn).toHaveBeenCalledWith(`Penmark find capped after ${MAX_FIND_MATCHES} matches`);
    warn.mockRestore();
  });

  it("caps scan work when a sparse query has no matches", () => {
    root.replaceChildren(
      ...Array.from({ length: MAX_FIND_TEXT_NODES + 1 }, () => {
        const span = document.createElement("span");
        span.textContent = "x";
        return span;
      }),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const find = new FindHighlighter(root);

    expect(find.apply("needle")).toEqual({ count: 0, capped: true });
    expect(warn).toHaveBeenCalledWith(`Penmark find capped after scanning ${MAX_FIND_TEXT_NODES} text nodes`);
    warn.mockRestore();
  });

  it("caps scan work inside one enormous text node", () => {
    root.textContent = "x".repeat(MAX_FIND_TEXT_CHARACTERS + 1);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const find = new FindHighlighter(root);

    expect(find.apply("needle")).toEqual({ count: 0, capped: true });
    expect(warn).toHaveBeenCalledWith(
      `Penmark find capped after scanning ${MAX_FIND_TEXT_CHARACTERS} text characters`,
    );
    warn.mockRestore();
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });
});
