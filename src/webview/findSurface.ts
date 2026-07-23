import { registerPenmarkSurface } from "./keyboard.js";
import { FindHighlighter, type FindResult } from "./find.js";

export interface FindSurface {
  open(opener?: HTMLElement | null): void;
  close(restoreFocus?: boolean): void;
  isOpen(): boolean;
  clearForRender(): void;
  refresh(): void;
}

let _surface: FindSurface | null = null;

export function ensureFindSurface(getRoot: () => HTMLElement | null): FindSurface {
  if (_surface && document.querySelector(".pmk-find-surface")) return _surface;

  const el = document.createElement("div");
  el.className = "pmk-find-surface";
  el.setAttribute("role", "search");
  el.setAttribute("aria-label", "Search document");
  el.setAttribute("aria-hidden", "true");

  const input = document.createElement("input");
  input.className = "pmk-find-input";
  input.type = "search";
  input.placeholder = "Search document";
  input.setAttribute("aria-label", "Search document");
  const count = document.createElement("span");
  count.className = "pmk-find-count";
  count.setAttribute("aria-live", "polite");
  const previous = document.createElement("button");
  previous.type = "button";
  previous.textContent = "Previous";
  previous.setAttribute("aria-label", "Previous match");
  const next = document.createElement("button");
  next.type = "button";
  next.textContent = "Next";
  next.setAttribute("aria-label", "Next match");
  const caseToggle = document.createElement("button");
  caseToggle.type = "button";
  caseToggle.textContent = "Aa";
  caseToggle.setAttribute("aria-label", "Match case");
  caseToggle.setAttribute("aria-pressed", "false");
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.textContent = "Close";
  closeButton.setAttribute("aria-label", "Close search");
  el.append(input, count, previous, next, caseToggle, closeButton);
  document.body.appendChild(el);

  let highlighter: FindHighlighter | null = null;
  let unregister: ((restoreFocus?: boolean) => void) | null = null;
  let caseSensitive = false;
  let result: FindResult = { count: 0, capped: false };

  const updateCount = (): void => {
    if (!input.value) {
      count.textContent = "";
      return;
    }
    if (result.count === 0) {
      count.textContent = "No results";
      return;
    }
    const total = result.capped ? `${result.count}+` : String(result.count);
    count.textContent = `${highlighter?.currentPosition() ?? 0} / ${total}`;
  };
  const apply = (): void => {
    const root = getRoot();
    if (!root) return;
    highlighter?.clear();
    highlighter = new FindHighlighter(root);
    result = highlighter.apply(input.value, caseSensitive);
    updateCount();
  };
  const close = (restoreFocus = true): void => {
    highlighter?.clear();
    highlighter = null;
    el.setAttribute("aria-hidden", "true");
    const cleanup = unregister;
    unregister = null;
    cleanup?.(restoreFocus);
    document.dispatchEvent(new Event("pmk-find-closed"));
  };
  const open = (opener: HTMLElement | null = null): void => {
    if (el.getAttribute("aria-hidden") === "false") {
      input.focus();
      return;
    }
    el.setAttribute("aria-hidden", "false");
    unregister = registerPenmarkSurface(el, opener, () => close());
    apply();
    input.focus();
  };

  input.addEventListener("input", apply);
  previous.addEventListener("click", () => {
    highlighter?.previous();
    updateCount();
  });
  next.addEventListener("click", () => {
    highlighter?.next();
    updateCount();
  });
  caseToggle.addEventListener("click", () => {
    caseSensitive = !caseSensitive;
    caseToggle.setAttribute("aria-pressed", String(caseSensitive));
    apply();
  });
  closeButton.addEventListener("click", () => close());
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && !(event.key.toLowerCase() === "g" && (event.metaKey || event.ctrlKey))) return;
    if (event.key === "Enter" && event.shiftKey) highlighter?.previous();
    else highlighter?.next();
    updateCount();
    event.preventDefault();
  });

  _surface = {
    open,
    close,
    isOpen: () => el.getAttribute("aria-hidden") === "false",
    clearForRender: () => highlighter?.clear(),
    refresh: () => {
      if (el.getAttribute("aria-hidden") === "false") apply();
    },
  };
  return _surface;
}
