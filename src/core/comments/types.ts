/**
 * Canonical parsed model for the Penmark comment format (spec §3–§9).
 *
 * These types are the shared vocabulary for every consumer of the parser
 * (reconcile engine, writer, drawer UI). Later tasks import these names
 * verbatim — do not rename.
 */

/** Anchor kind (spec §4): inline span pair, whole-block, or block-run range. */
export type AnchorKind = "span" | "block" | "range";

/** Who authored an entry (spec §5.2.1 provenance tag). */
export type Provenance = "human" | "agent";

/**
 * Reconcile state of a comment (spec §8). The parser does NOT compute these —
 * the reconcile engine applies the degradation ladder.
 */
export type CommentState = "intact" | "content-removed" | "degraded-recovered" | "orphan";

/**
 * A live anchor marker (or pair) found in the document body.
 */
export interface ParsedAnchor {
  id: string;
  kind: AnchorKind;
  openerStart: number;
  openerEnd: number;
  closerStart?: number;
  closerEnd?: number;
  extentStart?: number;
  extentEnd?: number;
  /** Block (§4.2): true iff the marker is the only non-whitespace on its line. */
  blockMarkerLineOwnLine?: boolean;
}

/** One parsed review-block entry (spec §5.2). Quote and body are decoded. */
export interface ParsedEntry {
  id: string;
  author: string;
  provenance: Provenance;
  /** Raw timestamp text, validated against the §5.2.1 shape. */
  timestamp: string;
  /** Decoded advisory quote; multiple `> ` lines joined with "\n". */
  quote: string;
  /** Decoded body prose. */
  body: string;
  /** v2 reply parent (` re <id>` on line 1); parsed-but-ignored in v1 (§5.3). */
  parentId?: string;
  rawStart: number;
  rawEnd: number;
  /** Parsed from a non-EOF review block; surfaced in needs-attention (§8.5). */
  fromExtraReviewBlock?: boolean;
}

/**
 * One corruption finding (spec §9). `rule` is a stable spec-section key
 * (see the RULE constants in parser.ts); `detail` is human context;
 * `index` is the char offset of the offending construct.
 */
export interface CorruptionItem {
  rule: string;
  detail: string;
  index: number;
}

/** Location of the review block (spec §5.1). */
export interface ReviewBlockInfo {
  start: number;
  end: number;
  /** True iff nothing but whitespace follows the closing delimiter (§5.1). */
  atEof: boolean;
}

/** The full parse result for a document. */
export interface ParsedDoc {
  /** Live anchors keyed by id (kind disambiguates; 1:1 with entries in v1). */
  anchors: Map<string, ParsedAnchor>;
  /** Entries in append order. */
  entries: ParsedEntry[];
  /** Review block info, or null when the document has no review block. */
  review: ReviewBlockInfo | null;
  /** How many `<!-- pmk:review v1 -->` headers were seen. */
  reviewCount: number;
  /** Corruption findings (§9); never throws, always present (may be empty). */
  corruption: CorruptionItem[];
}
