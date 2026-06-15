/**
 * Mermaid lazy-chunk entry point (T9).
 *
 * main.ts does `await import("./mermaid.js")` only when a .pmk-mermaid container
 * exists. Because this file's basename is `mermaid`, esbuild emits it as
 * dist/webview/mermaid-[hash].js (chunkNames: "[name]-[hash]"). The size gate
 * (scripts/check-vsix-size.mjs) excludes dist/webview/mermaid* from the core
 * budget, so mermaid + svg-pan-zoom (multiple MB) stay out of core.
 *
 * Everything mermaid-related is STATICALLY imported here so it all bundles into
 * THIS one chunk — never spilling into a generic chunk-*.js that would count
 * toward core.
 *
 * ADR 0001: no vscode imports.
 */

export { renderMermaid } from "./mermaid/index.js";
