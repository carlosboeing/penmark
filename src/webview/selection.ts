/**
 * Map a rendered-DOM selection to a source character range (R10).
 *
 * THE SPLIT (design §5.2 step 4): the host owns the authoritative source text.
 * Each top-level block carries `data-pmk-coff` — the char offset of the block's
 * first line in the (frontmatter-stripped) source body (stamped by the renderer,
 * src/core/render/offsets.ts). The webview adds the WITHIN-BLOCK character offset
 * (measured from the rendered text via a DOM Range) to that base to get an
 * absolute body char offset — the coordinate the host add-comment path consumes
 * (R7 rebases it past any frontmatter and snaps it to a valid anchor, R4).
 *
 * PRECISION (v0.5, deliberately simple — design "keep the webview side simple"):
 * the within-block offset is rendered-text length, which equals source length
 * ONLY where the source has no dropped characters before the selection. It is
 * therefore exact for plain prose with no inline markup; it under-counts by the
 * source delta wherever the rendered text drops source characters — block
 * prefixes (`## `, `- `, `> `), inline markup (`**b**`->`b`, `[t](u)`->`t`,
 * `` `c` ``->`c`), and HTML entities (`&amp;`->`&`). The resulting absolute
 * offset is therefore APPROXIMATE for marked-up prose.
 *
 * This is safe, not corrupting: the host's `planAnchor`/`snapSpan` (R4) is a
 * total guardrail — any offset resolves to an uncommentable rejection, a block
 * anchor, or a span snapped to inline-SAFE boundaries (never a marker that
 * splits markup), so the document always stays well-formed. The stored quote is
 * advisory, and the selection snap-preview shows the user a pixel-accurate
 * extent from live client rects regardless of this offset. The cost is that a
 * persisted anchor on marked-up prose may cover a slightly different span than
 * selected. Exact per-text-node source mapping is a tracked post-v0.5 refinement
 * (see docs/ROADMAP.md).
 */

/** The nearest ancestor of `node` (within `root`) that carries `data-pmk-coff`. */
function blockOf(node: Node, root: HTMLElement): HTMLElement | null {
  if (!root.contains(node)) return null;
  let el: HTMLElement | null =
    node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement;
  while (el && root.contains(el)) {
    if (el.hasAttribute("data-pmk-coff")) return el;
    el = el.parentElement;
  }
  return null;
}

/** The block's source char base, or null when the attribute is missing/invalid. */
function coffOf(block: HTMLElement): number | null {
  const raw = block.getAttribute("data-pmk-coff");
  if (raw === null) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isNaN(n) ? null : n;
}

/** Rendered-text length from the start of `block` up to (`container`, `offset`). */
function charOffsetWithin(block: HTMLElement, container: Node, offset: number): number {
  const r = block.ownerDocument.createRange();
  r.selectNodeContents(block);
  r.setEnd(container, offset);
  return r.toString().length;
}

/**
 * Map `sel` to an absolute source char range `{ start, end }` (body coordinates),
 * or `null` when the selection is empty, collapsed, or not anchored in rendered
 * content (e.g. the top bar, which carries no `data-pmk-coff`). A selection that
 * spans two blocks returns the union range (first block start → last block end);
 * the host decides whether that becomes a block or multi-block range anchor.
 */
export function selectionToSourceRange(
  sel: Selection,
  root: HTMLElement,
): { start: number; end: number } | null {
  if (sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (range.collapsed) return null;

  const startBlock = blockOf(range.startContainer, root);
  const endBlock = blockOf(range.endContainer, root);
  if (!startBlock || !endBlock) return null;

  const startCoff = coffOf(startBlock);
  const endCoff = coffOf(endBlock);
  if (startCoff === null || endCoff === null) return null;

  const start = startCoff + charOffsetWithin(startBlock, range.startContainer, range.startOffset);
  const end = endCoff + charOffsetWithin(endBlock, range.endContainer, range.endOffset);
  if (end <= start) return null;

  return { start, end };
}
