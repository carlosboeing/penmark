/**
 * Strip a leading YAML frontmatter block from a markdown document.
 *
 * Matches only a leading `---\n...\n---\n` block. No YAML parsing is performed;
 * the raw frontmatter text is returned for callers that need it (e.g. card UI in v1.0).
 * Unstripped frontmatter renders as a horizontal rule followed by text — garbage output.
 */

export interface FrontmatterResult {
  /** Document body with the frontmatter block removed. */
  body: string;
  /** Raw frontmatter text (without delimiters), or null if no frontmatter present. */
  frontmatter: string | null;
}

/** Parsed scalar/list fields from YAML frontmatter for the metadata card. */
export interface FrontmatterFields {
  title?: string;
  status?: string;
  date?: string;
  author?: string;
  tags?: string[];
  [key: string]: string | string[] | undefined;
}

/**
 * Parse common YAML frontmatter fields (line-oriented, no full YAML engine).
 *
 * Supported: `key: value` scalars, `key: [a, b]` inline lists, and block
 * sequences of scalars:
 *
 *     authors:
 *       - Carlos Boeing
 *       - claude-opus-5
 *
 * NOT supported, deliberately: nested maps, multiline scalars (`|`, `>`),
 * anchors, aliases. A real YAML engine would handle those, but bundle size is a
 * project requirement and js-yaml costs roughly 30KB to serve shapes this
 * codebase does not use.
 */
export function parseFrontmatterFields(raw: string | null): FrontmatterFields {
  if (!raw) return {};
  const fields: FrontmatterFields = {};
  const unquote = (s: string): string => s.trim().replace(/^['"]|['"]$/g, "");
  let sequenceKey: string | null = null;

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // A block-sequence item continues the key that opened with an empty value.
    const item = /^-\s+(.*)$/.exec(trimmed);
    if (item && sequenceKey) {
      const list = Array.isArray(fields[sequenceKey]) ? (fields[sequenceKey] as string[]) : [];
      const value = unquote(item[1] ?? "");
      if (value) fields[sequenceKey] = [...list, value];
      continue;
    }

    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(trimmed);
    if (!m) continue;
    const key = m[1] as string;
    const value = (m[2] ?? "").trim();

    if (value.startsWith("[") && value.endsWith("]")) {
      sequenceKey = null;
      fields[key] = value.slice(1, -1).split(",").map(unquote).filter(Boolean);
    } else if (value === "") {
      // May open a block sequence. Stays "" if no items follow.
      sequenceKey = key;
      fields[key] = "";
    } else {
      sequenceKey = null;
      fields[key] = unquote(value);
    }
  }
  return fields;
}

/**
 * Strip a leading YAML frontmatter block (`---\n…\n---\n`) from `source`.
 * Returns the body and the raw frontmatter text (or null if absent).
 */
export function stripFrontmatter(source: string): FrontmatterResult {
  // Match only a leading frontmatter block: starts at position 0, opening --- on its own line,
  // closing --- on its own line, followed by a newline. `\r?` tolerates CRLF line endings
  // (Windows-authored docs), which run before markdown-it's own newline normalization.
  const match = source.match(/^---\r?\n([\s\S]*?\n)---\r?\n([\s\S]*)$/);
  if (!match) {
    return { body: source, frontmatter: null };
  }
  // match[1] is the raw frontmatter content (between delimiters)
  // match[2] is the rest of the document
  const rawFrontmatter = match[1] ?? "";
  const body = match[2] ?? "";
  return { body, frontmatter: rawFrontmatter };
}
