/**
 * PDF printing over the Chrome DevTools Protocol pipe transport (R17).
 *
 * The CLI `--print-to-pdf` path (pdf.ts) cannot produce custom headers or
 * footers — its only knob is Chromium's default chrome, whose footer prints
 * the temp-file URL. Page numbers and a title header need `Page.printToPDF`,
 * so the browser is launched with `--remote-debugging-pipe`: CDP messages are
 * exchanged as NUL-delimited JSON over fds 3 (write) / 4 (read). No network
 * port, no websocket, no dependencies — plain child-process plumbing.
 *
 * pdf.ts's CLI printer remains the FALLBACK (without header/footer) when the
 * pipe path fails, so a quirky browser build degrades instead of blocking.
 *
 * Node-only, no vscode imports: unit tests drive the framing with in-memory
 * streams; the browser-test suite runs the real thing with Playwright's
 * Chromium.
 */

import { spawn as nodeSpawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Readable, Writable } from "node:stream";
import type { ExportOptions } from "../core/protocol/messages.js";
import { escapeHtml } from "../core/export/htmlDocument.js";

// ---------------------------------------------------------------------------
// CDP pipe connection (exported for unit tests)
// ---------------------------------------------------------------------------

interface CdpEvent {
  method: string;
  params?: Record<string, unknown>;
  sessionId?: string;
}

interface CdpResponse {
  id?: number;
  result?: Record<string, unknown>;
  error?: { message?: string; code?: number };
  method?: string;
  params?: Record<string, unknown>;
  sessionId?: string;
}

/**
 * Minimal CDP client over the `--remote-debugging-pipe` fd pair. Messages are
 * JSON, NUL-delimited, possibly split across stream chunks.
 */
export class CdpConnection {
  private buffer = "";
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (r: Record<string, unknown>) => void; reject: (e: Error) => void }
  >();
  private readonly eventWaiters: Array<{
    match: (e: CdpEvent) => boolean;
    resolve: (e: CdpEvent) => void;
  }> = [];
  private closed = false;

  constructor(
    private readonly writeStream: Writable,
    readStream: Readable,
  ) {
    readStream.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString("utf8");
      let nul: number;
      while ((nul = this.buffer.indexOf("\0")) >= 0) {
        const raw = this.buffer.slice(0, nul);
        this.buffer = this.buffer.slice(nul + 1);
        if (raw.trim() !== "") this.dispatch(raw);
      }
    });
    readStream.on("close", () => {
      this.failAll(new Error("browser closed the DevTools pipe"));
    });
    readStream.on("error", (err: Error) => {
      this.failAll(new Error(`DevTools pipe error: ${err.message}`));
    });
  }

  private dispatch(raw: string): void {
    let msg: CdpResponse;
    try {
      msg = JSON.parse(raw) as CdpResponse;
    } catch {
      return; // tolerate garbage on the pipe — never crash the export
    }
    if (typeof msg.id === "number") {
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      this.pending.delete(msg.id);
      if (msg.error) {
        pending.reject(new Error(msg.error.message ?? "CDP command failed"));
      } else {
        pending.resolve(msg.result ?? {});
      }
      return;
    }
    if (typeof msg.method === "string") {
      const event: CdpEvent = { method: msg.method, params: msg.params, sessionId: msg.sessionId };
      const idx = this.eventWaiters.findIndex((w) => w.match(event));
      if (idx >= 0) {
        const [waiter] = this.eventWaiters.splice(idx, 1);
        waiter!.resolve(event);
      }
    }
  }

  private failAll(err: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const { reject } of this.pending.values()) reject(err);
    this.pending.clear();
  }

  /** Send a CDP command and await its result. */
  send(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ): Promise<Record<string, unknown>> {
    if (this.closed) return Promise.reject(new Error("DevTools pipe already closed"));
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.writeStream.write(payload + "\0", (err) => {
        if (err) {
          this.pending.delete(id);
          reject(new Error(`DevTools pipe write failed: ${err.message}`));
        }
      });
    });
  }

  /** Resolve when an event matching `match` arrives. */
  waitForEvent(match: (e: CdpEvent) => boolean): Promise<CdpEvent> {
    return new Promise((resolve) => {
      this.eventWaiters.push({ match, resolve });
    });
  }
}

// ---------------------------------------------------------------------------
// Print settings
// ---------------------------------------------------------------------------

/** Paper sizes in inches (CDP takes inches). */
const PAPER_INCHES: Record<ExportOptions["pdfPageSize"], { w: number; h: number }> = {
  a4: { w: 8.27, h: 11.69 },
  letter: { w: 8.5, h: 11 },
};

/** Margin presets in inches (12mm / 18mm·16mm / 25mm·22mm, as in export.css). */
const MARGIN_INCHES: Record<ExportOptions["pdfMargin"], { v: number; h: number }> = {
  narrow: { v: 0.47, h: 0.47 },
  normal: { v: 0.71, h: 0.63 },
  wide: { v: 0.98, h: 0.87 },
};

/** What the print run needs from the export options, plus the doc title. */
export interface PdfPrintSettings {
  pageSize: ExportOptions["pdfPageSize"];
  margin: ExportOptions["pdfMargin"];
  headerFooter: boolean;
  title: string;
}

/**
 * Build the Page.printToPDF params for `settings`. Exported for unit tests.
 * Header shows the (escaped) document title left and the date right; the
 * footer centers "page / total". Chromium templates require inline styles and
 * its magic classes (pageNumber, totalPages, date).
 */
export function buildPrintToPdfParams(settings: PdfPrintSettings): Record<string, unknown> {
  const paper = PAPER_INCHES[settings.pageSize];
  const margin = MARGIN_INCHES[settings.margin];
  // Header/footer render inside the vertical margins — keep enough room.
  const marginV = settings.headerFooter ? Math.max(margin.v, 0.6) : margin.v;

  const params: Record<string, unknown> = {
    printBackground: true,
    preferCSSPageSize: false,
    paperWidth: paper.w,
    paperHeight: paper.h,
    marginTop: marginV,
    marginBottom: marginV,
    marginLeft: margin.h,
    marginRight: margin.h,
    displayHeaderFooter: settings.headerFooter,
  };
  if (settings.headerFooter) {
    params["headerTemplate"] =
      `<div style="width:100%; font-size:8px; color:#666; padding:0 0.4in; display:flex; justify-content:space-between;">` +
      `<span>${escapeHtml(settings.title)}</span><span class="date"></span></div>`;
    params["footerTemplate"] =
      `<div style="width:100%; font-size:8px; color:#666; text-align:center;">` +
      `<span class="pageNumber"></span> / <span class="totalPages"></span></div>`;
  }
  return params;
}

// ---------------------------------------------------------------------------
// The print run
// ---------------------------------------------------------------------------

export interface CdpPrintOptions {
  /** Kill the browser and fail after this long. Default 60 s. */
  timeoutMs?: number;
  /** Extra browser flags (the CI smoke passes --no-sandbox for root containers). */
  extraArgs?: string[];
  /** Injectable spawner (unit-test seam). */
  spawnFn?: typeof nodeSpawn;
}

/**
 * Print `htmlPath` to `pdfPath` via CDP with full header/footer and margin
 * control. Throws on any failure — the caller falls back to the CLI printer.
 */
export async function printHtmlToPdfViaCdp(
  executable: string,
  htmlPath: string,
  pdfPath: string,
  settings: PdfPrintSettings,
  opts: CdpPrintOptions = {},
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const spawnFn = opts.spawnFn ?? nodeSpawn;

  // An isolated profile dir keeps the run reproducible and lets several
  // exports run concurrently; removed afterwards.
  const profileDir = await mkdtemp(join(tmpdir(), "penmark-cdp-"));
  const args = [
    "--headless",
    "--disable-gpu",
    // Containers and low-memory Linux hosts mount a tiny /dev/shm; Chromium's
    // renderer starves on multi-page prints and printToPDF fails or hangs.
    // Falling back to /tmp (what Playwright's own launcher does) is reliable
    // everywhere at a negligible speed cost.
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
    `--user-data-dir=${profileDir}`,
    "--remote-debugging-pipe",
    ...(opts.extraArgs ?? []),
    "about:blank",
  ];

  const child = spawnFn(executable, args, {
    // fd 3 = CDP input (we write), fd 4 = CDP output (we read).
    stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"],
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, timeoutMs);

  try {
    const writeStream = child.stdio[3] as Writable | null;
    const readStream = child.stdio[4] as Readable | null;
    if (!writeStream || !readStream) {
      throw new Error("browser did not expose the DevTools pipe (fd 3/4)");
    }
    const spawnError = new Promise<never>((_, reject) => {
      child.on("error", (err) => reject(new Error(`could not start browser: ${err.message}`)));
    });
    const cdp = new CdpConnection(writeStream, readStream);

    const run = (async () => {
      const { targetId } = (await cdp.send("Target.createTarget", { url: "about:blank" })) as {
        targetId: string;
      };
      const { sessionId } = (await cdp.send("Target.attachToTarget", {
        targetId,
        flatten: true,
      })) as { sessionId: string };

      await cdp.send("Page.enable", {}, sessionId);
      const loaded = cdp.waitForEvent(
        (e) => e.method === "Page.loadEventFired" && e.sessionId === sessionId,
      );
      await cdp.send("Page.navigate", { url: pathToFileURL(htmlPath).toString() }, sessionId);
      await loaded;

      const result = await cdp.send("Page.printToPDF", buildPrintToPdfParams(settings), sessionId);
      const data = result["data"];
      if (typeof data !== "string" || data === "") {
        throw new Error("Page.printToPDF returned no data");
      }
      await writeFile(pdfPath, Buffer.from(data, "base64"));
    })();

    await Promise.race([run, spawnError]);

    const pdf = await readFile(pdfPath);
    if (pdf.length === 0 || pdf.subarray(0, 5).toString("latin1") !== "%PDF-") {
      throw new Error("browser output is not a valid PDF");
    }
  } catch (err) {
    if (timedOut) {
      throw new Error(`browser did not finish within ${String(timeoutMs)} ms`, { cause: err });
    }
    throw err;
  } finally {
    clearTimeout(timer);
    // Wait for the browser to actually exit before removing its profile —
    // recursive rm races with shutdown writes (ENOTEMPTY) otherwise. Cleanup
    // is best-effort: a leftover temp profile must never fail a print that
    // already succeeded.
    const exited = new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) resolve();
      else child.once("close", () => resolve());
    });
    child.kill();
    await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
    await rm(profileDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
