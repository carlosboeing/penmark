// Dual-entry build (ADR 0001 / plan P0.2): extension host (Node/CJS) + webview (browser/ESM).
import * as esbuild from "esbuild";
import { writeFileSync, mkdirSync, copyFileSync, readdirSync } from "fs";
import { join } from "path";

const prod = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

const common = {
  bundle: true,
  minify: prod,
  sourcemap: !prod,
  logLevel: "info",
  // Emit metafile so bundle size can be inspected after each build (D6 size gate).
  metafile: true,
};

const builds = [
  {
    ...common,
    entryPoints: ["src/vscode/extension.ts"],
    outfile: "dist/extension.js",
    platform: "node",
    format: "cjs",
    // "./hljs.js" and "./render.js" are marked external so the lazy import()s
    // (hljsLoader.ts and previewPanel.ts) are emitted literally rather than
    // inlining highlight.js / the markdown-it render stack into extension.js.
    // They resolve to the sibling dist/hljs.js and dist/render.js at runtime.
    // Keeping the render stack out of extension.js keeps activate() within the
    // <50 ms budget (design §8) — markdown-it is evaluated on first render, not
    // at activation (T12). dist/render.js still counts toward the core budget.
    external: ["vscode", "./hljs.js", "./render.js"],
  },
  {
    ...common,
    entryPoints: ["src/hljs.ts"],
    outfile: "dist/hljs.js",
    platform: "node",
    format: "cjs",
  },
  {
    ...common,
    entryPoints: ["src/vscode/render.ts"],
    outfile: "dist/render.js",
    platform: "node",
    format: "cjs",
    external: ["vscode"],
  },
  {
    ...common,
    entryPoints: ["src/webview/main.ts"],
    outfile: "dist/webview/main.js",
    platform: "browser",
    format: "esm",
    // The mermaid lazy chunk is built as a SEPARATE single-file bundle (below)
    // and marked external here so main.ts's `import("./mermaid.js")` is emitted
    // literally rather than pulling mermaid into main.js. No code splitting on
    // main: it stays a single small file, no stray chunk-*.js (T9 size gate).
    external: ["./mermaid.js"],
  },
  {
    ...common,
    entryPoints: ["src/webview/mermaid.ts"],
    outfile: "dist/webview/mermaid.js",
    platform: "browser",
    format: "esm",
    // CRITICAL (T9 size gate): NO splitting. mermaid@11 internally code-splits
    // every diagram type + katex into separate dynamic chunks. With splitting on,
    // those land as flowDiagram-*.js / katex-*.js / chunk-*.js — none matching the
    // mermaid* exclusion in scripts/check-vsix-size.mjs, so all the multi-MB
    // payload would count toward the 1 MiB core budget and bust it. A single
    // non-split bundle forces mermaid + svg-pan-zoom into one dist/webview/
    // mermaid.js, which the gate excludes from core.
    splitting: false,
  },
];

/** Copy all *.css files from media/ into dist/media/. */
function copyMediaCss() {
  const srcDir = "media";
  const destDir = join("dist", "media");
  mkdirSync(destDir, { recursive: true });
  for (const file of readdirSync(srcDir)) {
    if (file.endsWith(".css")) {
      copyFileSync(join(srcDir, file), join(destDir, file));
    }
  }
}

if (watch) {
  copyMediaCss();
  const contexts = await Promise.all(builds.map((b) => esbuild.context(b)));
  await Promise.all(contexts.map((c) => c.watch()));
} else {
  const results = await Promise.all(builds.map((b) => esbuild.build(b)));
  copyMediaCss();
  // Write metafiles alongside their output for post-build size analysis.
  const names = ["extension", "hljs", "render", "webview", "mermaid"];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.metafile) {
      writeFileSync(`dist/meta-${names[i]}.json`, JSON.stringify(result.metafile));
    }
  }
}
