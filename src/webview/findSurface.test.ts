import { beforeEach, describe, expect, it } from "vitest";
import { ensureFindSurface } from "./findSurface.js";

describe("in-preview find surface", () => {
  beforeEach(() => {
    document.body.innerHTML = '<button data-pmk-topbar-control="find">Search</button><div id="penmark-root"><p>Needle and needle</p></div>';
  });

  it("replaces highlights as the query changes and removes decorations when closed", () => {
    const surface = ensureFindSurface(() => document.getElementById("penmark-root")!);
    const opener = document.querySelector<HTMLButtonElement>("[data-pmk-topbar-control='find']")!;
    surface.open(opener);

    const input = document.querySelector<HTMLInputElement>(".pmk-find-input")!;
    expect(document.activeElement).toBe(input);
    input.value = "needle";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(document.querySelectorAll(".pmk-search-hit")).toHaveLength(2);
    expect(document.querySelector(".pmk-find-count")?.textContent).toBe("1 / 2");

    input.value = "Needle";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(document.querySelectorAll(".pmk-search-hit")).toHaveLength(2);
    expect(document.querySelector("#penmark-root")?.textContent).toBe("Needle and needle");

    document.querySelector<HTMLButtonElement>("[aria-label='Match case']")!.click();
    expect(document.querySelectorAll(".pmk-search-hit")).toHaveLength(1);
    expect(document.querySelector(".pmk-find-count")?.textContent).toBe("1 / 1");

    surface.close();
    expect(document.querySelector(".pmk-find-surface")?.getAttribute("aria-hidden")).toBe("true");
    expect(document.querySelectorAll(".pmk-search-hit")).toHaveLength(0);
    expect(document.activeElement).toBe(opener);
  });
});
