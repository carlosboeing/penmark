/**
 * Export open review comments as an agent-ready markdown instruction block (R9).
 *
 * Pure: reconciled comments in, a single markdown string out. The host adds the
 * clipboard / file I/O. The output is meant to be pasted to an AI agent (the
 * agentic-SDLC workflow Penmark targets): a header naming the document, then one
 * section per open comment — author/timestamp, the quoted span as a blockquote
 * (the location context), and the reviewer's note. Comments appear in document
 * order; an orphan (its anchor lost from the source) is flagged so the agent
 * knows to locate it from the quote alone (§8).
 */

import { decodeDisplayText } from "./escape.js";
import type { ReconciledComment } from "./reconcile.js";

/**
 * Build the agent-ready review prompt for `docPath`'s open `comments` (the live
 * entries from reconcile, in document order). Returns a markdown string ending
 * in a single newline.
 */
function sectionLines(rc: ReconciledComment, heading: string): string[] {
  const e = rc.entry;
  const lines = [heading, ""];
  // The quote is a locator: the agent greps the file for it, so it must stay
  // byte-faithful to the document. The body is prose for the agent to read,
  // so agent-authored character references are rendered there.
  if (e.quote !== "") {
    for (const q of e.quote.split("\n")) lines.push(`> ${q}`);
    lines.push("");
  }
  const note = decodeDisplayText(e.body);
  lines.push(note.trim() === "" ? "_(no note)_" : note, "");
  return lines;
}

export function buildReviewPrompt(docPath: string, comments: ReconciledComment[]): string {
  const lines: string[] = [`# Penmark review — ${docPath}`, ""];

  if (comments.length === 0) {
    lines.push("No open comments.");
    return lines.join("\n") + "\n";
  }

  const rootIds = new Set(
    comments.filter((c) => c.entry.parentId === undefined).map((c) => c.entry.id),
  );
  const repliesOf = new Map<string, ReconciledComment[]>();
  const roots: ReconciledComment[] = [];
  const loose: ReconciledComment[] = [];
  for (const c of comments) {
    const parentId = c.entry.parentId;
    if (parentId === undefined) {
      roots.push(c);
      continue;
    }
    if (rootIds.has(parentId)) {
      const list = repliesOf.get(parentId) ?? [];
      list.push(c);
      repliesOf.set(parentId, list);
    } else {
      loose.push(c);
    }
  }

  const count = roots.length + loose.length;
  lines.push(
    `You are addressing reviewer comments on the markdown file above. ` +
      `There ${count === 1 ? "is" : "are"} ${count} open comment${count === 1 ? "" : "s"}. ` +
      `For each, the blockquote shows the passage it refers to, followed by the reviewer's note. ` +
      `Apply the requested changes to the file.`,
    "",
  );

  [...roots, ...loose].forEach((rc, i) => {
    const e = rc.entry;
    const orphanNote = rc.state === "orphan" ? " (location lost — quote only)" : "";
    lines.push(
      ...sectionLines(
        rc,
        `## ${i + 1}. ${e.author} (${e.provenance}) · ${e.timestamp}${orphanNote}`,
      ),
    );
    if (e.parentId !== undefined) return;
    for (const reply of repliesOf.get(e.id) ?? []) {
      const re = reply.entry;
      lines.push(
        ...sectionLines(reply, `### Reply — ${re.author} (${re.provenance}) · ${re.timestamp}`),
      );
    }
  });

  return lines.join("\n").trimEnd() + "\n";
}
