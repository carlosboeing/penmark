/**
 * jsdom tests for the mermaid lazy loader/gate (T9, step 2).
 *
 * These cover ONLY the gating logic: the heavy mermaid chunk is mocked via an
 * injected importer, so nothing real is loaded (mermaid needs a browser SVG
 * engine — its DOM rendering is covered by Playwright). We assert:
 *   - no .pmk-mermaid container → the importer is never called
 *   - a container present → the importer is called exactly once and cached
 *     across repeated renders / theme changes
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ensureMermaid,
  hasMermaid,
  isMermaidLoaded,
  __resetMermaidLoaderForTests,
  type MermaidModule,
} from "./mermaidLoader.js";

beforeEach(() => {
  __resetMermaidLoaderForTests();
  document.body.innerHTML = "";
});

function makeRoot(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

describe("mermaid loader gating", () => {
  it("hasMermaid reflects whether a .pmk-mermaid container exists", () => {
    expect(hasMermaid(makeRoot("<p>just prose</p>"))).toBe(false);
    expect(hasMermaid(makeRoot('<div class="pmk-mermaid" data-pmk-source="graph TD"></div>'))).toBe(
      true,
    );
  });

  it("does NOT import the chunk when no diagram container is present", async () => {
    const importer = vi.fn<() => Promise<MermaidModule>>();
    const root = makeRoot("<p>no diagrams here</p>");

    await ensureMermaid(root, "light", importer);

    expect(importer).not.toHaveBeenCalled();
    expect(isMermaidLoaded()).toBe(false);
  });

  it("imports the chunk once when a container is present and caches it", async () => {
    const renderMermaid = vi.fn();
    const importer = vi.fn<() => Promise<MermaidModule>>(async () => ({ renderMermaid }));
    const root = makeRoot('<div class="pmk-mermaid" data-pmk-source="graph TD"></div>');

    await ensureMermaid(root, "light", importer);
    await ensureMermaid(root, "dark", importer);
    await ensureMermaid(root, "light", importer);

    // Imported exactly once across three renders/theme changes.
    expect(importer).toHaveBeenCalledTimes(1);
    expect(isMermaidLoaded()).toBe(true);
    // renderMermaid is invoked on every ensure, with the resolved theme.
    expect(renderMermaid).toHaveBeenCalledTimes(3);
    expect(renderMermaid).toHaveBeenNthCalledWith(1, root, "light");
    expect(renderMermaid).toHaveBeenNthCalledWith(2, root, "dark");
  });
});
