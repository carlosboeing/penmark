/**
 * Typography presets and CSS variable resolution (design §6, v1.0 polish).
 *
 * Pure — no vscode imports (ADR 0001). The host reads penmark.* settings and
 * passes a resolved {@link TypographySettings} payload to the webview.
 */

import type { ContentWidth } from "../protocol/messages.js";

export type PresetName = "github" | "reading" | "compact" | "focus" | "custom";
export type TextSize = "small" | "medium" | "large" | "x-large";

/** Resolved typography sent host → webview. */
export interface TypographySettings {
  preset: PresetName;
  textSize: TextSize;
  fontFamily: string;
  headingFontFamily: string;
  lineHeight: number;
  contentWidth: ContentWidth;
  /** Multiplier on the h1-h3 ratios. Optional: absent means the 1.0 baseline. */
  headingScale?: number;
}

const GITHUB_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"';
const SERIF_STACK = 'Georgia, "Times New Roman", serif';

const TEXT_SIZE_PX: Record<TextSize, number> = {
  small: 14,
  medium: 16,
  large: 18,
  "x-large": 20,
};

interface PresetDef {
  textSize: TextSize;
  lineHeight: number;
  fontFamily: string;
  headingFontFamily: string;
  contentWidth: ContentWidth;
  /**
   * Multiplier on the h1-h3 ratios, so hierarchy strength is its own axis.
   * Without it every preset shared one scale and differed only in body size,
   * which made Compact and Focus a text-size slider rather than two presets.
   */
  headingScale: number;
}

/**
 * Four presets, each for a distinct reading job, differing on at least two axes
 * from every other:
 *
 * - github   familiar default, matches how the document reads on GitHub
 * - reading  long-form prose: serif body, narrow measure, generous leading
 * - compact  skimming a long technical document: small, dense, flat hierarchy
 * - focus    narrow pane or reading at a distance: large text, strong hierarchy
 *
 * `print` was retired: export is a separate always-light pipeline with its own
 * settings, so a print *preview* preset duplicated it without helping anyone
 * read. A stale `penmark.preset: "print"` falls through to github below.
 */
const PRESETS: Record<Exclude<PresetName, "custom">, PresetDef> = {
  github: {
    textSize: "medium",
    lineHeight: 1.5,
    fontFamily: GITHUB_STACK,
    headingFontFamily: GITHUB_STACK,
    contentWidth: "full",
    headingScale: 1,
  },
  reading: {
    textSize: "large",
    lineHeight: 1.75,
    fontFamily: SERIF_STACK,
    headingFontFamily: GITHUB_STACK,
    contentWidth: "comfortable",
    headingScale: 1,
  },
  compact: {
    textSize: "small",
    lineHeight: 1.3,
    fontFamily: GITHUB_STACK,
    headingFontFamily: GITHUB_STACK,
    contentWidth: "full",
    headingScale: 0.8,
  },
  focus: {
    textSize: "x-large",
    lineHeight: 1.65,
    fontFamily: GITHUB_STACK,
    headingFontFamily: GITHUB_STACK,
    contentWidth: "comfortable",
    headingScale: 1.2,
  },
};

export interface RawTypographyConfig {
  preset?: string;
  textSize?: string;
  fontFamily?: string;
  headingFontFamily?: string;
  lineHeight?: number;
  contentWidth?: ContentWidth;
}

/** Base pixel size for a text-size knob. */
export function textSizeBasePx(size: TextSize): number {
  return TEXT_SIZE_PX[size];
}

/**
 * Resolve effective typography from raw penmark.* config values.
 * When preset is not `custom`, preset values apply unless a knob is explicitly set.
 */
export function resolveTypography(raw: RawTypographyConfig): TypographySettings {
  const presetName = (raw.preset ?? "github") as PresetName;
  const base =
    presetName !== "custom" && presetName in PRESETS
      ? PRESETS[presetName as Exclude<PresetName, "custom">]
      : PRESETS.github;

  const textSize = (raw.textSize ?? base.textSize) as TextSize;
  const fontFamily = raw.fontFamily?.trim() || base.fontFamily;
  const headingFontFamily = raw.headingFontFamily?.trim() || base.headingFontFamily;
  const lineHeight = raw.lineHeight ?? base.lineHeight;
  const contentWidth = raw.contentWidth ?? base.contentWidth;

  return {
    preset: presetName,
    textSize,
    fontFamily,
    headingFontFamily,
    lineHeight,
    contentWidth,
    headingScale: base.headingScale,
  };
}

/** CSS custom properties for the webview root. */
export function typographyCssVars(t: TypographySettings): Record<string, string> {
  const base = textSizeBasePx(t.textSize);
  // The scale applies to h1-h3 only. h4 and h5 are anchored to body size and h6
  // sits just below it, so a flattening scale can never push a heading under
  // its own body text — headings stay bold, which carries the hierarchy when
  // the size difference narrows.
  const scale = t.headingScale ?? 1;
  return {
    "--pmk-font-family": t.fontFamily,
    "--pmk-heading-font-family": t.headingFontFamily,
    "--pmk-text-size-base": `${base}px`,
    "--pmk-line-height": String(t.lineHeight),
    "--pmk-h1-size": `${Math.round(base * 2 * scale)}px`,
    "--pmk-h2-size": `${Math.round(base * 1.5 * scale)}px`,
    "--pmk-h3-size": `${Math.round(base * 1.25 * scale)}px`,
    "--pmk-h4-size": `${base}px`,
    "--pmk-h5-size": `${base}px`,
    "--pmk-h6-size": `${Math.round(base * 0.85)}px`,
  };
}
