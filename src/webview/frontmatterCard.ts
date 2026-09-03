import type { FrontmatterFields } from "../core/render/frontmatter.js";
import type { WebviewToHost } from "../core/protocol/messages.js";

type PostMessage = (msg: WebviewToHost) => void;

export interface FrontmatterStateStore {
  get: () => boolean | undefined;
  set: (open: boolean) => void;
}

/**
 * Per-card host deps, refreshed on every render. A render without deps
 * detaches the previous ones instead of silently reusing them, so callers
 * can never inherit another caller's postMessage or store.
 */
interface FrontmatterCardDeps {
  postMessage?: PostMessage;
  store?: FrontmatterStateStore;
}

type CardElement = HTMLDetailsElement & { _pmkDeps?: FrontmatterCardDeps };

function depsOf(details: HTMLDetailsElement): FrontmatterCardDeps {
  return (details as CardElement)._pmkDeps ?? {};
}

const CARD_ID = "pmk-frontmatter-card";

const PRIORITY_KEYS = ["title", "status", "date", "author", "authors", "tags"];

const CHIP_KEYS = ["tags", "scope"];

function isFilePath(value: string): boolean {
  if (!value || typeof value !== "string") return false;
  const trimmed = value.trim();
  if (/^(javascript|data|vbscript):/i.test(trimmed)) return false;
  // Exclude strings with spaces around slashes (e.g. "John / Jane")
  if (/\s\/\s/.test(trimmed)) return false;
  if (/^(https?|ftp|file|mailto):/i.test(trimmed) || /^www\./i.test(trimmed)) return true;
  if (trimmed.startsWith("./") || trimmed.startsWith("../") || trimmed.includes("/")) return true;
  return /\.(md|sh|ts|js|json|py|css|html|yml|yaml|go|rs|java|kt|cs)$/i.test(trimmed);
}

function createPathLink(path: string): HTMLAnchorElement {
  const link = document.createElement("a");
  link.className = "pmk-frontmatter-path";
  const trimmed = path.trim();
  const href = /^www\./i.test(trimmed) ? `https://${trimmed}` : trimmed;
  link.dataset.path = href;
  link.setAttribute("href", "#");
  const code = document.createElement("code");
  code.textContent = path;
  link.appendChild(code);
  return link;
}

function renderValueContent(key: string, rawValue: string | string[]): HTMLElement {
  const isChipField = CHIP_KEYS.includes(key.toLowerCase());

  if (isChipField) {
    const container = document.createElement("div");
    container.className = "pmk-frontmatter-tag-group";
    const items = Array.isArray(rawValue)
      ? rawValue
      : rawValue.split(",").map((s) => s.trim()).filter(Boolean);

    for (const item of items) {
      const chip = document.createElement("span");
      chip.className = "pmk-frontmatter-chip";
      chip.textContent = item;
      container.appendChild(chip);
    }
    return container;
  }

  if (Array.isArray(rawValue)) {
    const ul = document.createElement("ul");
    ul.className = "pmk-frontmatter-list";
    for (const item of rawValue) {
      const li = document.createElement("li");
      li.className = "pmk-frontmatter-list-item";
      if (isFilePath(item)) {
        li.appendChild(createPathLink(item));
      } else {
        li.textContent = item;
      }
      ul.appendChild(li);
    }
    return ul;
  }

  if (isFilePath(rawValue)) {
    return createPathLink(rawValue);
  }

  const span = document.createElement("span");
  span.textContent = rawValue;
  return span;
}

export interface FrontmatterStateStore {
  get: () => boolean | undefined;
  set: (open: boolean) => void;
}

function formatValue(value: string | string[] | undefined): string {
  if (value === undefined) return "";
  if (Array.isArray(value)) return value.join(", ");
  return value;
}

/** Render or update the frontmatter card above the preview root. */
export function renderFrontmatterCard(
  fields: FrontmatterFields | undefined,
  postMessage?: PostMessage,
  store?: FrontmatterStateStore,
): void {
  const existing = document.getElementById(CARD_ID) as HTMLDetailsElement | null;
  if (!fields || Object.keys(fields).length === 0) {
    existing?.remove();
    return;
  }

  const keys = [
    ...PRIORITY_KEYS.filter((k) => fields[k] !== undefined),
    ...Object.keys(fields).filter((k) => !PRIORITY_KEYS.includes(k)),
  ];

  const details = existing ?? document.createElement("details");
  details.id = CARD_ID;
  details.className = "pmk-frontmatter-card";
  (details as CardElement)._pmkDeps = { postMessage, store };

  if (!details.dataset.linkHandlerInstalled) {
    details.dataset.linkHandlerInstalled = "true";
    details.addEventListener("click", (evt) => {
      const target = (evt.target as Element | null)?.closest(".pmk-frontmatter-path") as HTMLElement | null;
      if (!target) return;
      evt.preventDefault();
      const path = target.dataset.path || target.getAttribute("href") || "";
      if (path && path !== "#" && !/^(javascript|data|vbscript):/i.test(path.trim())) {
        const post =
          depsOf(details).postMessage ??
          (window as unknown as { vscode?: { postMessage: (msg: unknown) => void } }).vscode
            ?.postMessage;
        post?.({ v: 1, type: "openLink", href: path });
      }
    });
    details.addEventListener("toggle", () => {
      depsOf(details).store?.set(details.open);
    });
  }

  if (fields.status && typeof fields.status === "string") {
    details.dataset.status = fields.status.toLowerCase();
  } else {
    delete details.dataset.status;
  }

  const summary = document.createElement("summary");
  const title = formatValue(fields.title as string | undefined) || "Document metadata";
  const titleEl = document.createElement("span");
  titleEl.className = "pmk-frontmatter-title";
  titleEl.textContent = title;
  summary.appendChild(titleEl);

  if (fields.status) {
    const status = document.createElement("span");
    status.className = "pmk-frontmatter-status";
    status.textContent = formatValue(fields.status);
    summary.appendChild(status);
  }

  const tags = fields.tags;
  if (Array.isArray(tags)) {
    for (const tagValue of tags) {
      const tag = document.createElement("span");
      tag.className = "pmk-frontmatter-tag";
      tag.textContent = tagValue;
      summary.appendChild(tag);
    }
  }

  details.replaceChildren(summary);

  const dl = document.createElement("dl");
  dl.className = "pmk-frontmatter-fields";
  for (const key of keys) {
    const val = fields[key];
    if (val === undefined || val === "" || (Array.isArray(val) && val.length === 0)) continue;
    const dt = document.createElement("dt");
    dt.textContent = key;
    const dd = document.createElement("dd");
    dd.appendChild(renderValueContent(key, val));
    dl.append(dt, dd);
  }
  details.appendChild(dl);

  if (existing) {
    // Preserve current in-DOM state on re-render
  } else {
    const saved = store?.get();
    if (saved !== undefined) {
      details.open = saved;
    } else if (keys.length > 3) {
      details.open = false;
    } else {
      details.open = true;
    }
  }

  const root = document.getElementById("penmark-root");
  if (!existing && root?.parentElement) {
    root.parentElement.insertBefore(details, root);
  }
}
