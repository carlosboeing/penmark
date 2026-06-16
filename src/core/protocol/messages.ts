/**
 * Versioned message protocol between the extension host and the webview.
 *
 * ADR 0001: this file is in src/core — no vscode imports.
 * Both sides import these types to stay in sync. The v field allows the host
 * and webview to detect mismatches when the protocol evolves.
 */

import type { CommentState, Provenance } from "../comments/types.js";
import type { TypographySettings } from "../settings/typography.js";
import type { FrontmatterFields } from "../render/frontmatter.js";

export const PROTOCOL_VERSION = 1;

export type ThemeMode = "light" | "dark" | "auto";

/** Comment highlight tint strength (penmark.comments.highlightIntensity). */
export type HighlightIntensity = "subtle" | "medium" | "strong";

/** Keys the in-preview settings panel may persist via updateSetting. */
export type PenmarkSettingKey =
  | "theme"
  | "preset"
  | "textSize"
  | "lineHeight"
  | "contentWidth"
  | "highlightIntensity";

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
      highlightIntensity?: HighlightIntensity;
    }
  | { v: 1; type: "comments"; comments: WireComment[]; attention: number }
  | { v: 1; type: "setTheme"; theme: ThemeMode }
  | { v: 1; type: "setContentWidth"; contentWidth: ContentWidth }
  | { v: 1; type: "setTypography"; typography: TypographySettings }
  | { v: 1; type: "setHighlightIntensity"; highlightIntensity: HighlightIntensity }
  | { v: 1; type: "revealLine"; line: number }
  | { v: 1; type: "copied" };

/** Messages sent from the webview to the extension host. */
export type WebviewToHost =
  | { v: 1; type: "ready" }
  | { v: 1; type: "scrolled"; topLine: number }
  | { v: 1; type: "copyCode"; text: string }
  | { v: 1; type: "openLink"; href: string }
  | { v: 1; type: "themeSelected"; theme: ThemeMode }
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
  | { v: 1; type: "updateSetting"; key: PenmarkSettingKey; value: string | number };
