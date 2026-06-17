/**
 * Inline SVG icons for the preview topbar (CSP-safe — createElementNS only).
 */

const SVG_NS = "http://www.w3.org/2000/svg";

export type TopbarIconName = "sun" | "moon" | "auto" | "settings" | "comments";

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    node.setAttribute(k, v);
  }
  return node;
}

function appendSvgChildren(svg: SVGSVGElement, ...children: SVGElement[]): void {
  for (const child of children) {
    svg.appendChild(child);
  }
}

/** 16×16 stroke icon for topbar buttons. */
export function createTopbarIcon(name: TopbarIconName): SVGSVGElement {
  const svg = el("svg", {
    viewBox: "0 0 16 16",
    width: "16",
    height: "16",
    fill: "none",
    "stroke-width": "1.35",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  });
  svg.classList.add("pmk-topbar-icon");
  svg.setAttribute("aria-hidden", "true");

  const stroke = "currentColor";

  switch (name) {
    case "sun":
      appendSvgChildren(
        svg,
        el("circle", { cx: "8", cy: "8", r: "3.25", stroke }),
        el("path", {
          d: "M8 1.5v1.75M8 12.75v1.75M1.5 8h1.75M12.75 8h1.75M3.52 3.52l1.24 1.24M11.24 11.24l1.24 1.24M3.52 12.48l1.24-1.24M11.24 4.76l1.24-1.24",
          stroke,
        }),
      );
      break;
    case "moon":
      appendSvgChildren(
        svg,
        el("path", {
          d: "M11.8 10.2a4.75 4.75 0 1 1-3.15-8.35A5.25 5.25 0 1 0 11.8 10.2z",
          stroke,
        }),
      );
      break;
    case "auto":
      appendSvgChildren(
        svg,
        el("circle", { cx: "8", cy: "8", r: "5.25", stroke }),
        el("path", {
          d: "M8 2.75 A5.25 5.25 0 0 0 8 13.25 Z",
          fill: "currentColor",
          "fill-opacity": "0.32",
          stroke: "none",
        }),
        el("path", { d: "M8 2.75v10.5", stroke }),
      );
      break;
    case "settings":
      appendSvgChildren(
        svg,
        el("path", {
          d: "M8 2.75L9.88 4.75L12.55 5.38L11.75 8L12.55 10.62L9.88 11.25L8 13.25L6.12 11.25L3.45 10.62L4.25 8L3.45 5.38L6.12 4.75Z",
          stroke,
        }),
        el("circle", { cx: "8", cy: "8", r: "1.75", stroke }),
      );
      break;
    case "comments":
      appendSvgChildren(
        svg,
        el("path", {
          d: "M3 3.5h10a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5H6.2L3 14V5a1.5 1.5 0 0 1 1.5-1.5z",
          stroke,
        }),
        el("path", { d: "M5.5 7.75h5", stroke }),
      );
      break;
  }

  return svg;
}
