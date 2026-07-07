# Export smoke checklist — HTML / PDF (R17)

The manual cross-IDE gate for the export feature, run against the **sideloaded VSIX**. Automated CI already proves fidelity headlessly (Playwright preview-vs-export computed-style/geometry/SVG comparison, a real `--print-to-pdf` smoke, and the extension-host journey test); this checklist verifies the parts no harness covers — real menus, real save dialogs, a real system browser, and human eyes on the output.

Run it once per IDE (VS Code, Cursor, Antigravity) before a release that touches export, rendering, theming, or the webview.

## 0. Setup

- Install the VSIX (see the [release smoke checklist](release-smoke-checklist.md) §1 for per-IDE install commands).
- Open [`test/fixtures/export/showcase.md`](../../test/fixtures/export/showcase.md) from a checkout — it exercises every construct: frontmatter, headings, inline tokens, nested/ordered/task lists, blockquote, highlighted code, table, a Mermaid diagram with an authored `style` directive, an image, hr, and a footnote. Add a relative-path image (e.g. `![local](./some.png)`) next to it to exercise inlining.

## 1. Export as HTML

- [ ] Editor title context menu and editor context menu show **Penmark: Export as HTML** and **Penmark: Export as PDF** on `.md` files only.
- [ ] Run **Export as HTML** with the preview closed → the preview opens, a save dialog defaults to `showcase.html` next to the source, and the export completes with a toast + **Open in Browser**.
- [ ] Open the file in a browser. Compare side-by-side with the preview: identical headings, body font/size/line-height, link and inline-code styling, code-block colors (hljs tokens), table borders/zebra, blockquote tint, task checkboxes (checked state preserved, inert), footnote block.
- [ ] The Mermaid diagram is a crisp SVG (not a code block, not a blank box), including a green `style`-directive node; the frontmatter card shows expanded.
- [ ] Both images render; DevTools Network tab shows **zero requests** besides the document itself (fully self-contained, no scripts).
- [ ] Comment a span in the source, re-export → the exported doc shows **no highlight tint** and no `pmk` markers anywhere in the file.
- [ ] Switch the preview to dark (topbar toggle or `penmark.theme`), re-export → the exported doc is dark and matches the dark preview.
- [ ] Change `penmark.preset` to `reading`, re-export → serif body font and comfortable column width carry into the export.

## 2. Export as PDF

- [ ] Run **Export as PDF** → save dialog defaults to `showcase.pdf`; progress notification; toast with **Open PDF**.
- [ ] The PDF matches the preview: typography, colors (code-block and table-header backgrounds printed, not washed out), diagram vector-sharp when zoomed.
- [ ] Page breaks: no code block, table row, image, or diagram split across pages; no heading stranded at the bottom of a page; margins look like a document, not a screenshot.
- [ ] Flip `penmark.export.pdfPageSize` to `letter`, re-export → page size changes accordingly.
- [ ] Set `penmark.export.chromiumPath` to a nonsense path → the command fails fast with the "configured browser was not found" error offering **Export as HTML instead** and **Open Settings**; both actions work. Reset the setting.
- [ ] (Machine without Chrome/Edge/Chromium/Brave, if available) auto-discovery fails gracefully with the same offer.

## 3. Edge cases

- [ ] A markdown file with **no** frontmatter, diagrams, or images exports cleanly (no card, no empty containers).
- [ ] A document with a Mermaid diagram **below the fold** (never scrolled to) exports with the diagram rendered.
- [ ] A document with an invalid Mermaid diagram exports the per-diagram error box + source (page intact).
- [ ] A very large document (e.g. `test/fixtures/perf`) exports within the 30 s capture window.
- [ ] Export from the Penmark custom editor (Open with Penmark) — same results.

## Record

| IDE | Version | HTML | PDF | Notes |
|---|---|---|---|---|
| VS Code |  |  |  |  |
| Cursor |  |  |  |  |
| Antigravity |  |  |  |  |
