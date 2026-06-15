import { describe, it, expect, beforeEach } from "vitest";
import {
  SAFE_STYLE_PROPS,
  adaptMermaidDarkBackgrounds,
  isLightFill,
  isSafeStyleValue,
  rehydrateElementStyles,
  rehydrateMermaidInlineStyles,
} from "./styleRehydration.js";

// Assert against the DOM environment's own canonical serialization of a CSS
// value, so these checks survive serialization differences across jsdom versions
// and real browsers. jsdom 29 quotes url() and normalises hex to rgb() (matching
// browsers); jsdom 26 did neither. Production re-applies styles through the same
// CSSOM path, so comparing against the environment's serialization still verifies
// the exact value was rehydrated.
function canonicalStyle(prop: string, value: string): string {
  const probe = document.createElement("div");
  probe.style.setProperty(prop, value);
  return probe.style.getPropertyValue(prop);
}

describe("isSafeStyleValue", () => {
  it("allows plain values", () => {
    expect(isSafeStyleValue("123px")).toBe(true);
    expect(isSafeStyleValue("table-cell")).toBe(true);
    expect(isSafeStyleValue("#8b5cf6")).toBe(true);
  });

  it("allows same-document url(#fragment) references (mermaid gradients/markers)", () => {
    expect(isSafeStyleValue("url(#grad0)")).toBe(true);
    expect(isSafeStyleValue('url("#arrowhead")')).toBe(true);
  });

  it("rejects external url() references (exfiltration vector)", () => {
    expect(isSafeStyleValue("url(http://evil.example/leak)")).toBe(false);
    expect(isSafeStyleValue("url('https://evil.example/x')")).toBe(false);
    expect(isSafeStyleValue("url(//evil.example/x)")).toBe(false);
    expect(isSafeStyleValue("url(data:image/svg+xml,...)")).toBe(false);
  });
});

describe("SAFE_STYLE_PROPS", () => {
  it("allows the layout + paint properties mermaid emits", () => {
    for (const prop of ["display", "max-width", "width", "height", "text-align", "fill", "stroke", "color"]) {
      expect(SAFE_STYLE_PROPS.has(prop)).toBe(true);
    }
  });

  it("allows SVG text-anchor so centered sequence labels survive rehydration", () => {
    expect(SAFE_STYLE_PROPS.has("text-anchor")).toBe(true);
  });

  it("excludes UI-redressing properties", () => {
    for (const prop of ["position", "z-index", "pointer-events"]) {
      expect(SAFE_STYLE_PROPS.has(prop)).toBe(false);
    }
  });
});

describe("rehydrateElementStyles", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("re-applies allowlisted properties from the style attribute via the CSSOM", () => {
    const el = document.createElement("div");
    el.setAttribute("style", "max-width: 123px; display: table-cell; text-align: center;");
    document.body.appendChild(el);

    rehydrateElementStyles(el);

    expect(el.style.maxWidth).toBe("123px");
    expect(el.style.display).toBe("table-cell");
    expect(el.style.textAlign).toBe("center");
  });

  it("drops non-allowlisted properties", () => {
    const el = document.createElement("div");
    el.setAttribute("style", "max-width: 50px; position: fixed; z-index: 99;");
    document.body.appendChild(el);

    rehydrateElementStyles(el);

    expect(el.style.maxWidth).toBe("50px");
    expect(el.style.position).toBe("");
    expect(el.style.zIndex).toBe("");
  });

  it("keeps fill: url(#fragment) but drops fill with an external url()", () => {
    const good = document.createElement("div");
    good.setAttribute("style", "fill: url(#grad0);");
    const bad = document.createElement("div");
    bad.setAttribute("style", "fill: url(http://evil.example/x);");

    rehydrateElementStyles(good);
    rehydrateElementStyles(bad);

    expect(good.style.fill).toBe(canonicalStyle("fill", "url(#grad0)"));
    expect(bad.style.fill).toBe("");
  });

  it("is a no-op for an element without a style attribute", () => {
    const el = document.createElement("div");
    expect(() => rehydrateElementStyles(el)).not.toThrow();
    expect(el.getAttribute("style")).toBeNull();
  });
});

describe("isLightFill", () => {
  it("flags light author backgrounds", () => {
    expect(isLightFill("rgb(237, 233, 254)")).toBe(true); // lavender band
    expect(isLightFill("rgb(249, 249, 249)")).toBe(true); // near-white cluster
  });

  it("rejects dark fills and non-colors", () => {
    expect(isLightFill("rgb(13, 17, 23)")).toBe(false); // page dark
    expect(isLightFill("rgb(139, 92, 246)")).toBe(false); // semantic purple
    expect(isLightFill("none")).toBe(false);
  });
});

describe("adaptMermaidDarkBackgrounds", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("is a no-op in light mode and for a null svg", () => {
    document.body.innerHTML = '<svg><rect class="rect" style="fill: rgb(237,233,254)"></rect></svg>';
    const svg = document.querySelector("svg") as SVGSVGElement;
    adaptMermaidDarkBackgrounds(svg, false);
    expect(svg.querySelector("rect")!.style.fillOpacity).toBe("");
    expect(() => adaptMermaidDarkBackgrounds(null, true)).not.toThrow();
  });
});

describe("rehydrateMermaidInlineStyles", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("re-hydrates the svg root and all descendants with style attributes", () => {
    document.body.innerHTML =
      '<svg style="max-width: 276px;">' +
      '<g class="node"><rect style="fill: #8b5cf6; stroke: #6d28d9;"></rect>' +
      '<foreignObject><div style="display: table; text-align: center; width: 200px;"></div></foreignObject>' +
      "</g></svg>";
    const svg = document.querySelector("svg") as SVGSVGElement;

    rehydrateMermaidInlineStyles(svg);

    expect(svg.style.maxWidth).toBe("276px");
    const rect = svg.querySelector("rect") as SVGRectElement;
    // Compare against the environment's own serialization: jsdom 29 and browsers
    // normalise hex to rgb(), jsdom 26 kept the hex. The full browser-normalised
    // path is also covered by the Playwright suite.
    expect(rect.style.fill).toBe(canonicalStyle("fill", "#8b5cf6"));
    expect(rect.style.stroke).toBe(canonicalStyle("stroke", "#6d28d9"));
    const div = svg.querySelector("foreignObject > div") as HTMLElement;
    expect(div.style.display).toBe("table");
    expect(div.style.textAlign).toBe("center");
    expect(div.style.width).toBe("200px");
  });

  it("tolerates a null svg (contained-failure path)", () => {
    expect(() => rehydrateMermaidInlineStyles(null)).not.toThrow();
  });
});
