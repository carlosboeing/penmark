/**
 * Versioned message protocol between the extension host and the webview.
 *
 * ADR 0001: this file is in src/core — no vscode imports.
 * Both sides import these types to stay in sync. The v field allows the host
 * and webview to detect mismatches when the protocol evolves.
 */

import type { CommentState, Provenance } from "../comments/types.js";
import type { PresetName, TextSize, TypographySettings } from "../settings/typography.js";
import type { FrontmatterFields } from "../render/frontmatter.js";

export const PROTOCOL_VERSION = 1;

export type ThemeMode = "light" | "dark" | "auto";

/**
 * Resolved on-screen extent of a comment anchor, in document coordinates.
 * Sent host → webview as part of a comment payload. Null on the comment when
 * the anchor is an orphan or its content was removed (see `WireComment.extent`).
 */
export interface WireExtent {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

/**
 * Wire-shaped comment shipped host → webview. A flattened, transport-only view
 * of the parsed comment model (`ParsedEntry` + reconcile `CommentState`); the
 * webview never sees raw markdown. `extent` is null for orphan / content-removed
 * comments, which have no live span to highlight.
 */
export interface WireComment {
  id: string;
  state: CommentState;
  provenance: Provenance;
  author: string;
  timestamp: string;
  quote: string;
  body: string;
  extent: WireExtent | null;
}

/**
 * Preview content-width preset (penmark.contentWidth). All presets are
 * responsive — `max-width` only caps how wide the content column may grow, so it
 * always shrinks to fit a narrow/split pane. "full" grows to a 1600px ceiling.
 */
export type ContentWidth = "comfortable" | "wide" | "full";

export type { TypographySettings, FrontmatterFields };

export type PreviewSettingKey =
  | "theme"
  | "preset"
  | "textSize"
  | "contentWidth"
  | "comments.highlightIntensity"
  | "lineHeight";

export type PreviewSettingValue = string | number;

export type HighlightIntensity = "subtle" | "medium" | "strong";

export interface PreviewSettingsState {
  theme: ThemeMode;
  preset: PresetName;
  textSize: TextSize;
  contentWidth: ContentWidth;
  highlightIntensity: HighlightIntensity;
  /** Raw override. Zero means use the active preset's line height. */
  lineHeight: number;
}

/** Export target format (R17). */
export type ExportKind = "html" | "pdf";

/** Page-margin preset for PDF export (R17). Millimetre values live host-side. */
export type PdfMarginPreset = "narrow" | "normal" | "wide";

/**
 * Per-export options chosen in the export dialog (R17). Exports always render
 * on the light theme (maintainer decision 2026-07-07) — theme is not an option.
 * The `pdf*` fields are ignored for HTML exports, except that the `@page`
 * setup they describe is still emitted so printing the HTML from a browser
 * approximates the PDF command.
 */
export interface ExportOptions {
  /** Include the frontmatter metadata card. Default false. */
  includeFrontmatter: boolean;
  /** Prepend a generated table of contents (h1–h3). Default false. */
  includeToc: boolean;
  /** Content column width of the exported document. */
  width: ContentWidth;
  pdfPageSize: "a4" | "letter";
  pdfMargin: PdfMarginPreset;
  /** Print a running header (title) and footer (page N of M). Default true. */
  pdfHeaderFooter: boolean;
}

/** Messages sent from the extension host to the webview. */
export type HostToWebview =
  | {
      v: 1;
      type: "render";
      html: string;
      theme: ThemeMode;
      docName: string;
      comments: WireComment[];
      attention: number;
      typography?: TypographySettings;
      frontmatter?: FrontmatterFields;
      settings?: PreviewSettingsState;
      /** Host-configured export defaults, pre-filling the export dialog (R17). */
      exportDefaults?: ExportOptions;
    }
  | { v: 1; type: "comments"; comments: WireComment[]; attention: number }
  | { v: 1; type: "setTheme"; theme: ThemeMode }
  | { v: 1; type: "setContentWidth"; contentWidth: ContentWidth }
  | { v: 1; type: "setTypography"; typography: TypographySettings }
  | { v: 1; type: "revealLine"; line: number }
  | { v: 1; type: "copied" }
  // Export capture (R17): ask the webview to force-render all mermaid diagrams
  // (always on the LIGHT theme — exports are light), strip preview-only chrome
  // from a clone of the rendered DOM, and post the serialized result back as
  // `exportCaptured` with the same requestId.
  | {
      v: 1;
      type: "exportCapture";
      requestId: string;
      includeFrontmatter: boolean;
      includeToc: boolean;
    }
  // Open the export options dialog (palette/menu command path). The topbar
  // Export button opens the same dialog webview-side without this message.
  | {
      v: 1;
      type: "exportShowOptions";
      kind: ExportKind;
      defaults: ExportOptions;
      requestId?: string;
    };

/**
 * Serialized preview DOM posted back for an `exportCapture` request (R17).
 * `html` is the cleaned `#penmark-root` innerHTML — already DOMPurify-sanitized
 * (it came out of the live preview DOM) with preview-only chrome stripped, and
 * always rendered on the light theme.
 */
export interface ExportCapturedPayload {
  requestId: string;
  ok: boolean;
  /** Present when ok=false: what went wrong (surfaced to the user). */
  error?: string;
  html: string;
  /** Outer HTML of the frontmatter card (only when requested and present). */
  frontmatterHtml?: string;
  /** Generated table of contents markup (only when requested and headings exist). */
  tocHtml?: string;
  /** Inline style of #penmark-root (typography CSS custom properties). */
  rootStyle: string;
}

/** Messages sent from the webview to the extension host. */
export type WebviewToHost =
  | { v: 1; type: "ready" }
  | { v: 1; type: "scrolled"; topLine: number }
  | { v: 1; type: "copyCode"; text: string }
  | { v: 1; type: "openLink"; href: string }
  | { v: 1; type: "themeSelected"; theme: ThemeMode }
  | { v: 1; type: "updateSetting"; key: PreviewSettingKey; value: PreviewSettingValue }
  | {
      v: 1;
      type: "addComment";
      range: { start: number; end: number };
      quote: string;
      body: string;
    }
  | { v: 1; type: "resolveComment"; id: string }
  | { v: 1; type: "editComment"; id: string; body: string }
  | { v: 1; type: "jumpToSource"; id: string }
  | { v: 1; type: "exportReview" }
  | { v: 1; type: "toggleTaskCheckbox"; line: number; checked: boolean }
  | ({ v: 1; type: "exportCaptured" } & ExportCapturedPayload)
  // Confirmed in the export options dialog — the host runs the export.
  | { v: 1; type: "exportRequest"; kind: ExportKind; options: ExportOptions };
