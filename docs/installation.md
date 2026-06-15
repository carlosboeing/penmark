# Installation

Penmark is **local-first**: it is distributed as a VSIX you sideload, not published to a marketplace. It runs in VS Code, Cursor, and Antigravity (all VS Code forks).

## Requirements

An IDE on the `^1.105.0` engine floor:

- VS Code 1.105 or newer
- Cursor 1.105 or newer
- Antigravity 1.107 or newer

## 1. Download the VSIX

Download the latest `penmark-markdown-review-<version>.vsix` from the [Releases page](https://github.com/carlosboeing/penmark/releases).

## 2. Install (per IDE)

Each IDE is a VS Code fork with its own CLI binary. Use the UI path if the CLI is not on your `PATH`. If you are upgrading, uninstall any earlier Penmark build first.

| IDE | CLI | UI |
| --- | --- | --- |
| VS Code | `code --install-extension penmark-markdown-review-<version>.vsix` | Extensions view -> `...` menu -> **Install from VSIX...** |
| Cursor | `cursor --install-extension penmark-markdown-review-<version>.vsix` | Extensions view -> `...` menu -> **Install from VSIX...** |
| Antigravity | `antigravity --install-extension penmark-markdown-review-<version>.vsix` | Extensions view -> `...` menu -> **Install from VSIX...** |

## 3. Reload

Reload the window if prompted.

## Verify

Open any markdown file and run **Penmark: Open Preview to the Side** from the Command Palette (or the editor title bar). A preview panel opens beside the editor. See [usage.md](usage.md) for the full workflow.

## Updating

Download the newer VSIX, uninstall the current Penmark build, install the new one, and reload the window.

## Building from source

To build the VSIX yourself, clone the repo and run `npm run package` — it produces `penmark-markdown-review-<version>.vsix` in the repo root. See [CONTRIBUTING.md](../CONTRIBUTING.md) for the dev setup, prerequisites, and test layers.
