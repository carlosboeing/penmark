/**
 * Plan comment writes for the `penmark` command. Pure: text in, text or a
 * refusal out. The process checks the file hash and performs the write.
 *
 * Quote comparison uses the same whitespace-run rule as `recoverByQuote` in
 * reconcile.ts: trim, split on whitespace, match tokens in order,
 * case-sensitive. The two stay aligned. The helper there stays private.
 */

import { freshId } from "./ids.js";
import { buildBlockMap, planAnchor, type AnchorPlacement, type SourceRange } from "./placement.js";
import { parseDoc } from "./parser.js";
import { reconcile, type ReconciledComment } from "./reconcile.js";
import {
  buildAddCommentEdits,
  buildAddReplyEdits,
  buildResolveCommentEdits,
  type NewComment,
  type TextEdit,
} from "./serializer.js";
import { buildReviewPrompt } from "./exportPrompt.js";
import type { ParsedDoc } from "./types.js";
import { tokenizeBlockOffsets } from "../render/markdown.js";

export interface Finding {
  quote: string;
  body: string;
  start?: number;
  end?: number;
}

export interface PlanOptions {
  author: string;
  provenance: "human" | "agent";
  /** Fixed by the caller so tests do not depend on the clock. */
  timestamp: string;
}

export type ApplyAction = "placed" | "replied" | "skipped" | "rejected";

export type RejectionReason =
  | "ambiguous-quote"
  | "no-match"
  | "uncommentable"
  | "duplicate-roots"
  | "reply-to-reply"
  | "empty-body"
  | "bad-range";

export interface QuoteMatch {
  start: number;
  end: number;
  excerpt: string;
}

export interface ApplyResult {
  quote: string;
  action: ApplyAction;
  id?: string;
  reason?: RejectionReason;
  matches?: QuoteMatch[];
  ids?: string[];
}

export interface PlanResult {
  /** Next document text when a write should happen. Null means leave the file. */
  text: string | null;
  results: ApplyResult[];
  code: 0 | 2 | 4;
  corruption?: string;
}

const MATCH_CAP = 20;
const EXCERPT_CAP = 120;

export function planFindings(text: string, findings: Finding[], opts: PlanOptions): PlanResult {
  const corruption = reviewCorruption(text);
  if (corruption !== null) {
    return { text: null, results: [], code: 4, corruption };
  }

  let scratch = text;
  const results: ApplyResult[] = [];
  let rejected = false;
  // Explicit start/end are indexes into the original file. Insertions from
  // earlier findings in this batch shift the scratch, so map those indexes
  // forward before planning the next one.
  const insertions: { at: number; len: number }[] = [];
  const toScratch = (originalIndex: number): number => {
    let extra = 0;
    for (const ins of insertions) {
      if (ins.at <= originalIndex) extra += ins.len;
    }
    return originalIndex + extra;
  };
  const toOriginal = (scratchIndex: number): number => {
    const ordered = [...insertions].sort((a, b) => a.at - b.at);
    let extra = 0;
    for (const ins of ordered) {
      if (ins.at + extra < scratchIndex) extra += ins.len;
      else break;
    }
    return scratchIndex - extra;
  };
  const noteEdits = (edits: TextEdit[]): void => {
    const notes = edits.map((edit) => ({
      at: toOriginal(edit.start),
      len: edit.newText.length - (edit.end - edit.start),
    }));
    for (const note of notes) {
      if (note.len !== 0) insertions.push(note);
    }
  };

  for (const finding of findings) {
    const explicit = finding.start !== undefined && finding.end !== undefined;
    const step =
      explicit &&
      (!isIndex(finding.start, text.length) ||
        !isIndex(finding.end, text.length) ||
        finding.start! > finding.end!)
        ? stop(reject(finding.quote, "bad-range"))
        : planOne(
            scratch,
            explicit
              ? { ...finding, start: toScratch(finding.start!), end: toScratch(finding.end!) }
              : finding,
            opts,
            explicit ? text.slice(finding.start!, finding.end!) : undefined,
          );
    results.push(step.result);
    if (step.result.action === "rejected") {
      rejected = true;
      continue;
    }
    if (step.next !== null) {
      noteEdits(step.edits);
      scratch = step.next;
    }
  }

  if (rejected) return { text: null, results, code: 2 };
  const changed = results.some((r) => r.action === "placed" || r.action === "replied");
  return { text: changed ? scratch : null, results, code: 0 };
}

export function locateQuote(text: string, quote: string): { matches: QuoteMatch[]; truncated: boolean } {
  const doc = parseDoc(text);
  const end = doc.review?.start ?? text.length;
  const all = findMatches(text, quote, end);
  return { matches: all.slice(0, MATCH_CAP), truncated: all.length > MATCH_CAP };
}

export function validateText(text: string):
  | { ok: true; orphans: string[] }
  | { ok: false; corruption: string } {
  const corruption = reviewCorruption(text);
  if (corruption !== null) return { ok: false, corruption };
  const result = reconcile(text, parseDoc(text));
  const orphans = result.comments.filter((c) => c.state === "orphan").map((c) => c.entry.id);
  return { ok: true, orphans };
}

export interface ListedComment {
  id: string;
  parentId: string | null;
  state: string;
  quote: string;
  body: string;
  author: string;
  provenance: string;
}

export function listComments(text: string): { comments: ListedComment[] } | { corruption: string } {
  const corruption = reviewCorruption(text);
  if (corruption !== null) return { corruption };
  const result = reconcile(text, parseDoc(text));
  return {
    comments: result.comments.map((c) => ({
      id: c.entry.id,
      parentId: c.entry.parentId ?? null,
      state: c.state,
      quote: c.entry.quote,
      body: c.entry.body,
      author: c.entry.author,
      provenance: c.entry.provenance,
    })),
  };
}

export function planResolve(
  text: string,
  id: string,
): { text: string | null; removed: string[]; code: 0 | 2 | 4; corruption?: string } {
  const corruption = reviewCorruption(text);
  if (corruption !== null) return { text: null, removed: [], code: 4, corruption };
  const doc = parseDoc(text);
  const target = doc.entries.find((e) => e.id === id);
  const anchor = doc.anchors.get(id);
  if (target === undefined && anchor === undefined) {
    return { text: null, removed: [], code: 2 };
  }
  const childIds =
    target !== undefined && target.parentId === undefined
      ? doc.entries.filter((e) => e.parentId === id).map((e) => e.id)
      : [];
  const removed = target !== undefined ? [id, ...childIds] : [id];
  const edits = buildResolveCommentEdits(text, doc, id);
  if (edits.length === 0) return { text: null, removed: [], code: 2 };
  return { text: applyEdits(text, edits), removed, code: 0 };
}

export function reviewPrompt(text: string, docPath: string): { prompt: string } | { corruption: string } {
  const corruption = reviewCorruption(text);
  if (corruption !== null) return { corruption };
  return { prompt: buildReviewPrompt(docPath, reconcile(text, parseDoc(text)).comments) };
}

function reviewCorruption(text: string): string | null {
  const doc = parseDoc(text);
  const result = reconcile(text, doc);
  if (result.secondReviewBlock) return "secondReviewBlock";
  if (result.unreadableReviewData.length > 0) {
    return result.unreadableReviewData.map((c) => c.rule).join(",");
  }
  return null;
}

function planOne(
  text: string,
  finding: Finding,
  opts: PlanOptions,
  needle?: string,
): PlannedStep {
  const quote = finding.quote;
  if (finding.body.trim() === "") return stop(reject(quote, "empty-body"));
  if (quote.trim() === "") return stop(reject(quote, "no-match"));

  const hasStart = finding.start !== undefined;
  const hasEnd = finding.end !== undefined;
  if (hasStart !== hasEnd) return stop(reject(quote, "bad-range"));
  if (
    hasStart &&
    hasEnd &&
    (!isIndex(finding.start, text.length) ||
      !isIndex(finding.end, text.length) ||
      finding.start! > finding.end!)
  ) {
    return stop(reject(quote, "bad-range"));
  }

  const doc = parseDoc(text);
  const comments = reconcile(text, doc).comments;

  if (hasStart && hasEnd) {
    const range = { start: finding.start!, end: finding.end! };
    const roots = matchingRoots(text, comments, needle ?? text.slice(range.start, range.end));
    if (roots.length >= 2) return stop(reject(quote, "duplicate-roots", { ids: idsOf(roots) }));
    if (roots.length === 1) return replyTo(text, doc, comments, roots[0]!, finding, opts);
    return place(text, doc, range, finding, opts);
  }

  const roots = matchingRoots(text, comments, quote);
  if (roots.length >= 2) return stop(reject(quote, "duplicate-roots", { ids: idsOf(roots) }));
  if (roots.length === 1) return replyTo(text, doc, comments, roots[0]!, finding, opts);

  const matches = findMatches(text, quote, doc.review?.start ?? text.length);
  if (matches.length === 0) return stop(reject(quote, "no-match"));
  if (matches.length > 1) {
    return stop(reject(quote, "ambiguous-quote", { matches: matches.slice(0, MATCH_CAP) }));
  }
  const only = matches[0]!;
  return place(text, doc, { start: only.start, end: only.end }, finding, opts);
}

function replyTo(
  text: string,
  doc: ParsedDoc,
  comments: ReconciledComment[],
  root: ReconciledComment,
  finding: Finding,
  opts: PlanOptions,
): PlannedStep {
  if (root.entry.parentId !== undefined) {
    return stop(reject(finding.quote, "reply-to-reply", { ids: [root.entry.id] }));
  }
  const bodyKey = normalizeWs(finding.body);
  const already =
    normalizeWs(root.entry.body) === bodyKey ||
    comments.some((c) => c.entry.parentId === root.entry.id && normalizeWs(c.entry.body) === bodyKey);
  if (already) {
    return { result: { quote: finding.quote, action: "skipped", id: root.entry.id }, next: null, edits: [] };
  }

  const id = freshId(takenIds(doc));
  const comment: NewComment = {
    placement: { kind: "span", range: { start: 0, end: 0 } },
    author: opts.author,
    provenance: opts.provenance,
    timestamp: opts.timestamp,
    quote: finding.quote,
    body: finding.body,
    id,
    parentId: root.entry.id,
  };
  const edits = buildAddReplyEdits(text, doc, comment);
  const next = applyEdits(text, edits);
  return { result: { quote: finding.quote, action: "replied", id }, next, edits };
}

function place(
  text: string,
  doc: ParsedDoc,
  range: SourceRange,
  finding: Finding,
  opts: PlanOptions,
): PlannedStep {
  const placement = planAnchor(text, range, buildBlockMap(text, tokenizeBlockOffsets(text)), finding.quote);
  if (!isPlacement(placement)) return stop(reject(finding.quote, "uncommentable"));
  const id = freshId(takenIds(doc));
  const comment: NewComment = {
    placement,
    author: opts.author,
    provenance: opts.provenance,
    timestamp: opts.timestamp,
    quote: finding.quote,
    body: finding.body,
    id,
  };
  const edits = buildAddCommentEdits(text, doc, comment);
  const next = applyEdits(text, edits);
  return { result: { quote: finding.quote, action: "placed", id }, next, edits };
}

function matchingRoots(text: string, comments: ReconciledComment[], needle: string): ReconciledComment[] {
  const key = normalizeWs(needle);
  if (key === "") return [];
  return comments.filter((c) => {
    if (c.entry.parentId !== undefined || c.state === "orphan") return false;
    return matchTexts(text, c).some((candidate) => normalizeWs(candidate) === key);
  });
}

function matchTexts(text: string, comment: ReconciledComment): string[] {
  const out: string[] = [];
  if (comment.state !== "content-removed" && comment.extent !== undefined) {
    out.push(text.slice(comment.extent.start, comment.extent.end));
  }
  if (comment.entry.quote !== "") out.push(comment.entry.quote);
  return out;
}

function findMatches(text: string, quote: string, searchEnd: number): QuoteMatch[] {
  const re = quoteRegExp(quote);
  if (re === null) return [];
  const matches: QuoteMatch[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index >= searchEnd) break;
    const start = m.index;
    const end = start + m[0].length;
    if (end > searchEnd) continue;
    const raw = m[0];
    matches.push({
      start,
      end,
      excerpt: raw.length <= EXCERPT_CAP ? raw : raw.slice(0, EXCERPT_CAP),
    });
    if (m[0].length === 0) re.lastIndex++;
  }
  return matches;
}

function quoteTokens(quote: string): string[] {
  const trimmed = quote.trim();
  if (trimmed === "") return [];
  return trimmed.split(/\s+/);
}

function normalizeWs(value: string): string {
  return quoteTokens(value).join(" ");
}

function quoteRegExp(quote: string): RegExp | null {
  const tokens = quoteTokens(quote);
  if (tokens.length === 0) return null;
  return new RegExp(tokens.map(escapeRegExp).join("\\s+"), "g");
}

function escapeRegExp(token: string): string {
  return token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isIndex(value: number | undefined, length: number): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= length;
}

function isPlacement(value: AnchorPlacement | { uncommentable: true }): value is AnchorPlacement {
  return !("uncommentable" in value);
}

function takenIds(doc: ParsedDoc): Set<string> {
  const ids = new Set<string>(doc.anchors.keys());
  for (const entry of doc.entries) ids.add(entry.id);
  return ids;
}

function idsOf(comments: ReconciledComment[]): string[] {
  return comments.map((c) => c.entry.id);
}

function reject(
  quote: string,
  reason: RejectionReason,
  extra?: { matches?: QuoteMatch[]; ids?: string[] },
): ApplyResult {
  const result: ApplyResult = { quote, action: "rejected", reason };
  if (extra?.matches !== undefined) result.matches = extra.matches;
  if (extra?.ids !== undefined) result.ids = extra.ids;
  return result;
}

interface PlannedStep {
  result: ApplyResult;
  next: string | null;
  edits: TextEdit[];
}

function stop(result: ApplyResult): PlannedStep {
  return { result, next: null, edits: [] };
}

function applyEdits(text: string, edits: TextEdit[]): string {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  let out = text;
  for (const edit of sorted) {
    out = out.slice(0, edit.start) + edit.newText + out.slice(edit.end);
  }
  return out;
}
