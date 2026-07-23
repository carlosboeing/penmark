/**
 * Transient, in-preview text search decoration.
 *
 * Search never crosses text-node boundaries. In particular, that keeps matches
 * from spanning comment-anchor wrappers (`[data-pmk-id]`), so the persisted
 * anchor structure remains intact while the decorations are present.
 */

import { prefersReducedMotion } from "./motion.js";

/** Limits synchronous decoration work on exceptionally large preview documents. */
export const MAX_FIND_MATCHES = 500;

/** Bounds a sparse or no-match search before it can walk an entire huge preview. */
export const MAX_FIND_TEXT_NODES = 10_000;

/** Bounds work when a preview contains one unusually large text node. */
export const MAX_FIND_TEXT_CHARACTERS = 1_000_000;

export interface FindResult {
  count: number;
  capped: boolean;
}

export class FindHighlighter {
  private matches: HTMLElement[] = [];
  private activeIndex = -1;

  constructor(private readonly root: HTMLElement) {}

  apply(query: string, caseSensitive = false): FindResult {
    this.clear();
    if (!query) return { count: 0, capped: false };

    const needle = caseSensitive ? query : query.toLocaleLowerCase();
    const walker = document.createTreeWalker(this.root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) =>
        node.parentElement?.closest(".pmk-search-hit, [data-pmk-id]")
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
    });
    let capped = false;
    const textNodes: Text[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (textNodes.length >= MAX_FIND_TEXT_NODES) {
        capped = true;
        break;
      }
      textNodes.push(node as Text);
    }

    let remainingCharacters = MAX_FIND_TEXT_CHARACTERS;
    let characterCapReached = false;
    for (let index = 0; index < textNodes.length; index++) {
      if (this.matches.length >= MAX_FIND_MATCHES) {
        capped = true;
        break;
      }
      if (remainingCharacters === 0) {
        capped = true;
        characterCapReached = true;
        break;
      }
      const text = textNodes[index]!;
      const value = text.data;
      const searchableText = value.slice(0, remainingCharacters);
      remainingCharacters -= searchableText.length;
      const searchable = caseSensitive ? searchableText : searchableText.toLocaleLowerCase();
      let start = searchable.indexOf(needle);
      if (start === -1) {
        if (searchableText.length < value.length || (remainingCharacters === 0 && index + 1 < textNodes.length)) {
          capped = true;
          characterCapReached = true;
          break;
        }
        continue;
      }

      const fragment = document.createDocumentFragment();
      let cursor = 0;
      while (start !== -1) {
        if (this.matches.length >= MAX_FIND_MATCHES) {
          capped = true;
          break;
        }
        fragment.append(value.slice(cursor, start));
        const hit = document.createElement("mark");
        hit.className = "pmk-search-hit";
        hit.textContent = value.slice(start, start + query.length);
        fragment.appendChild(hit);
        this.matches.push(hit);
        cursor = start + query.length;
        start = searchable.indexOf(needle, cursor);
      }
      fragment.append(value.slice(cursor));
      text.replaceWith(fragment);
      if (capped) break;
      if (searchableText.length < value.length || (remainingCharacters === 0 && index + 1 < textNodes.length)) {
        capped = true;
        characterCapReached = true;
        break;
      }
    }

    if (this.matches.length > 0) this.setActive(0, true);
    if (capped) {
      const reason = this.matches.length >= MAX_FIND_MATCHES
        ? `${MAX_FIND_MATCHES} matches`
        : characterCapReached
          ? `scanning ${MAX_FIND_TEXT_CHARACTERS} text characters`
        : `scanning ${MAX_FIND_TEXT_NODES} text nodes`;
      console.warn(`Penmark find capped after ${reason}`);
    }
    return { count: this.matches.length, capped };
  }

  clear(): void {
    this.root.querySelectorAll<HTMLElement>("mark.pmk-search-hit").forEach((hit) => {
      hit.replaceWith(...Array.from(hit.childNodes));
    });
    this.matches = [];
    this.activeIndex = -1;
  }

  next(): boolean {
    return this.move(1);
  }

  previous(): boolean {
    return this.move(-1);
  }

  currentPosition(): number {
    return this.activeIndex + 1;
  }

  private move(delta: number): boolean {
    if (this.matches.length === 0) return false;
    this.setActive((this.activeIndex + delta + this.matches.length) % this.matches.length, true);
    return true;
  }

  private setActive(index: number, scroll: boolean): void {
    this.matches[this.activeIndex]?.classList.remove("pmk-search-hit-current");
    this.activeIndex = index;
    const current = this.matches[index]!;
    current.classList.add("pmk-search-hit-current");
    if (scroll) {
      current.scrollIntoView?.({
        block: "center",
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
    }
  }
}
