/**
 * Lazy loader/gate for the mermaid chunk (T9).
 *
 * Keeps the gating logic (does this render contain diagrams? has the chunk
 * already loaded?) separate from the heavy chunk itself so it can be unit-tested
 * under jsdom with the dynamic import mocked — the real mermaid chunk needs a
 * browser SVG engine and is covered by Playwright instead.
 *
 * The chunk is loaded at most once and cached. It is loaded ONLY when a
 * .pmk-mermaid container exists in the render, AND (host-side) penmark.mermaid
 * .enabled was true — when disabled the host emits plain code blocks, so no
 * container exists and this never imports.
 *
 * ADR 0001: no vscode imports.
 */

/** The slice of the mermaid chunk's public surface the loader drives. */
export interface MermaidModule {
  renderMermaid(root: HTMLElement, theme: "light" | "dark"): void;
}

/** Default importer — the real dynamic import of the mermaid* chunk. */
function defaultImport(): Promise<MermaidModule> {
  return import("./mermaid.js");
}

// Cached promise so the chunk is fetched at most once across renders/theme
// changes. Reset only via the test seam.
let _modulePromise: Promise<MermaidModule> | null = null;

/** Whether any diagram container exists in `root`. */
export function hasMermaid(root: HTMLElement): boolean {
  return root.querySelector(".pmk-mermaid") !== null;
}

/**
 * Ensure mermaid diagrams in `root` are rendered for the given theme. Imports
 * the chunk lazily (once) and delegates to renderMermaid. No-ops when there is
 * no diagram container, so prose-only docs never load the chunk.
 *
 * @param root   Container holding the rendered markdown.
 * @param theme  Resolved preview theme.
 * @param importer  Injectable importer (test seam); defaults to the real import.
 */
export async function ensureMermaid(
  root: HTMLElement,
  theme: "light" | "dark",
  importer: () => Promise<MermaidModule> = defaultImport,
): Promise<void> {
  if (!hasMermaid(root)) return;
  if (!_modulePromise) {
    _modulePromise = importer();
  }
  const mod = await _modulePromise;
  mod.renderMermaid(root, theme);
}

/** Whether the chunk has been (or is being) loaded. */
export function isMermaidLoaded(): boolean {
  return _modulePromise !== null;
}

/** Test seam: reset the cached chunk promise between tests. */
export function __resetMermaidLoaderForTests(): void {
  _modulePromise = null;
}
