# Configuration

Penmark is configured through standard editor settings (the Settings UI, or `settings.json`). All settings live under the `penmark.*` namespace. They can be set at user or workspace scope, and apply to the preview the next time it is opened.

The preview top bar also includes **Preview settings**, a webview-native panel for the most common reading controls (theme, typography preset, text size, content width, code wrapping, comment-highlight intensity). Changes made there are persisted to the same `penmark.*` settings and reflected in the open preview immediately where possible. An **Open all Penmark settings** link at the bottom of the panel opens the full Settings UI filtered to `penmark.*` for less-common options like font family and line height.

The panel and the comments drawer are adaptive side surfaces: at 1050px or wider the open Comments drawer reserves 342px of layout space beside the document (Settings always overlays, at any width); below 1050px both panels overlay the content; below 700px the open panel takes near the full viewport width. Only one panel is open at a time, and the document root persists across every open/close — no re-render. `Esc` closes the topmost open panel and returns focus to the control that opened it; if your OS is set to reduce motion, Penmark's own panel, control, and highlight transitions (and the comment-jump scroll) skip animation — native Find and dialogs are unaffected.

## Settings

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `penmark.theme` | `light` \| `dark` \| `auto` | `auto` | Preview theme. `auto` follows the IDE theme; `light` and `dark` override it independently of the IDE. |
| `penmark.scrollSync` | boolean | `true` | Synchronise the preview scroll position with the editor cursor (both directions). |
| `penmark.mermaid.enabled` | boolean | `true` | Render Mermaid diagrams in the preview. |
| `penmark.contentWidth` | `comfortable` \| `wide` \| `full` | `full` | How wide the content column may grow. All options stay responsive and shrink to fit a narrow pane; this only caps the maximum width. |
| `penmark.codeBlockWrap` | boolean | `true` | Visually wrap long lines in fenced code blocks. Disable to preserve horizontal layout and scrolling. |
| `penmark.comments.highlightIntensity` | `subtle` \| `medium` \| `strong` | `medium` | How strongly commented spans are tinted. Highlights are always shown when comments exist; this only sets the intensity. Applied when the preview is (re)opened. |
| `penmark.preset` | `github` \| `reading` \| `compact` \| `focus` \| `print` \| `custom` | `github` | Typography preset bundling font, size, line height, and content width. |
| `penmark.textSize` | `small` \| `medium` \| `large` \| `x-large` | `medium` | Body text size; heading sizes scale proportionally. |
| `penmark.fontFamily` | string | `""` | CSS `font-family` for body text. Empty uses the preset default. |
| `penmark.headingFontFamily` | string | `""` | CSS `font-family` for headings. Empty uses the preset default. |
| `penmark.lineHeight` | number | `0` | Line height multiplier (e.g. `1.5`). `0` uses the preset default. |
| `penmark.export.includeFrontmatter` | boolean | `false` | Export-dialog default: include the frontmatter metadata card. |
| `penmark.export.toc` | boolean | `false` | Export-dialog default: prepend a generated table of contents (h1–h3). |
| `penmark.export.width` | `preview` \| `comfortable` \| `wide` \| `full` | `preview` | Export-dialog default content width. `preview` follows the preview's current width. |
| `penmark.export.pdfPageSize` | `a4` \| `letter` | `a4` | Export-dialog default paper size for PDF (and the print stylesheet of exported HTML). |
| `penmark.export.pdfMargin` | `narrow` \| `normal` \| `wide` | `normal` | Export-dialog default page margins for PDF (12 / 18 / 25 mm). |
| `penmark.export.pdfHeaderFooter` | boolean | `true` | Export-dialog default: print a running header (title) and footer (page numbers) on PDFs. |
| `penmark.export.chromiumPath` | string | `""` | Path to a Chromium-based browser executable used for **Export as PDF**. Empty auto-detects Chrome, Edge, Chromium, or Brave in their standard install locations. |

### `penmark.contentWidth` values

- `comfortable` — narrow column (~860px), the most comfortable line length for reading prose.
- `wide` — wider column (~1200px), more room for diagrams and tables.
- `full` — fill the panel (responsive, up to ~1600px); diagrams and tables get the most width.

### `penmark.comments.highlightIntensity` values

- `subtle` — faint tint, least distracting over prose.
- `medium` — balanced tint (the default).
- `strong` — bold tint, most visible.

### `penmark.preset` values

- `github` — match the GitHub/built-in preview reading experience (default).
- `reading` — serif body, larger text, relaxed line height.
- `compact` — dense layout for reference docs.
- `focus` — narrow measure, large text for distraction-free reading.
- `print` — high-contrast conservative type.
- `custom` — individual knobs below take effect.

## Keyboard shortcuts (preview webview)

When the preview panel has focus:

| Key | Action |
| --- | --- |
| `d` | Toggle comments drawer |
| `j` / `k` | Next / previous drawer item (drawer open) |
| `n` / `p` | Next / previous comment highlight |
| `?` | Toggle shortcut help |
| `Esc` | Close topmost overlay |

## How to set them

**Settings UI:** open Settings (Cmd/Ctrl+,), search for "Penmark", and adjust the fields.

**`settings.json`:** add the keys directly, for example:

```json
{
  "penmark.theme": "dark",
  "penmark.contentWidth": "comfortable",
  "penmark.comments.highlightIntensity": "strong"
}
```

Workspace settings (`.vscode/settings.json`) override user settings, so you can pin a per-project preview style.

Theme, content width, typography preset, text size, code wrapping, and highlight intensity are exposed in the preview settings panel for quick adjustment; line height and other less-common options are one click away via the panel's "Open all Penmark settings" link. Settings changed outside the preview generally take effect when the preview is next opened. If a change does not appear, close and reopen the Penmark preview.
