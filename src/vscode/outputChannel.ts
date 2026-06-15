/**
 * The lazy "Penmark" output channel (R8). Comment reconcile may detect document
 * corruption (a second `pmk:review` block, or the block not at EOF — spec §5.1,
 * §9). These are NON-actionable diagnostics: they are logged here, never toasted
 * (design §9 — a toast only for something the user can act on). The channel is
 * created on first use so a clean document never allocates it.
 */

import * as vscode from "vscode";
import type { ReconcileResult } from "../core/comments/reconcile.js";

let _channel: vscode.OutputChannel | undefined;

/** The "Penmark" output channel, created on first use and reused thereafter. */
export function penmarkOutput(): vscode.OutputChannel {
  _channel ??= vscode.window.createOutputChannel("Penmark");
  return _channel;
}

/**
 * Write a one-line diagnostic for each corruption signal reconcile reports.
 * Returns the number of lines written (0 — and no channel allocation — when the
 * document is clean). Never shows a toast (§9).
 */
export function logReconcileCorruption(docName: string, result: ReconcileResult): number {
  const notes: string[] = [];
  if (result.secondReviewBlock) {
    notes.push("more than one pmk:review block found — only the first is authoritative (§5.1)");
  }
  if (result.reviewBlockMisplaced) {
    notes.push("pmk:review block is not at end of file — it will relocate on the next edit (§5.1)");
  }
  if (notes.length === 0) return 0;

  const channel = penmarkOutput();
  const ts = new Date().toISOString();
  for (const note of notes) channel.appendLine(`[${ts}] ${docName}: ${note}`);
  return notes.length;
}
