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

import type { ReconciledComment } from "./reconcile.js";

/**
 * Build the agent-ready review prompt for `docPath`'s open `comments` (the live
 * entries from reconcile, in document order). Returns a markdown string ending
 * in a single newline.
 */
export function buildReviewPrompt(docPath: string, comments: ReconciledComment[]): string {
  const lines: string[] = [`# Penmark review — ${docPath}`, ""];

  if (comments.length === 0) {
    lines.push("No open comments.");
    return lines.join("\n") + "\n";
  }

  const count = comments.length;
  lines.push(
    `You are addressing reviewer comments on the markdown file above. ` +
      `There ${count === 1 ? "is" : "are"} ${count} open comment${count === 1 ? "" : "s"}. ` +
      `For each, the blockquote shows the passage it refers to, followed by the reviewer's note. ` +
      `Apply the requested changes to the file.`,
    "",
  );

  comments.forEach((rc, i) => {
    const e = rc.entry;
    const orphanNote = rc.state === "orphan" ? " (location lost — quote only)" : "";
    lines.push(`## ${i + 1}. ${e.author} (${e.provenance}) · ${e.timestamp}${orphanNote}`, "");
    if (e.quote !== "") {
      for (const q of e.quote.split("\n")) lines.push(`> ${q}`);
      lines.push("");
    }
    // A comment may carry only a quote (empty body); show a placeholder so the
    // section is never a numbered comment with no visible instruction.
    lines.push(e.body.trim() === "" ? "_(no note)_" : e.body, "");
  });

  return lines.join("\n").trimEnd() + "\n";
}
