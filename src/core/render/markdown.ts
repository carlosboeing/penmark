import MarkdownIt from "markdown-it";
import taskLists from "markdown-it-task-lists";
import footnote from "markdown-it-footnote";
import anchor from "markdown-it-anchor";
import GithubSlugger from "github-slugger";
import { registerInlineSoff } from "./inlineSoff.js";
import { registerOffsets } from "./offsets.js";

/**
 * Options for createRenderer.
 *
 * Hooks are used instead of direct vscode references so that src/core
 * stays platform-agnostic (ADR 0001).
 */
export interface RendererOptions {
  /**
   * Rewrite image src URIs before they are emitted into HTML.
   * The vscode extension host uses this to convert relative paths
   * to vscode-resource URIs. If omitted, src is passed through unchanged.
   */
  resolveImage?: (src: string) => string;

  /**
   * Syntax highlighter hook for T7. Receives the raw code and language string.
   * Return the highlighted HTML string, or null/undefined to fall back to
   * plain escaping.
   */
  highlight?: (code: string, lang: string) => string | null | undefined;

  /**
   * When true, ```` ```mermaid ```` fences are emitted as
   * `<div class="pmk-mermaid" data-pmk-source="…">` containers (escaped source)
   * instead of code blocks, so the webview can lazily render them as diagrams
   * (T9). When false/omitted they fall through to the normal fence renderer.
   *
   * Gating is host-side: when penmark.mermaid.enabled is false the host passes
   * mermaid:false, the fence renders as a plain code block, the webview finds no
   * .pmk-mermaid containers, and the mermaid chunk is never loaded.
   */
  mermaid?: boolean;
}

/**
 * Create a configured markdown-it instance with the GFM-equivalent plugin set.
 *
 * html:true is required so that pmk: HTML-comment anchors flow through the
 * pipeline as raw HTML rather than being escaped into visible text.
 * The sanitizer (T3) strips comments from the output before it reaches
 * the webview; they must never render as visible text.
 */
export function createRenderer(opts: RendererOptions): MarkdownIt {
  const md = new MarkdownIt({
    html: true,
    linkify: true,
    highlight: opts.highlight ? (code, lang) => opts.highlight!(code, lang) ?? "" : undefined,
  });

  // Task lists: [ ] / [x] syntax
  md.use(taskLists);

  // Footnotes: [^1] syntax
  md.use(footnote);

  // Heading anchors with GitHub-compatible slugs.
  // The slugger is stateful: it tracks seen slugs to append -1, -2, ... to
  // duplicate headings. The renderer is reused across re-renders (every edit
  // /save in the live preview), so the slugger must be reset at the start of
  // each render — otherwise slugs accumulate suffixes across renders and
  // heading anchors drift (hello -> hello-1 -> hello-2 ...).
  const slugger = new GithubSlugger();
  md.core.ruler.before("normalize", "pmk-slug-reset", () => {
    slugger.reset();
  });
  md.use(anchor, {
    slugify: (s: string) => slugger.slug(s),
  });

  // Source-position stamps (ADR 0005).
  registerOffsets(md);
  // Per-text-node source offsets (v1.0 polish).
  registerInlineSoff(md);

  // Task-list items: stamp source line for checkbox toggling (v1.0 polish).
  const defaultListItemOpen = md.renderer.rules.list_item_open;
  md.renderer.rules.list_item_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    if (token?.map) {
      token.attrSet("data-pmk-line", String(token.map[0]));
    }
    if (defaultListItemOpen) {
      return defaultListItemOpen(tokens, idx, options, env, self);
    }
    return self.renderToken(tokens, idx, options);
  };

  // Mermaid fence rule (T9). A ```mermaid fence becomes a container div the
  // webview renders lazily; every other fence (and the disabled case) delegates
  // to the default fence renderer, preserving the highlight hook.
  if (opts.mermaid) {
    const defaultFenceRenderer = md.renderer.rules["fence"];
    md.renderer.rules["fence"] = (tokens, idx, options, env, self) => {
      const token = tokens[idx];
      const info = token ? token.info.trim().split(/\s+/)[0] : "";
      if (token && info === "mermaid") {
        // Preserve the data-pmk-offset that registerOffsets stamped on the fence
        // token so scroll-sync and morphdom node-identity keep working (ADR 0005).
        const offsetIndex = token.attrIndex("data-pmk-offset");
        const offsetAttr =
          offsetIndex >= 0 && token.attrs
            ? ` data-pmk-offset="${md.utils.escapeHtml(token.attrs[offsetIndex]![1])}"`
            : "";
        // Escape the source so <, >, &, " are entity-encoded — this prevents
        // both attribute breakage and XSS. The webview un-escapes via dataset.
        const source = md.utils.escapeHtml(token.content);
        return `<div class="pmk-mermaid"${offsetAttr} data-pmk-source="${source}"></div>\n`;
      }
      if (defaultFenceRenderer) {
        return defaultFenceRenderer(tokens, idx, options, env, self);
      }
      return self.renderToken(tokens, idx, options);
    };
  }

  // Image src rewriting hook.
  if (opts.resolveImage) {
    const resolveImage = opts.resolveImage;
    const defaultImageRenderer = md.renderer.rules["image"];
    md.renderer.rules["image"] = (tokens, idx, options, env, self) => {
      const token = tokens[idx];
      if (token) {
        const srcIndex = token.attrIndex("src");
        if (srcIndex >= 0 && token.attrs) {
          const srcAttr = token.attrs[srcIndex];
          if (srcAttr && srcAttr[1]) {
            srcAttr[1] = resolveImage(srcAttr[1]);
          }
        }
      }
      if (defaultImageRenderer) {
        return defaultImageRenderer(tokens, idx, options, env, self);
      }
      return self.renderToken(tokens, idx, options);
    };
  }

  return md;
}

/** A top-level block's source line range and normalized kind (for placement). */
export interface BlockOffset {
  line0: number;
  line1: number;
  type: string;
}

/**
 * Normalize a markdown-it block token type to the {@link BlockType} vocabulary
 * `buildBlockMap`/`planAnchor` expect (src/core/comments/placement.ts). Unknown
 * types fall through to their raw string and become `"other"` downstream.
 */
function normalizeBlockType(tokenType: string): string {
  const base = tokenType.endsWith("_open") ? tokenType.slice(0, -"_open".length) : tokenType;
  switch (base) {
    case "bullet_list":
    case "ordered_list":
      return "list";
    case "code_block":
      return "fence"; // both are span-hostile verbatim code
    case "html_block":
      return "html";
    case "hr":
      return "other";
    default:
      return base; // paragraph | heading | table | blockquote | fence
  }
}

/**
 * Extract the source line range of every top-level block in `source`, using the
 * SAME renderer configuration as {@link createRenderer} so block segmentation
 * matches what is rendered. Returns line ranges (`token.map`, 0-indexed,
 * end-exclusive) plus a normalized type — the input `buildBlockMap` turns into
 * char offsets for anchor placement (R4/R7). Pure: no rendering, just `parse`.
 *
 * NOTE: this tokenizes the text it is given. The host (R7) passes the RAW
 * document source (frontmatter included) so the resulting offsets are
 * source-relative and consistent with the document the WorkspaceEdit mutates;
 * placement rejects frontmatter selections via its own detector.
 */
export function tokenizeBlockOffsets(source: string): BlockOffset[] {
  const md = createRenderer({});
  const tokens = md.parse(source, {});
  const out: BlockOffset[] = [];
  for (const t of tokens) {
    if (
      t.level === 0 &&
      t.map &&
      (t.type.endsWith("_open") || ["fence", "code_block", "html_block", "hr"].includes(t.type))
    ) {
      out.push({ line0: t.map[0], line1: t.map[1], type: normalizeBlockType(t.type) });
    }
  }
  return out;
}
