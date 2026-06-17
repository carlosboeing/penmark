/**
 * Apply resolved typography settings as CSS custom properties (v1.0 polish).
 *
 * Variables are written into a nonce-tagged <style> block — not via
 * root.style.setProperty — so strict webview CSP (style-src nonce, no
 * unsafe-inline) does not log hundreds of inline-style violations.
 */

import type { TypographySettings } from "../core/settings/typography.js";
import { typographyCssVars } from "../core/settings/typography.js";
import type { ContentWidth } from "../core/protocol/messages.js";

const TYPOGRAPHY_STYLE_ID = "penmark-typography-vars";

const WIDTH_CLASS: Record<ContentWidth, string> = {
  comfortable: "pmk-width-comfortable",
  wide: "pmk-width-wide",
  full: "pmk-width-full",
};

function shellStyleNonce(): string | null {
  const tagged =
    document.querySelector("style[nonce]") ??
    document.querySelector('link[rel="stylesheet"][nonce]');
  return tagged?.getAttribute("nonce") ?? null;
}

function ensureTypographyStyleEl(): HTMLStyleElement {
  let el = document.getElementById(TYPOGRAPHY_STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = TYPOGRAPHY_STYLE_ID;
    const nonce = shellStyleNonce();
    if (nonce) el.setAttribute("nonce", nonce);
    document.head.appendChild(el);
  }
  return el;
}

/** Apply typography CSS variables and content-width class on the preview root. */
export function applyTypography(root: HTMLElement, typography: TypographySettings): void {
  const vars = typographyCssVars(typography);
  const decls = Object.entries(vars)
    .map(([key, value]) => `${key}:${value}`)
    .join(";");
  ensureTypographyStyleEl().textContent = `#penmark-root{${decls}}`;

  root.classList.remove("pmk-width-comfortable", "pmk-width-wide", "pmk-width-full");
  root.classList.add(WIDTH_CLASS[typography.contentWidth]);
}
