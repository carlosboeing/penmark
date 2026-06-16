/**
 * Typography presets and CSS variable resolution (design §6, v1.0 polish).
 *
 * Pure — no vscode imports (ADR 0001). The host reads penmark.* settings and
 * passes a resolved {@link TypographySettings} payload to the webview.
 */

import type { ContentWidth } from "../protocol/messages.js";

export type PresetName = "github" | "reading" | "compact" | "focus" | "print" | "custom";
export type TextSize = "small" | "medium" | "large" | "x-large";

/** Resolved typography sent host → webview. */
export interface TypographySettings {
  preset: PresetName;
  textSize: TextSize;
  fontFamily: string;
  headingFontFamily: string;
  lineHeight: number;
  contentWidth: ContentWidth;
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
}

const PRESETS: Record<Exclude<PresetName, "custom">, PresetDef> = {
  github: {
    textSize: "medium",
    lineHeight: 1.5,
    fontFamily: GITHUB_STACK,
    headingFontFamily: GITHUB_STACK,
    contentWidth: "full",
  },
  reading: {
    textSize: "large",
    lineHeight: 1.7,
    fontFamily: SERIF_STACK,
    headingFontFamily: GITHUB_STACK,
    contentWidth: "comfortable",
  },
  compact: {
    textSize: "small",
    lineHeight: 1.35,
    fontFamily: GITHUB_STACK,
    headingFontFamily: GITHUB_STACK,
    contentWidth: "full",
  },
  focus: {
    textSize: "x-large",
    lineHeight: 1.6,
    fontFamily: GITHUB_STACK,
    headingFontFamily: GITHUB_STACK,
    contentWidth: "comfortable",
  },
  print: {
    textSize: "medium",
    lineHeight: 1.45,
    fontFamily: SERIF_STACK,
    headingFontFamily: SERIF_STACK,
    contentWidth: "comfortable",
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
  };
}

/** CSS custom properties for the webview root. */
export function typographyCssVars(t: TypographySettings): Record<string, string> {
  const base = textSizeBasePx(t.textSize);
  return {
    "--pmk-font-family": t.fontFamily,
    "--pmk-heading-font-family": t.headingFontFamily,
    "--pmk-text-size-base": `${base}px`,
    "--pmk-line-height": String(t.lineHeight),
    "--pmk-h1-size": `${Math.round(base * 2)}px`,
    "--pmk-h2-size": `${Math.round(base * 1.5)}px`,
    "--pmk-h3-size": `${Math.round(base * 1.25)}px`,
    "--pmk-h4-size": `${base}px`,
    "--pmk-h5-size": `${base}px`,
    "--pmk-h6-size": `${Math.round(base * 0.85)}px`,
  };
}
