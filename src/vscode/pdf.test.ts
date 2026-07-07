/**
 * Unit tests for the PDF printer (R17, ADR 0007): browser discovery order,
 * print argument shape, and failure containment. The REAL spawn + Chromium
 * print path is exercised end-to-end by test/browser/export.spec.ts.
 */
import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it, expect } from "vitest";
import { buildPrintArgs, candidateBrowsers, findChromium, printHtmlToPdf } from "./pdf.js";

describe("candidateBrowsers", () => {
  it("lists Chrome first on every platform", () => {
    expect(candidateBrowsers("darwin")[0]).toContain("Google Chrome");
    expect(candidateBrowsers("linux")[0]).toContain("google-chrome");
    expect(
      candidateBrowsers("win32", { ProgramFiles: "C:\\Program Files" })[0],
    ).toContain("chrome.exe");
  });

  it("expands every available Windows root and skips missing ones", () => {
    const list = candidateBrowsers("win32", {
      ProgramFiles: "C:\\Program Files",
      LOCALAPPDATA: "C:\\Users\\x\\AppData\\Local",
    });
    expect(list).toContain("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe");
    expect(list).toContain(
      "C:\\Users\\x\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe",
    );
    expect(list.some((p) => p.includes("msedge.exe"))).toBe(true);
    expect(list.every((p) => !p.includes("undefined"))).toBe(true);
  });
});

describe("findChromium", () => {
  it("prefers the explicit setting and validates only its existence", async () => {
    const exists = async (p: string): Promise<boolean> => p === "/custom/chrome";
    expect(await findChromium("/custom/chrome", "linux", exists)).toBe("/custom/chrome");
    expect(await findChromium("/custom/missing", "linux", exists)).toBeNull();
  });

  it("falls back to the first existing well-known candidate", async () => {
    const exists = async (p: string): Promise<boolean> => p === "/usr/bin/chromium";
    expect(await findChromium(undefined, "linux", exists)).toBe("/usr/bin/chromium");
    expect(await findChromium("", "linux", exists)).toBe("/usr/bin/chromium");
  });

  it("returns null when nothing exists", async () => {
    expect(await findChromium(undefined, "linux", async () => false)).toBeNull();
  });
});

describe("buildPrintArgs", () => {
  it("prints headless without header/footer, file URL last", () => {
    const args = buildPrintArgs("/tmp/in.html", "/tmp/out.pdf", ["--no-sandbox"]);
    expect(args).toContain("--headless");
    expect(args).toContain("--no-pdf-header-footer");
    expect(args).toContain("--print-to-pdf=/tmp/out.pdf");
    expect(args).toContain("--no-sandbox");
    expect(args[args.length - 1]).toMatch(/^file:\/\/.*in\.html$/);
  });
});

/** A fake child process the injectable spawn seam can return. */
class FakeChild extends EventEmitter {
  stderr = new EventEmitter();
  killed = false;
  kill(): boolean {
    this.killed = true;
    return true;
  }
}

function fakeSpawn(setup: (child: FakeChild) => void): typeof import("node:child_process").spawn {
  return (() => {
    const child = new FakeChild();
    queueMicrotask(() => {
      setup(child);
    });
    return child;
  }) as unknown as typeof import("node:child_process").spawn;
}

describe("printHtmlToPdf", () => {
  it("rejects with the stderr tail on a non-zero exit", async () => {
    const spawnFn = fakeSpawn((child) => {
      child.stderr.emit("data", Buffer.from("something exploded\n"));
      child.emit("close", 21);
    });
    await expect(
      printHtmlToPdf("/fake/chrome", "/tmp/in.html", "/tmp/out.pdf", { spawnFn }),
    ).rejects.toThrow(/code 21.*something exploded/s);
  });

  it("rejects when the browser cannot be started", async () => {
    const spawnFn = fakeSpawn((child) => {
      child.emit("error", new Error("ENOENT"));
    });
    await expect(
      printHtmlToPdf("/fake/chrome", "/tmp/in.html", "/tmp/out.pdf", { spawnFn }),
    ).rejects.toThrow(/could not start browser/);
  });

  it("kills the browser and rejects on timeout", async () => {
    const spawnFn = fakeSpawn(() => {
      /* never exits */
    });
    await expect(
      printHtmlToPdf("/fake/chrome", "/tmp/in.html", "/tmp/out.pdf", {
        spawnFn,
        timeoutMs: 50,
      }),
    ).rejects.toThrow(/did not finish within 50 ms/);
  });

  it("rejects a zero-exit run whose output is missing or not a PDF", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "penmark-pdf-test-"));
    const okSpawn = fakeSpawn((child) => {
      child.emit("close", 0);
    });

    // Missing output file.
    await expect(
      printHtmlToPdf("/fake/chrome", "/tmp/in.html", path.join(dir, "missing.pdf"), {
        spawnFn: okSpawn,
      }),
    ).rejects.toThrow(/produced no PDF/);

    // Present but not a PDF (e.g. an HTML error page).
    const bogus = path.join(dir, "bogus.pdf");
    fs.writeFileSync(bogus, "<html>nope</html>");
    await expect(
      printHtmlToPdf("/fake/chrome", "/tmp/in.html", bogus, { spawnFn: okSpawn }),
    ).rejects.toThrow(/not a valid PDF/);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("resolves when the output starts with the %PDF- magic", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "penmark-pdf-test-"));
    const out = path.join(dir, "ok.pdf");
    fs.writeFileSync(out, "%PDF-1.7\n%fake minimal body");
    const spawnFn = fakeSpawn((child) => {
      child.emit("close", 0);
    });

    await expect(
      printHtmlToPdf("/fake/chrome", "/tmp/in.html", out, { spawnFn }),
    ).resolves.toBeUndefined();

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
