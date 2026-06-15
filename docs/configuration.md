# Configuration

Penmark is configured through standard editor settings (the Settings UI, or `settings.json`). All settings live under the `penmark.*` namespace. They can be set at user or workspace scope, and apply to the preview the next time it is opened.

## Settings

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `penmark.theme` | `light` \| `dark` \| `auto` | `auto` | Preview theme. `auto` follows the IDE theme; `light` and `dark` override it independently of the IDE. |
| `penmark.scrollSync` | boolean | `true` | Synchronise the preview scroll position with the editor cursor (both directions). |
| `penmark.mermaid.enabled` | boolean | `true` | Render Mermaid diagrams in the preview. |
| `penmark.contentWidth` | `comfortable` \| `wide` \| `full` | `full` | How wide the content column may grow. All options stay responsive and shrink to fit a narrow pane; this only caps the maximum width. |
| `penmark.comments.highlightIntensity` | `subtle` \| `medium` \| `strong` | `medium` | How strongly commented spans are tinted. Highlights are always shown when comments exist; this only sets the intensity. Applied when the preview is (re)opened. |

### `penmark.contentWidth` values

- `comfortable` — narrow column (~860px), the most comfortable line length for reading prose.
- `wide` — wider column (~1200px), more room for diagrams and tables.
- `full` — fill the panel (responsive, up to ~1600px); diagrams and tables get the most width.

### `penmark.comments.highlightIntensity` values

- `subtle` — faint tint, least distracting over prose.
- `medium` — balanced tint (the default).
- `strong` — bold tint, most visible.

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

Most settings take effect when the preview is next opened. If a change does not appear, close and reopen the Penmark preview.
