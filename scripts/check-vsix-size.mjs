/**
 * VSIX size gate — enforces a 1 MiB budget on the "core" bundle.
 *
 * Logic:
 *   - Reads the VSIX (a zip file) and lists every entry with its compressed size.
 *   - Partitions entries into mermaid chunks (dist/webview/mermaid* — lazy-loaded
 *     and excluded from the core budget) vs everything else ("core").
 *   - Fails with exit code 1 if core > CORE_LIMIT_BYTES (1 MiB).
 *   - Prints a per-file size table sorted by size descending, then totals.
 *
 * Usage:
 *   node scripts/check-vsix-size.mjs <path-to.vsix>
 *
 * The function `checkVsixSize(vsixPath)` is also exported so the vitest unit
 * test can call it against fixture zips without spawning a child process.
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const CORE_LIMIT_BYTES = 1 * 1024 * 1024; // 1 MiB

/**
 * Minimal zip central-directory parser (no extra deps — built-in Buffer only).
 * Returns an array of { name: string, compressedSize: number }.
 */
function parseZipEntries(buffer) {
  const EOCD_SIG = 0x06054b50;
  const CD_SIG = 0x02014b50;
  const entries = [];

  // Scan backwards for End-of-Central-Directory record.
  let eocdOffset = -1;
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIG) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    throw new Error("Not a valid ZIP file: EOCD record not found");
  }

  const cdSize = buffer.readUInt32LE(eocdOffset + 12);
  const cdOffset = buffer.readUInt32LE(eocdOffset + 16);

  let pos = cdOffset;
  while (pos < cdOffset + cdSize) {
    if (buffer.readUInt32LE(pos) !== CD_SIG) break;

    const compressedSize = buffer.readUInt32LE(pos + 20);
    const fnLen = buffer.readUInt16LE(pos + 28);
    const extraLen = buffer.readUInt16LE(pos + 30);
    const commentLen = buffer.readUInt16LE(pos + 32);
    const name = buffer.subarray(pos + 46, pos + 46 + fnLen).toString("utf8");

    entries.push({ name, compressedSize });
    pos += 46 + fnLen + extraLen + commentLen;
  }

  return entries;
}

/**
 * Determines whether an entry belongs to the "mermaid lazy chunks" bucket.
 * Pattern: dist/webview/mermaid* only (plan P0.4). Deliberately fail-closed:
 * a generic chunk-*.js produced by code splitting counts toward CORE, so an
 * unexpected lazy chunk busts the budget instead of being silently excluded.
 * T9 (mermaid lazy load) must land the chunk under a mermaid* filename.
 */
function isMermaidChunk(name) {
  return /dist\/webview\/mermaid[^/]*$/i.test(name);
}

/**
 * Core check function — exported for unit tests.
 * Returns { coreBytes, mermaidBytes, totalBytes, entries, passed }.
 * Does NOT call process.exit — throws on parse errors, returns result otherwise.
 */
export function checkVsixSize(vsixPath) {
  const buffer = fs.readFileSync(vsixPath);
  const entries = parseZipEntries(buffer);

  let coreBytes = 0;
  let mermaidBytes = 0;

  for (const e of entries) {
    if (isMermaidChunk(e.name)) {
      mermaidBytes += e.compressedSize;
    } else {
      coreBytes += e.compressedSize;
    }
  }

  const totalBytes = coreBytes + mermaidBytes;
  const passed = coreBytes <= CORE_LIMIT_BYTES;

  return { coreBytes, mermaidBytes, totalBytes, entries, passed };
}

function formatBytes(n) {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MiB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${n} B`;
}

/**
 * CLI entry point.
 */
function main() {
  const vsixPath = process.argv[2];
  if (!vsixPath) {
    console.error("Usage: node scripts/check-vsix-size.mjs <path-to.vsix>");
    process.exit(1);
  }

  if (!fs.existsSync(vsixPath)) {
    console.error(`File not found: ${vsixPath}`);
    process.exit(1);
  }

  let result;
  try {
    result = checkVsixSize(vsixPath);
  } catch (err) {
    console.error(`Failed to parse VSIX: ${err.message}`);
    process.exit(1);
  }

  const { coreBytes, mermaidBytes, totalBytes, entries, passed } = result;

  // Print table sorted by size descending.
  const sorted = [...entries].sort((a, b) => b.compressedSize - a.compressedSize);

  console.log("\nVSIX contents (compressed sizes):");
  console.log("-".repeat(70));
  for (const e of sorted) {
    const bucket = isMermaidChunk(e.name) ? "[mermaid]" : "[core]   ";
    const sizeStr = formatBytes(e.compressedSize).padStart(12);
    console.log(`  ${bucket}  ${sizeStr}  ${e.name}`);
  }
  console.log("-".repeat(70));
  console.log(`  [mermaid]  ${formatBytes(mermaidBytes).padStart(12)}  (excluded from core budget)`);
  console.log(`  [core]     ${formatBytes(coreBytes).padStart(12)}  / ${formatBytes(CORE_LIMIT_BYTES)} limit`);
  console.log(`  [total]    ${formatBytes(totalBytes).padStart(12)}`);
  console.log("-".repeat(70));

  if (passed) {
    console.log(`\nSize gate PASSED: core ${formatBytes(coreBytes)} <= ${formatBytes(CORE_LIMIT_BYTES)}\n`);
  } else {
    console.error(
      `\nSize gate FAILED: core ${formatBytes(coreBytes)} exceeds ${formatBytes(CORE_LIMIT_BYTES)} limit.\n` +
        `Reduce bundle size before shipping (mermaid chunks are excluded — check for accidental eager imports).\n`
    );
    process.exit(1);
  }
}

// Run only when invoked directly (not when imported by tests).
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main();
}
