/**
 * Collapsible frontmatter metadata card (v1.0 polish & type-aware lists).
 */

import type { FrontmatterFields } from "../core/render/frontmatter.js";

const CARD_ID = "pmk-frontmatter-card";

const PRIORITY_KEYS = ["title", "status", "date", "author", "authors", "tags"];

const CHIP_KEYS = ["tags", "scope"];

function isFilePath(value: string): boolean {
  if (!value || typeof value !== "string") return false;
  if (value.includes("/")) return true;
  return /\.(md|sh|ts|js|json|py|css|html|yml|yaml|go|rs|java|kt|cs)$/i.test(value);
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
        const link = document.createElement("a");
        link.className = "pmk-frontmatter-path";
        link.href = item;
        const code = document.createElement("code");
        code.textContent = item;
        link.appendChild(code);
        li.appendChild(link);
      } else {
        li.textContent = item;
      }
      ul.appendChild(li);
    }
    return ul;
  }

  if (isFilePath(rawValue)) {
    const link = document.createElement("a");
    link.className = "pmk-frontmatter-path";
    link.href = rawValue;
    const code = document.createElement("code");
    code.textContent = rawValue;
    link.appendChild(code);
    return link;
  }

  const span = document.createElement("span");
  span.textContent = rawValue;
  return span;
}

function formatValue(value: string | string[] | undefined): string {
  if (value === undefined) return "";
  if (Array.isArray(value)) return value.join(", ");
  return value;
}

/** Render or update the frontmatter card above the preview root. */
export function renderFrontmatterCard(fields: FrontmatterFields | undefined): void {
  const existing = document.getElementById(CARD_ID);
  if (!fields || Object.keys(fields).length === 0) {
    existing?.remove();
    return;
  }

  const keys = [
    ...PRIORITY_KEYS.filter((k) => fields[k] !== undefined),
    ...Object.keys(fields).filter((k) => !PRIORITY_KEYS.includes(k)),
  ];

  const details = (existing as HTMLDetailsElement | null) ?? document.createElement("details");
  details.id = CARD_ID;
  details.className = "pmk-frontmatter-card";

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

  if (keys.length > 3) {
    details.open = false;
  } else {
    details.open = true;
  }

  const root = document.getElementById("penmark-root");
  if (!existing && root?.parentElement) {
    root.parentElement.insertBefore(details, root);
  }
}
