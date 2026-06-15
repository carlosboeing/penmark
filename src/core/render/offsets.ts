import type MarkdownIt from "markdown-it";

/** Char offset of the start of each line in `src` (index = line number). */
function lineStartOffsets(src: string): number[] {
  const starts = [0];
  for (let i = 0; i < src.length; i++) {
    if (src.charAt(i) === "\n") starts.push(i + 1);
  }
  return starts;
}

/**
 * Registers a markdown-it core ruler pass that stamps two source-position
 * attributes on every top-level block token:
 *
 *   - `data-pmk-offset="<startLine>:<endLine>"` — source LINE range (0-indexed,
 *     end exclusive). Used for editor↔preview scroll sync (T10) and morphdom
 *     node identity (ADR 0005).
 *   - `data-pmk-coff="<startChar>"` — CHAR offset of the block's start line in
 *     the (frontmatter-stripped) source body. The webview's selection→source
 *     mapping (R10) adds the within-block character offset to this base to get an
 *     absolute body char offset, the coordinate the host add-comment path (R7)
 *     consumes. Offsets are body-relative and computed against the post-normalize
 *     source markdown-it parsed (LF base — the v0.5 wire contract); a CRLF
 *     document's `\r`s are normalised away before this runs.
 *
 * ADR 0005: every top-level rendered block must carry these so the comment-
 * anchoring system can map rendered elements back to source positions.
 */
export function registerOffsets(md: MarkdownIt): void {
  md.core.ruler.push("pmk-offsets", (state) => {
    const lineStart = lineStartOffsets(state.src);
    for (const t of state.tokens) {
      if (
        t.level === 0 &&
        t.map &&
        (t.type.endsWith("_open") ||
          ["fence", "code_block", "html_block", "hr"].includes(t.type))
      ) {
        t.attrSet("data-pmk-offset", `${t.map[0]}:${t.map[1]}`);
        t.attrSet("data-pmk-coff", String(lineStart[t.map[0]] ?? 0));
      }
    }
  });
}
