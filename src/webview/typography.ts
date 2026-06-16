/**
 * Apply resolved typography settings as CSS custom properties (v1.0 polish).
 */

import type { TypographySettings } from "../core/settings/typography.js";
import { typographyCssVars } from "../core/settings/typography.js";
import type { ContentWidth } from "../core/protocol/messages.js";

const WIDTH_CLASS: Record<ContentWidth, string> = {
  comfortable: "pmk-width-comfortable",
  wide: "pmk-width-wide",
  full: "pmk-width-full",
};

/** Apply typography CSS variables and content-width class on the preview root. */
export function applyTypography(root: HTMLElement, typography: TypographySettings): void {
  const vars = typographyCssVars(typography);
  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value);
  }
  root.classList.remove("pmk-width-comfortable", "pmk-width-wide", "pmk-width-full");
  root.classList.add(WIDTH_CLASS[typography.contentWidth]);
}
