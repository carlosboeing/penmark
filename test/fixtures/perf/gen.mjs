/* global process, console */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Deterministic performance-fixture generator (T12).
 *
 * Produces the two documents the v0.1 performance budget gate (design §8) is
 * measured against:
 *   - a ~1,000-line doc            → "first render < 300 ms" budget
 *   - a ~10,000-line doc + 200 pmk → "10k-line doc with 200 comments stays
 *     anchors                        interactive" budget
 *
 * The content is fully deterministic — no Date.now(), no Math.random(). The
 * same byte stream is produced on every run, so the fixtures are stable inputs
 * for the layer-1 vitest bench and the layer-3 Playwright spec, and the optional
 * on-disk copies (test/fixtures/perf/*.md) never produce a spurious git diff.
 *
 * The generators are exported so both vitest (node) and Playwright (which imports
 * this module through the harness/page) can build the docs in-memory; running
 * this file directly also writes the .md copies for manual inspection.
 *
 * The shape mixes the block types the renderer actually has to work on a real
 * design/plan/research doc: headings, prose paragraphs, bullet + ordered lists,
 * GFM tables, blockquotes, fenced code (so the highlight hook runs), and the
 * occasional inline-code/emphasis run — representative load, not a pathological
 * worst case.
 */

/**
 * A tiny deterministic pseudo-word picker. Indexes a fixed lexicon by a counter
 * so successive calls cycle through varied-but-fixed words — gives the renderer
 * realistic token variety without any randomness.
 */
const LEXICON = [
  "render",
  "anchor",
  "comment",
  "preview",
  "markdown",
  "webview",
  "sanitize",
  "morphdom",
  "budget",
  "latency",
  "throughput",
  "incremental",
  "deterministic",
  "reconcile",
  "degradation",
  "offset",
  "diagram",
  "highlight",
  "scroll",
  "theme",
];

/** Build a deterministic sentence of `n` words seeded by `seed`. */
function sentence(seed, n) {
  const words = [];
  for (let i = 0; i < n; i++) {
    words.push(LEXICON[(seed + i * 7) % LEXICON.length]);
  }
  const text = words.join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1) + ".";
}

/** A deterministic paragraph: a few sentences, with one inline-code + emphasis run. */
function paragraph(seed) {
  const a = sentence(seed, 8);
  const b = sentence(seed + 3, 10);
  const c = sentence(seed + 5, 6);
  return `${a} The \`createRenderer\` pipeline keeps the *measure* honest; ${b} ${c}`;
}

/**
 * Emit one "section" of mixed blocks. Returns an array of lines. The block kind
 * rotates by `seed` so the document is heterogeneous but reproducible.
 */
function section(seed) {
  const lines = [];
  lines.push(`## Section ${seed} — ${sentence(seed, 4).replace(/\.$/, "")}`);
  lines.push("");
  lines.push(paragraph(seed));
  lines.push("");

  const kind = seed % 4;
  if (kind === 0) {
    // Bullet list.
    for (let i = 0; i < 4; i++) lines.push(`- ${sentence(seed + i, 6)}`);
  } else if (kind === 1) {
    // Ordered list.
    for (let i = 0; i < 4; i++) lines.push(`${i + 1}. ${sentence(seed + i, 6)}`);
  } else if (kind === 2) {
    // GFM table.
    lines.push("| Metric | Budget | Layer |");
    lines.push("| ------ | ------ | ----- |");
    for (let i = 0; i < 3; i++) {
      lines.push(`| ${LEXICON[(seed + i) % LEXICON.length]} | ${(seed + i) % 500} ms | ${(i % 4) + 1} |`);
    }
  } else {
    // Blockquote + fenced code (exercises the highlight hook).
    lines.push(`> ${sentence(seed, 12)}`);
    lines.push("");
    lines.push("```ts");
    lines.push(`const value${seed} = ${seed}; // ${sentence(seed, 3)}`);
    lines.push(`function f${seed}(x: number): number { return x + ${seed}; }`);
    lines.push("```");
  }
  lines.push("");
  return lines;
}

/**
 * Generate a markdown document of at least `targetLines` lines.
 * @param {number} targetLines minimum number of lines to emit
 * @param {string} title H1 title for the document
 * @returns {string} the markdown source (newline-terminated)
 */
function genDoc(targetLines, title) {
  const lines = [`# ${title}`, ""];
  let seed = 1;
  while (lines.length < targetLines) {
    for (const l of section(seed)) lines.push(l);
    seed++;
  }
  return lines.join("\n") + "\n";
}

/**
 * Generate a ~1,000-line markdown document (no anchors).
 * Used for the "first render < 300 ms for a 1k-line doc" budget (design §8).
 * @returns {string}
 */
export function gen1kDoc() {
  return genDoc(1000, "Penmark perf fixture — 1k lines");
}

/**
 * Generate a ~10,000-line markdown document carrying exactly 200 span anchor
 * pairs (`pmk:s`) plus the matching `pmk:review` block of 200 entries. Used for
 * the "10k-line doc with 200 comments stays interactive" budget (design §8).
 *
 * Anchors are deterministic 8-char base32 ids derived from their index, wrapped
 * around an inline word so they exercise the real span-highlight render path.
 * @returns {string}
 */
export function gen10kDoc() {
  const ANCHOR_COUNT = 200;
  const lines = ["# Penmark perf fixture — 10k lines + 200 anchors", ""];

  /** Deterministic 8-char base32 (a-z2-7) id from an index. */
  const id = (n) => {
    const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
    let out = "";
    // Mix the index so successive ids are not visually sequential, but stay fixed.
    let v = (n + 1) * 2654435761; // Knuth multiplicative hash constant
    for (let i = 0; i < 8; i++) {
      out += alphabet[(v >>> (i * 4)) & 31];
    }
    return out;
  };

  const anchorIds = [];
  let seed = 1;
  let placed = 0;
  // Place one anchor every few sections so the 200 anchors are spread across the
  // whole 10k-line document (not clustered) — closer to a real review session.
  while (lines.length < 10000 || placed < ANCHOR_COUNT) {
    const sec = section(seed);
    // Inject an anchored span into the section's first paragraph line when we
    // still have anchors to place (the paragraph is at a fixed offset in `sec`).
    if (placed < ANCHOR_COUNT) {
      const aid = id(placed);
      anchorIds.push(aid);
      const paraIdx = 2; // [heading, "", paragraph, ...]
      sec[paraIdx] =
        `This is <!--pmk:s ${aid}-->anchored span ${placed}<!--/pmk:s ${aid}--> in context. ` +
        sec[paraIdx];
      placed++;
    }
    for (const l of sec) lines.push(l);
    seed++;
  }

  // Append the review block: one entry per anchor (the §4.2 chat shape).
  lines.push("<!-- pmk:review v1 -->");
  for (let i = 0; i < anchorIds.length; i++) {
    lines.push(`<!--pmk:c ${anchorIds[i]}`);
    lines.push(`reviewer (human) · 2026-06-13 09:0${i % 10}:00 +10:00`);
    lines.push(`> anchored span ${i}`);
    lines.push("");
    lines.push(`Review note number ${i} on the anchored span.`);
    lines.push("-->");
  }
  lines.push("<!-- /pmk:review -->");

  return lines.join("\n") + "\n";
}

/**
 * Write the .md copies (doc-1k.md, doc-10k.md) next to this generator, for
 * manual inspection. The fixtures are deterministic, so re-running never changes
 * the committed bytes.
 */
export function writeFixtures() {
  const here = dirname(fileURLToPath(import.meta.url));
  writeFileSync(join(here, "doc-1k.md"), gen1kDoc(), "utf8");
  writeFileSync(join(here, "doc-10k.md"), gen10kDoc(), "utf8");
}

// When run directly (node test/fixtures/perf/gen.mjs), write the copies. The
// import.meta.url guard keeps writeFixtures() out of the way when the module is
// imported by tests. No top-level await — Playwright's CJS loader requires this
// module, and a TLA graph cannot be require()d.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  writeFixtures();
  console.log("wrote doc-1k.md and doc-10k.md");
}
