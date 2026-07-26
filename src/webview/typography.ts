/**
 * Apply resolved typography settings as CSS custom properties (v1.0 polish).
 *
 * The properties go on <body>, not on the preview root: the frontmatter card is
 * a SIBLING of #penmark-root, so body is the nearest common ancestor both can
 * resolve from. Setting them on body does not mean body consumes them — the
 * document declarations are scoped to #penmark-root and .pmk-frontmatter-card
 * in penmark.css, so a reader's serif body font never reaches the chrome.
 */

import type { TypographySettings } from "../core/settings/typography.js";
import { typographyCssVars } from "../core/settings/typography.js";

/** Apply typography CSS custom properties for the document surfaces. */
export function applyTypography(typography: TypographySettings): void {
  const vars = typographyCssVars(typography);
  for (const [key, value] of Object.entries(vars)) {
    document.body.style.setProperty(key, value);
  }
}
