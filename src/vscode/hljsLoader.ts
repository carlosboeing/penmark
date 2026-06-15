// Lazy loader for the highlight.js bundle (D8). markdown-it's highlight hook is
// synchronous, so "lazy" cannot mean "load during render" — instead we do a
// cheap regex check on the raw markdown BEFORE rendering and, only when a
// language-tagged fence is present, dynamically import the separate
// dist/hljs.js bundle once (cached at module scope for every later render).
//
// This module is host-side (src/vscode, excluded from coverage thresholds) but
// has NO top-level vscode import, so the loader logic is unit-testable directly.

/** A synchronous highlighter compatible with markdown-it's `highlight` hook. */
export type Highlighter = (code: string, lang: string) => string;

/**
 * Matches a fenced code block opener carrying a language info-string:
 * a line beginning with ``` or ~~~ (after optional indent) followed immediately
 * by a non-space, non-backtick/tilde language token. Bare fences (no language)
 * do NOT match, so plain-fence documents never trigger the import.
 */
const FENCE_WITH_LANG = /^[ \t]*(?:`{3,}|~{3,})[ \t]*[^\s`~]/m;

/**
 * Cached highlighter, resolved from dist/hljs.js on first need. `undefined`
 * means "not yet loaded"; once set it is reused for every subsequent render.
 */
let cached: Highlighter | undefined;

/** Module shape exposed by dist/hljs.js (the separate esbuild node entry). */
interface HljsModule {
  highlight: Highlighter;
}

/**
 * Dynamically import dist/hljs.js. The "./hljs.js" specifier resolves to the
 * sibling of dist/extension.js at runtime and is marked external in the
 * extension esbuild config, so esbuild emits this import() literally instead of
 * inlining highlight.js into extension.js (D8 laziness).
 *
 * The specifier is built via a variable so TypeScript does not attempt to
 * resolve the (build-time non-existent) sibling module; the explicit
 * HljsModule shape preserves type safety at the call site.
 */
function importHljs(): Promise<HljsModule> {
  const specifier = "./hljs.js";
  return import(specifier) as Promise<HljsModule>;
}

/**
 * Return a synchronous highlighter if `source` contains a language-tagged
 * fenced code block, loading dist/hljs.js once and caching it. Returns
 * `undefined` (WITHOUT importing) when there is no such fence, keeping
 * highlight.js off the hot path for prose-only documents.
 *
 * @param source  Raw markdown source to scan for a language-tagged fence.
 * @param importer  Test seam: overrides the dynamic import of dist/hljs.js.
 */
export async function loadHighlighterIfNeeded(
  source: string,
  importer: () => Promise<HljsModule> = importHljs,
): Promise<Highlighter | undefined> {
  if (cached) return cached;
  if (!FENCE_WITH_LANG.test(source)) return undefined;

  const mod = await importer();
  cached = mod.highlight;
  return cached;
}

/** Test-only seam: reset the module-scope cache between cases. */
export function __resetHighlighterCache(): void {
  cached = undefined;
}
