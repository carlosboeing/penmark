# Troubleshooting

Common issues when sideloading and using Penmark. If something here does not resolve it, open an issue (see [CONTRIBUTING.md](../CONTRIBUTING.md)); for a suspected vulnerability, follow [SECURITY.md](../SECURITY.md) instead of filing a public issue.

## The preview command does not appear

- Make sure the focused file is markdown — the **Penmark: Open Preview to the Side** title-bar button and menu items only show for markdown files.
- Confirm the extension is installed and enabled in the Extensions view.
- Reload the window (Command Palette -> **Developer: Reload Window**).
- Check your IDE meets the engine floor (`^1.105.0`): VS Code 1.105+, Cursor 1.105+, Antigravity 1.107+. An older host will refuse to activate the extension.

## Install from VSIX fails or the CLI is not found

- Each IDE has its own CLI (`code`, `cursor`, `antigravity`). If the CLI is not on your `PATH`, use the UI path instead: Extensions view -> `...` menu -> **Install from VSIX...**.
- If a previous Penmark build is installed, uninstall it first, then install the new VSIX and reload. See [installation.md](installation.md).

## Mermaid diagrams do not render or look wrong

- Confirm `penmark.mermaid.enabled` is `true` (see [configuration.md](configuration.md)).
- Penmark renders mermaid under a strict nonce CSP and restores mermaid's intended styling via the CSSOM, so a diagram should match a standard GitHub / VS Code render.
- Known limitation: a diagram that hard-codes **light** backgrounds (for example sequence-diagram highlight bands or light subgraph fills) stays light in dark mode. Penmark honors author colors rather than overriding them, which matches GitHub's dark rendering.

## The preview does not follow my IDE theme

Set `penmark.theme` to `auto`. The `light` and `dark` values deliberately override the IDE theme; only `auto` follows it.

## Scroll sync jitters, or I want it off

Toggle `penmark.scrollSync`. With it on (the default), the editor and preview scroll together in both directions; turning it off stops both directions.

## A comment lost its place after editing

When an edit removes or destroys the text a comment was anchored to, the comment is never dropped silently — it moves to the drawer's **needs-attention** bucket (with its advisory quote) and an amber attention chip appears, so you can re-anchor or delete it. Resolving a comment deletes it; the git history of the file is the audit trail.

Known limitation (tracked): if a 3-way merge is hand-resolved by keeping **two** review blocks instead of unioning them, the non-EOF block's comments surface only via the corruption flag, not yet in needs-attention. No data is lost, and resolving such a conflict by unioning into one block is fully lossless.

## Diagnosing webview errors

Open the webview devtools (Command Palette -> **Developer: Open Webview Developer Tools**) and watch the console while you reproduce the issue. There should be no errors or CSP violations during open, render, theme switch, comment add or resolve, drawer open, or export; if you see one, include it in your issue report.
