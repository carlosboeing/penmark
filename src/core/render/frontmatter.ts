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
