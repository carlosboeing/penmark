/**
 * Host-side comment operations (R7) — the thin `vscode` glue that turns a
 * webview mutation request into offset edits applied as ONE `WorkspaceEdit`
 * (one undo step, §7.1), and stamps author identity + timestamp (D14, §5.2.1).
 *
 * The edit MATH is pure and lives in src/core/comments (parser, placement,
 * serializer); this module orchestrates it and adapts to the vscode API. It is
 * deliberately free of any markdown-it import so it adds nothing to activation
 * cost or the bundle — the caller injects a `tokenize` function (the renderer's
 * block tokenizer, lazily loaded with the render module).
 *
 * THE OFFSET-BASE SEAM (R4 carry-forward): src/vscode/render.ts strips leading
 * frontmatter before markdown-it, so the webview's `data-pmk-offset` line map —
 * and therefore the selection offsets R10 derives from it — are relative to the
 * STRIPPED BODY. {@link planAddComment} rebases that body-relative range to RAW
 * SOURCE coordinates (adding the frontmatter prefix length) and does all parse /
 * place / serialize work in source coordinates, so the WorkspaceEdit positions
 * line up with the actual document. The contract: `range` IS body-relative.
 */

import { execFileSync } from "node:child_process";
import * as vscode from "vscode";
import { freshId } from "../core/comments/ids.js";
import { parseDoc } from "../core/comments/parser.js";
import { buildBlockMap, planAnchor } from "../core/comments/placement.js";
import { reconcile } from "../core/comments/reconcile.js";
import type { ReconciledComment, ReconcileResult } from "../core/comments/reconcile.js";
import type { NewComment, TextEdit } from "../core/comments/serializer.js";
import { buildAddCommentEdits, buildResolveCommentEdits } from "../core/comments/serializer.js";
import type { ParsedDoc } from "../core/comments/types.js";
import type { WireComment, WireExtent } from "../core/protocol/messages.js";
import { stripFrontmatter } from "../core/render/frontmatter.js";

/** A block's source line range + normalized type — the renderer's tokenizer shape. */
export interface BlockOffset {
  line0: number;
  line1: number;
  type: string;
}

// ---------------------------------------------------------------------------
// Author identity + timestamp (D14, §5.2.1) — pure where possible
// ---------------------------------------------------------------------------

/**
 * Format `d` as the §5.2.1 entry timestamp `YYYY-MM-DD HH:MM ±HH:MM`, using the
 * local clock and local UTC offset (the sign is `+` for offsets ahead of UTC).
 */
export function nowTimestamp(d: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  const offsetMin = -d.getTimezoneOffset(); // minutes ahead of UTC (AEST → +600)
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())} ` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/**
 * Author precedence (D14): a non-empty `penmark.comments.authorName` setting,
 * else the git `user.name`, else `"unknown"`. Pure so the precedence is unit
 * tested without vscode/git.
 */
export function pickAuthor(setting: string | undefined, gitName: string | undefined): string {
  const s = setting?.trim();
  if (s) return s;
  const g = gitName?.trim();
  if (g) return g;
  return "unknown";
}

let _gitName: { value: string | undefined } | undefined;

/**
 * `git config user.name`, cached per session once it RESOLVES (a real name, or a
 * clean "git ran but the name is unset"). A thrown error — most importantly the
 * 1s timeout on a momentarily slow/locked git, but also git being transiently
 * unavailable — is NOT cached, so a later add retries instead of poisoning the
 * author as "unknown" for the rest of the session. A genuinely absent git just
 * re-spawns cheaply on the next (rare) add.
 */
function gitUserName(): string | undefined {
  if (_gitName !== undefined) return _gitName.value;
  try {
    const out = execFileSync("git", ["config", "user.name"], {
      encoding: "utf8",
      timeout: 1000,
    }).trim();
    _gitName = { value: out === "" ? undefined : out };
    return _gitName.value;
  } catch {
    return undefined;
  }
}

/** Resolve the comment author from settings → git → "unknown" (D14). */
export function resolveAuthor(): string {
  const setting = vscode.workspace.getConfiguration("penmark").get<string>("comments.authorName");
  return pickAuthor(setting, gitUserName());
}

// ---------------------------------------------------------------------------
// Edit planning (pure orchestration over src/core/comments)
// ---------------------------------------------------------------------------

/** Every id taken in the document (anchor ids ∪ entry ids), for `freshId`. */
export function existingIds(doc: ParsedDoc): Set<string> {
  const ids = new Set<string>(doc.anchors.keys());
  for (const e of doc.entries) ids.add(e.id);
  return ids;
}

export interface AddCommentInput {
  /** Raw document source (the text the WorkspaceEdit will mutate). */
  source: string;
  /** Selection as BODY-relative char offsets (see the offset-base seam above). */
  range: { start: number; end: number };
  /** Selected source text, stored as the advisory quote (raw, un-encoded). */
  quote: string;
  /** Comment body prose (raw, un-encoded). */
  body: string;
  /** Resolved author (resolveAuthor) and §5.2.1 timestamp (nowTimestamp). */
  author: string;
  timestamp: string;
  /** Renderer block tokenizer (injected to keep markdown-it out of this module). */
  tokenize: (source: string) => BlockOffset[];
}

export type AddPlan = { edits: TextEdit[] } | { uncommentable: true };

/**
 * Plan the edits to add a comment for `input.range`. Rebases the body-relative
 * range to source coordinates, classifies the anchor (R4), mints a fresh id and
 * builds the add edits (R3). Returns `{ uncommentable: true }` when the selection
 * cannot carry an anchor (frontmatter / link-ref / blank gap, §4.1).
 */
export function planAddComment(input: AddCommentInput): AddPlan {
  const { source, range, quote, body, author, timestamp, tokenize } = input;
  const { body: strippedBody } = stripFrontmatter(source);
  const frontmatterLen = source.length - strippedBody.length;
  const srcRange = { start: range.start + frontmatterLen, end: range.end + frontmatterLen };

  const doc = parseDoc(source);
  const blockMap = buildBlockMap(source, tokenize(source));
  const placement = planAnchor(source, srcRange, blockMap, quote);
  if ("uncommentable" in placement) return { uncommentable: true };

  const id = freshId(existingIds(doc));
  const c: NewComment = { placement, author, provenance: "human", timestamp, quote, body, id };
  return { edits: buildAddCommentEdits(source, doc, c) };
}

/** Plan the edits to resolve (= delete) the comment `id` from `source` (R3). */
export function planResolveComment(source: string, id: string): TextEdit[] {
  return buildResolveCommentEdits(source, parseDoc(source), id);
}

// ---------------------------------------------------------------------------
// Reconcile → wire payload (R8) — pure, read-only (no vscode, no edits)
// ---------------------------------------------------------------------------

/** The webview render payload's comment half, plus the raw reconcile result. */
export interface CommentAnalysis {
  /** Wire-shaped comments for the webview (drawer/popover/highlights). */
  comments: WireComment[];
  /** Attention-chip count (needs-attention + corruption signals, §8). */
  attention: number;
  /** Full reconcile result — the host uses its corruption flags for logging. */
  result: ReconcileResult;
}

/** A clean, comment-free reconcile result (the no-markers fast path). */
const EMPTY_RECONCILE: ReconcileResult = {
  comments: [],
  needsAttention: [],
  strayClosers: [],
  reviewBlockMisplaced: false,
  secondReviewBlock: false,
  attentionCount: 0,
};

/** Line + 0-based column of `offset` within `text` (counts `\n`). */
function charToLineCol(text: string, offset: number): { line: number; col: number } {
  const clamped = Math.max(0, Math.min(offset, text.length));
  let line = 0;
  let lastNl = -1;
  for (let i = 0; i < clamped; i++) {
    if (text.charAt(i) === "\n") {
      line++;
      lastNl = i;
    }
  }
  return { line, col: clamped - lastNl - 1 };
}

/**
 * Resolve a reconciled comment's highlight extent into webview (BODY-relative)
 * line/col coordinates — the base the rendered DOM uses (frontmatter is stripped
 * before markdown-it, so `data-pmk-offset` and the selection R10 derives are
 * body-relative). Returns `null` for orphan / content-removed comments, which
 * have no live span to highlight (§8).
 */
function toWireExtent(
  body: string,
  frontmatterLen: number,
  rc: ReconciledComment,
): WireExtent | null {
  if (rc.state === "orphan" || rc.state === "content-removed" || rc.extent === undefined) {
    return null;
  }
  const start = charToLineCol(body, rc.extent.start - frontmatterLen);
  const end = charToLineCol(body, rc.extent.end - frontmatterLen);
  return { startLine: start.line, startCol: start.col, endLine: end.line, endCol: end.col };
}

/**
 * Classify `source`'s comments against the current document (R5 reconcile) and
 * flatten them into the webview wire shape (R8). Pure and read-only — it never
 * applies a `WorkspaceEdit`; opening a document only ever reads it. The caller
 * (postRender) feeds `comments`/`attention` into the render payload and logs the
 * corruption flags in `result` to the output channel.
 */
export function analyzeComments(source: string): CommentAnalysis {
  // Fast path: every comment artifact (anchors `pmk:s/b/r/c`, the `pmk:review`
  // block) contains the substring "pmk:". A document without it has no comments,
  // so skip the full parse + reconcile on the render hot path — the common case
  // for a doc the user has not commented on yet (design §8 latency budget).
  if (!source.includes("pmk:")) {
    return { comments: [], attention: 0, result: EMPTY_RECONCILE };
  }

  const doc = parseDoc(source);
  const result = reconcile(source, doc);
  const { body } = stripFrontmatter(source);
  const frontmatterLen = source.length - body.length;

  const comments: WireComment[] = result.comments.map((rc) => ({
    id: rc.entry.id,
    state: rc.state,
    provenance: rc.entry.provenance,
    author: rc.entry.author,
    timestamp: rc.entry.timestamp,
    quote: rc.entry.quote,
    body: rc.entry.body,
    extent: toWireExtent(body, frontmatterLen, rc),
  }));

  return { comments, attention: result.attentionCount, result };
}

// ---------------------------------------------------------------------------
// vscode adaptation
// ---------------------------------------------------------------------------

/**
 * Convert offset splices into a single {@link vscode.WorkspaceEdit} via
 * `doc.positionAt`, so the host applies the whole add/resolve as one undo step
 * (§7.1). Order is preserved; vscode resolves the splice positions against the
 * pre-edit document, so independent offset edits compose correctly.
 */
export function offsetEditsToWorkspaceEdit(
  uri: vscode.Uri,
  doc: vscode.TextDocument,
  edits: TextEdit[],
): vscode.WorkspaceEdit {
  const we = new vscode.WorkspaceEdit();
  for (const e of edits) {
    const range = new vscode.Range(doc.positionAt(e.start), doc.positionAt(e.end));
    we.replace(uri, range, e.newText);
  }
  return we;
}
