/**
 * Collapsible frontmatter metadata card (v1.0 polish).
 */

import type { FrontmatterFields } from "../core/render/frontmatter.js";

const CARD_ID = "pmk-frontmatter-card";

const PRIORITY_KEYS = ["title", "status", "date", "author", "tags"];

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

  const summary = document.createElement("summary");
  const title = formatValue(fields.title as string | undefined) || "Document metadata";
  const status = fields.status ? ` · ${formatValue(fields.status)}` : "";
  summary.textContent = `${title}${status}`;
  details.replaceChildren(summary);

  const dl = document.createElement("dl");
  dl.className = "pmk-frontmatter-fields";
  for (const key of keys) {
    const dt = document.createElement("dt");
    dt.textContent = key;
    const dd = document.createElement("dd");
    dd.textContent = formatValue(fields[key]);
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
