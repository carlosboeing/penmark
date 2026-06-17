/**
 * Collapsible frontmatter metadata card (v1.0 polish + UI/UX upgrade).
 */

import type { FrontmatterFields } from "../core/render/frontmatter.js";

const CARD_ID = "pmk-frontmatter-card";

const PRIORITY_KEYS = ["title", "status", "date", "author"];

function formatValue(value: string | string[] | undefined): string {
  if (value === undefined) return "";
  if (Array.isArray(value)) return value.join(", ");
  return value;
}

/** Estimate reading time from plain text (words / 200 wpm). */
export function estimateReadingMinutes(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

function renderTags(tags: string | string[] | undefined, container: HTMLElement): void {
  if (!tags) return;
  const list = Array.isArray(tags) ? tags : tags.split(/[,\s]+/).filter(Boolean);
  if (list.length === 0) return;
  const row = document.createElement("div");
  row.className = "pmk-frontmatter-tags";
  for (const tag of list) {
    const chip = document.createElement("span");
    chip.className = "pmk-frontmatter-tag";
    chip.textContent = tag;
    row.appendChild(chip);
  }
  container.appendChild(row);
}

/** Render or update the frontmatter card above the preview root. */
export function renderFrontmatterCard(
  fields: FrontmatterFields | undefined,
  readingMinutes?: number,
): void {
  const existing = document.getElementById(CARD_ID);
  if (!fields || Object.keys(fields).length === 0) {
    existing?.remove();
    return;
  }

  const keys = [
    ...PRIORITY_KEYS.filter((k) => fields[k] !== undefined),
    ...Object.keys(fields).filter((k) => !PRIORITY_KEYS.includes(k) && k !== "tags"),
  ];

  const details = (existing as HTMLDetailsElement | null) ?? document.createElement("details");
  details.id = CARD_ID;
  details.className = "pmk-frontmatter-card";

  const summary = document.createElement("summary");
  summary.className = "pmk-frontmatter-summary";

  const titleEl = document.createElement("span");
  titleEl.className = "pmk-frontmatter-title";
  titleEl.textContent = formatValue(fields.title as string | undefined) || "Document metadata";

  summary.appendChild(titleEl);

  if (fields.status) {
    const status = document.createElement("span");
    status.className = "pmk-frontmatter-status";
    status.textContent = formatValue(fields.status);
    summary.appendChild(status);
  }

  if (readingMinutes !== undefined && readingMinutes > 0) {
    const rt = document.createElement("span");
    rt.className = "pmk-frontmatter-reading";
    rt.textContent = `${readingMinutes} min read`;
    summary.appendChild(rt);
  }

  details.replaceChildren(summary);

  renderTags(fields.tags as string | string[] | undefined, details);

  const dl = document.createElement("dl");
  dl.className = "pmk-frontmatter-fields";
  for (const key of keys) {
    const dt = document.createElement("dt");
    dt.textContent = key;
    const dd = document.createElement("dd");
    dd.textContent = formatValue(fields[key]);
    dl.appendChild(dt);
    dl.appendChild(dd);
  }
  details.appendChild(dl);

  details.open = keys.length <= 3;

  const root = document.getElementById("penmark-root");
  if (!existing && root?.parentElement) {
    root.parentElement.insertBefore(details, root);
  }
}
