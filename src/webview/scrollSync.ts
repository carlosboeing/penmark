/**
 * Scroll-sync mapping math (T10).
 *
 * Maps between source line numbers and the webview's scrollTop using the
 * `data-pmk-offset="START:END"` attributes stamped on every rendered block
 * (ADR 0005; END is exclusive). The core math is PURE — it operates over a
 * `BlockGeometry[]` snapshot, never the DOM — so the jsdom tests can feed
 * synthetic geometry. Only `readBlocks` touches the DOM.
 *
 * ADR 0001: no vscode imports — browser-only module.
 */

/** Layout snapshot of a single rendered block. */
export interface BlockGeometry {
  /** 0-based source line where the block starts (inclusive). */
  startLine: number;
  /** 0-based source line where the block ends (exclusive). */
  endLine: number;
  /** The block's offsetTop within the scroll container, in pixels. */
  offsetTop: number;
  /** The block's rendered height, in pixels. */
  offsetHeight: number;
}

/**
 * Binary-search for the index of the last block whose `startLine <= line`.
 * Returns -1 when `line` is before the first block.
 */
function findBlockIndexForLine(line: number, blocks: BlockGeometry[]): number {
  let lo = 0;
  let hi = blocks.length - 1;
  let result = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const block = blocks[mid]!;
    if (block.startLine <= line) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
}

/**
 * Binary-search for the index of the last block whose `offsetTop <= scrollTop`.
 * Returns -1 when `scrollTop` is above the first block.
 */
function findBlockIndexForScrollTop(scrollTop: number, blocks: BlockGeometry[]): number {
  let lo = 0;
  let hi = blocks.length - 1;
  let result = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const block = blocks[mid]!;
    if (block.offsetTop <= scrollTop) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
}

/**
 * Map a source line to a scrollTop within the scroll container.
 *
 * Blocks must be sorted by `startLine` (document order, which `readBlocks`
 * guarantees). A line inside a block interpolates linearly between the block's
 * `offsetTop` and its bottom, proportional to `(line - start)/(end - start)`.
 * A line in the gap between two blocks snaps to the next block's top. Lines
 * before the first block clamp to 0 and lines past the last block clamp to the
 * last block's bottom.
 */
export function lineToScrollTop(line: number, blocks: BlockGeometry[]): number {
  if (blocks.length === 0) return 0;

  const idx = findBlockIndexForLine(line, blocks);
  if (idx === -1) return 0; // before the first block

  const block = blocks[idx]!;

  // Line inside this block — interpolate within [offsetTop, offsetTop+height].
  if (line < block.endLine) {
    const span = block.endLine - block.startLine;
    if (span <= 0) return block.offsetTop;
    const frac = (line - block.startLine) / span;
    return block.offsetTop + frac * block.offsetHeight;
  }

  // Line is at/after this block's end. If a following block exists and the line
  // falls in the gap before it, snap to that block's top.
  const next = blocks[idx + 1];
  if (next) return next.offsetTop;

  // Past the last block — clamp to its bottom.
  return block.offsetTop + block.offsetHeight;
}

/**
 * Inverse of {@link lineToScrollTop}: map a scrollTop to the source line at the
 * top of the viewport. Finds the block whose `[offsetTop, offsetTop+height)`
 * extent contains `scrollTop`, then interpolates the source line within it.
 * Clamps at both edges.
 */
export function scrollTopToLine(scrollTop: number, blocks: BlockGeometry[]): number {
  if (blocks.length === 0) return 0;

  const idx = findBlockIndexForScrollTop(scrollTop, blocks);
  if (idx === -1) return blocks[0]!.startLine; // above the first block

  const block = blocks[idx]!;
  const span = block.endLine - block.startLine;

  // Within this block's vertical extent — interpolate the line.
  if (scrollTop < block.offsetTop + block.offsetHeight) {
    if (block.offsetHeight <= 0 || span <= 0) return block.startLine;
    const frac = (scrollTop - block.offsetTop) / block.offsetHeight;
    return block.startLine + frac * span;
  }

  // At/below this block's bottom. If a following block exists, the next call's
  // binary search would have found it; reaching here with a next block means
  // scrollTop sits in the gap before it, so snap to that block's start line.
  const next = blocks[idx + 1];
  if (next) return next.startLine;

  // Past the last block — clamp to its end line.
  return block.endLine;
}

/**
 * Extract a sorted-by-document-order {@link BlockGeometry} snapshot from every
 * `[data-pmk-offset]` element under `root`. Elements with a malformed offset
 * attribute are skipped. This is the only DOM-touching function here.
 */
export function readBlocks(root: HTMLElement): BlockGeometry[] {
  const blocks: BlockGeometry[] = [];
  const els = root.querySelectorAll<HTMLElement>("[data-pmk-offset]");
  for (const el of els) {
    const raw = el.getAttribute("data-pmk-offset") ?? "";
    const [startStr, endStr] = raw.split(":");
    const startLine = Number.parseInt(startStr ?? "", 10);
    const endLine = Number.parseInt(endStr ?? "", 10);
    if (Number.isNaN(startLine) || Number.isNaN(endLine)) continue;
    blocks.push({
      startLine,
      endLine,
      offsetTop: el.offsetTop,
      offsetHeight: el.offsetHeight,
    });
  }
  return blocks;
}
