/**
 * Unit tests for scripts/check-vsix-size.mjs
 *
 * Fixture zips are built deterministically in-memory using raw Buffer writes so
 * there are no committed binary fixtures and no external tooling required.
 *
 * Zip structure used (Store method, no compression, single entry per fixture):
 *   Local file header  + data  (per entry)
 *   Central directory entry    (per entry)
 *   End-of-central-directory record
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// ---------------------------------------------------------------------------
// Minimal deterministic zip builder (Store / method 0, no compression).
// The central-directory offsets the parser actually reads.
// ---------------------------------------------------------------------------

interface ZipEntry {
  name: string;
  /** Raw bytes to store (compressed == uncompressed for Store). */
  data: Buffer;
}

function buildZip(entries: ZipEntry[]): Buffer {
  const parts: Buffer[] = [];
  const cdEntries: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const data = entry.data;
    const crc32 = 0; // CRC not validated by our parser, safe to use 0 in fixtures.

    // Local file header (30 bytes + filename)
    const lhSize = 30 + nameBuf.length;
    const lh = Buffer.alloc(lhSize, 0);
    lh.writeUInt32LE(0x04034b50, 0); // local file header sig
    lh.writeUInt16LE(20, 4); // version needed
    lh.writeUInt16LE(0, 6); // general purpose flags
    lh.writeUInt16LE(0, 8); // compression method: Store
    lh.writeUInt16LE(0, 10); // mod time
    lh.writeUInt16LE(0, 12); // mod date
    lh.writeUInt32LE(crc32, 14); // CRC-32
    lh.writeUInt32LE(data.length, 18); // compressed size
    lh.writeUInt32LE(data.length, 22); // uncompressed size
    lh.writeUInt16LE(nameBuf.length, 26); // filename length
    lh.writeUInt16LE(0, 28); // extra field length
    nameBuf.copy(lh, 30);

    parts.push(lh);
    parts.push(data);

    // Central directory entry (46 bytes + filename)
    const cdEntry = Buffer.alloc(46 + nameBuf.length, 0);
    cdEntry.writeUInt32LE(0x02014b50, 0); // central dir sig
    cdEntry.writeUInt16LE(20, 4); // version made by
    cdEntry.writeUInt16LE(20, 6); // version needed
    cdEntry.writeUInt16LE(0, 8); // flags
    cdEntry.writeUInt16LE(0, 10); // compression method
    cdEntry.writeUInt16LE(0, 12); // mod time
    cdEntry.writeUInt16LE(0, 14); // mod date
    cdEntry.writeUInt32LE(crc32, 16); // CRC-32
    cdEntry.writeUInt32LE(data.length, 20); // compressed size
    cdEntry.writeUInt32LE(data.length, 24); // uncompressed size
    cdEntry.writeUInt16LE(nameBuf.length, 28); // filename length
    cdEntry.writeUInt16LE(0, 30); // extra field length
    cdEntry.writeUInt16LE(0, 32); // file comment length
    cdEntry.writeUInt16LE(0, 34); // disk number start
    cdEntry.writeUInt16LE(0, 36); // int file attributes
    cdEntry.writeUInt32LE(0, 38); // ext file attributes
    cdEntry.writeUInt32LE(offset, 42); // relative offset of local header
    nameBuf.copy(cdEntry, 46);

    cdEntries.push(cdEntry);
    offset += lhSize + data.length;
  }

  const cdBuffer = Buffer.concat(cdEntries);
  const cdOffset = offset;
  const cdSize = cdBuffer.length;

  // End-of-central-directory record (22 bytes)
  const eocd = Buffer.alloc(22, 0);
  eocd.writeUInt32LE(0x06054b50, 0); // EOCD sig
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk with CD
  eocd.writeUInt16LE(entries.length, 8); // entries on this disk
  eocd.writeUInt16LE(entries.length, 10); // total entries
  eocd.writeUInt32LE(cdSize, 12); // CD size
  eocd.writeUInt32LE(cdOffset, 16); // CD offset
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...parts, cdBuffer, eocd]);
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const CORE_LIMIT = 1 * 1024 * 1024; // 1 MiB — must match the script constant

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "penmark-vsix-test-"));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeTmpZip(name: string, zip: Buffer): string {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, zip);
  return p;
}

// Fixture A — normal VSIX: core = 512 KiB, mermaid chunk = 900 KiB
// Core is well under the 1 MiB limit.
function buildNormalFixture(): Buffer {
  return buildZip([
    { name: "extension/package.json", data: Buffer.alloc(10 * 1024) },
    { name: "extension/dist/extension.js", data: Buffer.alloc(512 * 1024) },
    { name: "extension/dist/webview/main.js", data: Buffer.alloc(20 * 1024) },
    // mermaid lazy chunk — excluded from core budget (dist/webview/mermaid*, plan P0.4)
    { name: "extension/dist/webview/mermaid-3AYPVQGM.js", data: Buffer.alloc(900 * 1024) },
    { name: "extension/README.md", data: Buffer.alloc(2 * 1024) },
    { name: "extension/LICENSE", data: Buffer.alloc(1 * 1024) },
  ]);
}

// Fixture B — oversize VSIX: core = 2 MiB (exceeds 1 MiB limit).
// Mermaid chunk is present but the core bundle is bloated.
function buildOversizeFixture(): Buffer {
  return buildZip([
    { name: "extension/package.json", data: Buffer.alloc(10 * 1024) },
    { name: "extension/dist/extension.js", data: Buffer.alloc(2 * 1024 * 1024) },
    { name: "extension/dist/webview/main.js", data: Buffer.alloc(30 * 1024) },
    // mermaid chunk — still excluded
    { name: "extension/dist/webview/mermaid-3AYPVQGM.js", data: Buffer.alloc(900 * 1024) },
  ]);
}

// Fixture C — fail-closed check: a generic code-split chunk that is NOT named
// mermaid* must count toward the core budget. 1.5 MiB chunk alone busts the gate.
function buildUnknownChunkFixture(): Buffer {
  return buildZip([
    { name: "extension/package.json", data: Buffer.alloc(10 * 1024) },
    { name: "extension/dist/extension.js", data: Buffer.alloc(100 * 1024) },
    { name: "extension/dist/webview/main.js", data: Buffer.alloc(20 * 1024) },
    // generic esbuild chunk — NOT excluded; the gate must fail closed
    { name: "extension/dist/webview/chunk-AB12CD34.js", data: Buffer.alloc(1536 * 1024) },
  ]);
}

// ---------------------------------------------------------------------------
// Import the module under test
// ---------------------------------------------------------------------------

// The script is plain ESM JS; ts-ignore suppresses the "no declaration file"
// error that comes from moduleResolution:bundler not resolving .mjs.d.ts.
// The .d.ts at scripts/check-vsix-size.mjs.d.ts types it at runtime for editors.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain ESM script, typed via scripts/check-vsix-size.mjs.d.ts
import { checkVsixSize } from "../../../scripts/check-vsix-size.mjs";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("checkVsixSize", () => {
  it("passes for a normal VSIX whose core bundle is under 1 MiB", () => {
    const vsixPath = writeTmpZip("normal.vsix", buildNormalFixture());
    const result = checkVsixSize(vsixPath);

    expect(result.passed).toBe(true);
    expect(result.coreBytes).toBeLessThanOrEqual(CORE_LIMIT);
    // mermaid chunk must be classified correctly
    expect(result.mermaidBytes).toBeGreaterThan(0);
  });

  it("fails for an oversize VSIX whose core bundle exceeds 1 MiB", () => {
    const vsixPath = writeTmpZip("oversize.vsix", buildOversizeFixture());
    const result = checkVsixSize(vsixPath);

    expect(result.passed).toBe(false);
    expect(result.coreBytes).toBeGreaterThan(CORE_LIMIT);
    // mermaid chunk is still excluded even in oversize fixture
    expect(result.mermaidBytes).toBeGreaterThan(0);
  });

  it("correctly excludes mermaid chunk from core bytes", () => {
    const vsixPath = writeTmpZip("mermaid-check.vsix", buildNormalFixture());
    const result = checkVsixSize(vsixPath);

    // The mermaid chunk is 900 KiB; core must NOT include it.
    expect(result.mermaidBytes).toBeGreaterThanOrEqual(900 * 1024);
    expect(result.coreBytes).toBeLessThan(result.mermaidBytes);
  });

  it("returns all entries in the result", () => {
    const vsixPath = writeTmpZip("entries-check.vsix", buildNormalFixture());
    const result = checkVsixSize(vsixPath);

    // buildNormalFixture has 6 entries
    expect(result.entries).toHaveLength(6);
  });

  it("counts a non-mermaid code-split chunk toward core (fail closed)", () => {
    const vsixPath = writeTmpZip("unknown-chunk.vsix", buildUnknownChunkFixture());
    const result = checkVsixSize(vsixPath);

    // chunk-AB12CD34.js is not a mermaid* file — it must land in core and bust the gate
    expect(result.mermaidBytes).toBe(0);
    expect(result.coreBytes).toBeGreaterThan(CORE_LIMIT);
    expect(result.passed).toBe(false);
  });

  it("throws on an invalid (non-zip) file", () => {
    const p = path.join(tmpDir, "bad.vsix");
    fs.writeFileSync(p, Buffer.from("not a zip file at all"));
    expect(() => checkVsixSize(p)).toThrow(/EOCD record not found/);
  });
});
