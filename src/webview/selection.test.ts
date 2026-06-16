import { describe, it, expect, beforeEach } from "vitest";
import { selectionToSourceRange } from "./selection.js";

/** Wrap a real DOM Range in a minimal Selection (jsdom's Selection is partial). */
function selectionOf(range: Range | null): Selection {
  return {
    rangeCount: range ? 1 : 0,
    getRangeAt: () => range as Range,
  } as unknown as Selection;
}

function setBody(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.getElementById("root") as HTMLElement;
}

describe("selectionToSourceRange (R10)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("maps a selection inside a paragraph to absolute body char offsets", () => {
    // Source: "# Title\n\nA paragraph here.\n" — the paragraph starts at char 9.
    const root = setBody(
      '<div id="root"><p data-pmk-offset="2:3" data-pmk-coff="9">A paragraph here.</p></div>',
    );
    const text = root.querySelector("p")!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 2); // "paragraph" begins at within-block offset 2
    range.setEnd(text, 11); // …ends at 11
    expect(selectionToSourceRange(selectionOf(range), root)).toEqual({ start: 11, end: 20 });
  });

  it("returns the union range for a selection spanning two blocks", () => {
    const root = setBody(
      '<div id="root">' +
        '<p data-pmk-offset="0:1" data-pmk-coff="0">first block</p>' +
        '<p data-pmk-offset="2:3" data-pmk-coff="13">second block</p>' +
        "</div>",
    );
    const [p1, p2] = [...root.querySelectorAll("p")];
    const range = document.createRange();
    range.setStart(p1!.firstChild!, 6); // inside "first block"
    range.setEnd(p2!.firstChild!, 6); // inside "second block"
    expect(selectionToSourceRange(selectionOf(range), root)).toEqual({ start: 6, end: 19 });
  });

  it("returns null for a selection in a region with no data-pmk-coff (e.g. the top bar)", () => {
    const root = setBody('<div id="root"><div class="pmk-topbar">Penmark</div></div>');
    const bar = root.querySelector(".pmk-topbar")!.firstChild!;
    const range = document.createRange();
    range.setStart(bar, 0);
    range.setEnd(bar, 4);
    expect(selectionToSourceRange(selectionOf(range), root)).toBeNull();
  });

  it("returns null for a collapsed selection", () => {
    const root = setBody('<div id="root"><p data-pmk-coff="0">text</p></div>');
    const text = root.querySelector("p")!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 2);
    range.setEnd(text, 2);
    expect(selectionToSourceRange(selectionOf(range), root)).toBeNull();
  });

  it("returns null when there is no range", () => {
    const root = setBody('<div id="root"><p data-pmk-coff="0">text</p></div>');
    expect(selectionToSourceRange(selectionOf(null), root)).toBeNull();
  });

  it("returns null when the block's data-pmk-coff is missing or invalid", () => {
    const root = setBody('<div id="root"><p>no coff here</p></div>');
    const text = root.querySelector("p")!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 2);
    expect(selectionToSourceRange(selectionOf(range), root)).toBeNull();
  });

  it("returns null when data-pmk-coff is present but not a number", () => {
    const root = setBody('<div id="root"><p data-pmk-coff="oops">text</p></div>');
    const text = root.querySelector("p")!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 2);
    expect(selectionToSourceRange(selectionOf(range), root)).toBeNull();
  });

  it("handles a selection whose boundaries are element nodes (child-index offsets)", () => {
    const root = setBody('<div id="root"><p data-pmk-coff="0">Hello <em>world</em></p></div>');
    const p = root.querySelector("p")!;
    const range = document.createRange();
    range.setStart(p, 0); // before "Hello " (element container, child index 0)
    range.setEnd(p, 2); // after <em>world</em> (child index 2)
    // "Hello world" = 11 chars at coff 0.
    expect(selectionToSourceRange(selectionOf(range), root)).toEqual({ start: 0, end: 11 });
  });
});
