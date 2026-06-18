/**
 * Unit tests for drawer.ts — the slide-in comments panel with the open-comments
 * list (jump-to + resolve) and the needs-attention bucket (re-anchor + delete).
 *
 * Runs in the vitest "webview" project (jsdom environment).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { WireComment } from "../../core/protocol/messages.js";
import {
  ensureDrawer,
  renderDrawer,
  openDrawer,
  closeDrawer,
  toggleDrawer,
  isDrawerOpen,
  openDrawerAtAttention,
  destroyDrawer,
  bucketComments,
  type DrawerStateStore,
} from "./drawer.js";
import { closeCommentPopover } from "./popover.js";

function comment(over: Partial<WireComment>): WireComment {
  return {
    id: "aaaaaaaa",
    state: "intact",
    provenance: "human",
    author: "carlos",
    timestamp: "2026-06-11 11:02 +10:00",
    quote: "eventual consistency",
    body: "Why eventual consistency on the read path?",
    extent: { startLine: 2, startCol: 25, endLine: 2, endCol: 45 },
    ...over,
  };
}

const OPEN_HUMAN = comment({ id: "open0001", provenance: "human", author: "carlos" });
const OPEN_AGENT = comment({
  id: "open0002",
  provenance: "agent",
  author: "claude-code",
  state: "degraded-recovered",
  quote: "Dependency | p99 budget",
  body: "Table is missing the failure-mode column.",
});
const ORPHANED = comment({
  id: "orph0001",
  state: "orphan",
  quote: "three retries with backoff",
  body: "The anchored text was rewritten. Re-anchor or delete.",
  extent: null,
});
const REMOVED = comment({
  id: "rmvd0001",
  state: "content-removed",
  quote: "deleted sentence",
  body: "Sentence was removed but the pair kept.",
  extent: null,
});

const ALL = [OPEN_HUMAN, OPEN_AGENT, ORPHANED, REMOVED];

function memStore(initial = false): DrawerStateStore & { value: boolean } {
  return {
    value: initial,
    get() {
      return this.value;
    },
    set(open: boolean) {
      this.value = open;
    },
  };
}

function panel(): HTMLElement {
  return document.querySelector(".pmk-drawer") as HTMLElement;
}
function openCards(): NodeListOf<HTMLElement> {
  return document.querySelectorAll(".pmk-drawer-section.open .pmk-drawer-card");
}
function attentionCards(): NodeListOf<HTMLElement> {
  return document.querySelectorAll(".pmk-drawer-attention .pmk-drawer-card");
}

describe("bucketComments", () => {
  it("splits open (live extent) from needs-attention (extent === null)", () => {
    const { open, attention } = bucketComments(ALL);
    expect(open.map((c) => c.id)).toEqual(["open0001", "open0002"]);
    expect(attention.map((c) => c.id)).toEqual(["orph0001", "rmvd0001"]);
  });
});

describe("drawer", () => {
  let post: ReturnType<typeof vi.fn>;
  let onReanchor: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    document.body.innerHTML = "";
    post = vi.fn();
    onReanchor = vi.fn();
    ensureDrawer({ post, onReanchor });
  });

  afterEach(() => {
    destroyDrawer();
  });

  it("creates one panel in <body>, closed by default", () => {
    expect(panel()).not.toBeNull();
    expect(isDrawerOpen()).toBe(false);
    expect(panel().getAttribute("aria-hidden")).toBe("true");
  });

  it("lists each open comment with quote, body, author, and a provenance avatar", () => {
    renderDrawer(ALL);
    const cards = openCards();
    expect(cards.length).toBe(2);

    const human = cards[0]!;
    expect(human.textContent).toContain("eventual consistency");
    expect(human.textContent).toContain("Why eventual consistency");
    expect(human.textContent).toContain("carlos");
    expect(human.querySelector(".pmk-avatar-human")).not.toBeNull();

    expect(cards[1]!.querySelector(".pmk-avatar-agent")).not.toBeNull();
  });

  it("jump-to on an open card scrolls the comment into view", () => {
    renderDrawer(ALL);
    const scrollIntoViewMock = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoViewMock;

    const mockHl = document.createElement("mark");
    mockHl.setAttribute("data-pmk-id", "open0001");
    const root = document.createElement("div");
    root.id = "penmark-root";
    root.appendChild(mockHl);
    document.body.appendChild(root);

    expect(mockHl.classList.contains("pmk-hl-active")).toBe(false);

    (openCards()[0]!.querySelector(".pmk-drawer-action.jump") as HTMLButtonElement).click();
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ block: "center", behavior: "smooth" });

    expect(mockHl.classList.contains("pmk-hl-active")).toBe(true);
    expect(document.querySelector(".pmk-popover")).not.toBeNull();

    closeCommentPopover();
    root.remove();
  });

  it("resolve on an open card posts resolveComment with the id", () => {
    renderDrawer(ALL);
    (openCards()[0]!.querySelector(".pmk-drawer-action.resolve") as HTMLButtonElement).click();
    expect(post).toHaveBeenCalledWith({ v: 1, type: "resolveComment", id: "open0001" });
  });

  it("uses plain text action labels without emoji glyphs", () => {
    renderDrawer(ALL);
    const actions = Array.from(document.querySelectorAll(".pmk-drawer-action")).map((btn) =>
      btn.textContent?.trim(),
    );
    expect(actions).toContain("Open");
    expect(actions).toContain("Edit");
    expect(actions).toContain("Resolve");
    expect(actions).toContain("Re-anchor");
    expect(actions).toContain("Delete");
    expect(actions.join(" ")).not.toMatch(/[✓↻🗑]/u);
  });

  it("renders the needs-attention section listing orphan + content-removed (quote preserved)", () => {
    renderDrawer(ALL);
    const cards = attentionCards();
    expect(cards.length).toBe(2);
    expect(cards[0]!.textContent).toContain("three retries with backoff");
    expect(cards[1]!.textContent).toContain("deleted sentence");
  });

  it("delete in needs-attention posts resolveComment (resolve = delete, ADR 0002)", () => {
    renderDrawer(ALL);
    (attentionCards()[0]!.querySelector(".pmk-drawer-action.delete") as HTMLButtonElement).click();
    expect(post).toHaveBeenCalledWith({ v: 1, type: "resolveComment", id: "orph0001" });
  });

  it("re-anchor in needs-attention invokes onReanchor with id, quote, and body", () => {
    renderDrawer(ALL);
    (
      attentionCards()[0]!.querySelector(".pmk-drawer-action.reanchor") as HTMLButtonElement
    ).click();
    expect(onReanchor).toHaveBeenCalledWith(
      "orph0001",
      "three retries with backoff",
      "The anchored text was rewritten. Re-anchor or delete.",
    );
  });

  it("omits the needs-attention section when there are no orphan/content-removed comments", () => {
    renderDrawer([OPEN_HUMAN, OPEN_AGENT]);
    expect(document.querySelector(".pmk-drawer-attention")).toBeNull();
  });

  it("shows an empty state when there are no open comments", () => {
    renderDrawer([ORPHANED]);
    expect(openCards().length).toBe(0);
    expect(panel().textContent).toContain("No open comments");
  });

  it("open/close/toggle flips visibility, aria-hidden, and inert", () => {
    openDrawer();
    expect(isDrawerOpen()).toBe(true);
    expect(panel().getAttribute("aria-hidden")).toBe("false");
    expect(panel().hasAttribute("inert")).toBe(false); // focusable when open
    closeDrawer();
    expect(isDrawerOpen()).toBe(false);
    expect(panel().hasAttribute("inert")).toBe(true); // out of tab order when closed
    toggleDrawer();
    expect(isDrawerOpen()).toBe(true);
  });

  it("openDrawerAtAttention opens the drawer and reveals the needs-attention section", () => {
    renderDrawer(ALL);
    openDrawerAtAttention();
    expect(isDrawerOpen()).toBe(true);
    expect(document.querySelector(".pmk-drawer-attention")).not.toBeNull();
  });

  it("Escape closes the drawer when it is open", () => {
    openDrawer();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(isDrawerOpen()).toBe(false);
  });
});

describe("drawer persistence", () => {
  afterEach(() => destroyDrawer());

  it("persists open/closed via the injected store and restores it on ensure", () => {
    document.body.innerHTML = "";
    const store = memStore(false);
    ensureDrawer({ post: vi.fn(), onReanchor: vi.fn(), store });

    openDrawer();
    expect(store.value).toBe(true);
    closeDrawer();
    expect(store.value).toBe(false);

    // A fresh ensure (e.g. after a reload) restores the persisted open state.
    destroyDrawer();
    store.value = true;
    document.body.innerHTML = "";
    ensureDrawer({ post: vi.fn(), onReanchor: vi.fn(), store });
    expect(isDrawerOpen()).toBe(true);
  });
});
