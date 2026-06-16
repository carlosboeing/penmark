import type MarkdownIt from "markdown-it";
import type StateCore from "markdown-it/lib/rules_core/state_core.mjs";
import type Token from "markdown-it/lib/token.mjs";
import type Renderer from "markdown-it/lib/renderer.mjs";

/** Char offset of the start of each line in `src`. */
function lineStartOffsets(src: string): number[] {
  const starts = [0];
  for (let i = 0; i < src.length; i++) {
    if (src.charAt(i) === "\n") starts.push(i + 1);
  }
  return starts;
}

/**
 * After inline parsing, stamp `data-pmk-soff` on text/code_inline children so
 * the webview can map selections to exact source char offsets (v1.0 polish).
 */
function annotateInlineSoff(state: StateCore): void {
  const src = state.src;
  const lineStarts = lineStartOffsets(src);

  for (const token of state.tokens) {
    if (token.type !== "inline" || !token.children || !token.map) continue;

    const sliceStart = lineStarts[token.map[0]] ?? 0;
    const sliceEnd =
      token.map[1] < lineStarts.length ? (lineStarts[token.map[1]] ?? src.length) : src.length;
    const slice = src.slice(sliceStart, sliceEnd);
    let local = 0;

    for (const child of token.children) {
      if (child.type !== "text" && child.type !== "code_inline") continue;
      const content = child.content;
      if (!content) continue;
      const rel = slice.indexOf(content, local);
      if (rel === -1) continue;
      child.attrSet("data-pmk-soff", String(sliceStart + rel));
      local = rel + content.length;
    }
  }
}

type RenderRule = (
  tokens: Token[],
  idx: number,
  options: object,
  env: unknown,
  self: Renderer,
) => string;

function wrapWithSoff(md: MarkdownIt, defaultRender: RenderRule | undefined): RenderRule {
  return (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    if (!token) return "";
    const soff = token.attrGet("data-pmk-soff");
    const inner = defaultRender
      ? defaultRender(tokens, idx, options, env, self)
      : md.utils.escapeHtml(token.content);
    if (soff === null || soff === "") return inner;
    return `<span data-pmk-soff="${soff}">${inner}</span>`;
  };
}

/** Wrap annotated inline text in spans carrying data-pmk-soff. */
export function registerInlineSoff(md: MarkdownIt): void {
  md.core.ruler.push("pmk-inline-soff", annotateInlineSoff);

  const defaultText = md.renderer.rules.text;
  md.renderer.rules.text = wrapWithSoff(md, defaultText);

  const defaultCode = md.renderer.rules.code_inline;
  md.renderer.rules.code_inline = wrapWithSoff(md, defaultCode);
}
