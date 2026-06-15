// Separate esbuild node entry (dist/hljs.js) wrapping the highlight.js
// common-language subset (D8). Bundled apart from dist/extension.js and loaded
// on demand by src/vscode/hljsLoader.ts so highlight.js stays off the hot path
// until a fenced code block with a language is actually rendered.
import hljs from "highlight.js/lib/common";

/**
 * Synchronously highlight `code` for `lang`. markdown-it's highlight hook is
 * synchronous, so this must be too (the laziness lives in WHEN the module is
 * loaded, not in the call itself — see hljsLoader.ts).
 *
 * Returns highlight.js token-span HTML (`<span class="hljs-keyword">…`) on
 * success. Returns the empty string for an unknown/unsupported language or on
 * any internal error — markdown-it then applies its default escaping, yielding
 * a plain (escaped) `<code>` block with no crash.
 */
export function highlight(code: string, lang: string): string {
  if (lang && hljs.getLanguage(lang)) {
    try {
      return hljs.highlight(code, { language: lang }).value;
    } catch {
      // Fall through to the empty-string default-escaping path.
    }
  }
  return "";
}
