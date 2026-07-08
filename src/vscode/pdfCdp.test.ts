/**
 * Unit tests for the CDP pipe printer (R17): NUL-delimited framing, command
 * correlation, event waiting, error surfaces, and the printToPDF params
 * (header/footer templates, margins, paper sizes). The real end-to-end print
 * runs in test/browser/export.spec.ts with Playwright's Chromium.
 */
import { PassThrough } from "node:stream";
import { describe, it, expect } from "vitest";
import { buildPrintToPdfParams, CdpConnection } from "./pdfCdp.js";

function makePipe(): {
  cdp: CdpConnection;
  fromBrowser: PassThrough;
  readSent: () => Record<string, unknown>;
} {
  const toBrowser = new PassThrough();
  const fromBrowser = new PassThrough();
  // Consecutive sends can flush into one readable chunk — split on NUL and
  // hand messages out one at a time.
  const queue: string[] = [];
  const readSent = (): Record<string, unknown> => {
    if (queue.length === 0) {
      const raw = (toBrowser.read() as Buffer).toString("utf8");
      expect(raw.endsWith("\0")).toBe(true);
      queue.push(...raw.split("\0").filter((m) => m !== ""));
    }
    return JSON.parse(queue.shift()!) as Record<string, unknown>;
  };
  return { cdp: new CdpConnection(toBrowser, fromBrowser), fromBrowser, readSent };
}

describe("CdpConnection", () => {
  it("correlates responses to commands by id and resolves results", async () => {
    const { cdp, fromBrowser, readSent } = makePipe();
    const pending = cdp.send("Target.createTarget", { url: "about:blank" });

    const sent = readSent();
    expect(sent["method"]).toBe("Target.createTarget");
    fromBrowser.write(`{"id":${String(sent["id"])},"result":{"targetId":"t1"}}\0`);

    await expect(pending).resolves.toEqual({ targetId: "t1" });
  });

  it("handles messages split across chunks and multiple messages per chunk", async () => {
    const { cdp, fromBrowser, readSent } = makePipe();
    const first = cdp.send("A");
    const second = cdp.send("B");
    const idA = readSent()["id"];
    const idB = readSent()["id"];

    // First response split mid-JSON; second glued into the same chunk.
    const rest = `":{"a":1}}\0{"id":${String(idB)},"result":{"b":2}}\0`;
    fromBrowser.write(`{"id":${String(idA)},"result`);
    fromBrowser.write(rest);

    await expect(first).resolves.toEqual({ a: 1 });
    await expect(second).resolves.toEqual({ b: 2 });
  });

  it("rejects a command the browser answers with an error", async () => {
    const { cdp, fromBrowser, readSent } = makePipe();
    const pending = cdp.send("Page.printToPDF");
    const id = readSent()["id"];
    fromBrowser.write(`{"id":${String(id)},"error":{"message":"printing failed"}}\0`);
    await expect(pending).rejects.toThrow("printing failed");
  });

  it("delivers events to matching waiters (sessionId respected)", async () => {
    const { cdp, fromBrowser } = makePipe();
    const waiter = cdp.waitForEvent(
      (e) => e.method === "Page.loadEventFired" && e.sessionId === "s1",
    );
    // A non-matching event first, then the one we wait for.
    fromBrowser.write(`{"method":"Page.loadEventFired","sessionId":"other"}\0`);
    fromBrowser.write(`{"method":"Page.loadEventFired","sessionId":"s1"}\0`);
    await expect(waiter).resolves.toMatchObject({ sessionId: "s1" });
  });

  it("fails pending commands when the browser closes the pipe", async () => {
    const { cdp, fromBrowser, readSent } = makePipe();
    const pending = cdp.send("Page.printToPDF");
    readSent();
    fromBrowser.destroy();
    await expect(pending).rejects.toThrow(/pipe/);
  });
});

describe("buildPrintToPdfParams", () => {
  const BASE = { pageSize: "a4", margin: "normal", headerFooter: true, title: "doc.md" } as const;

  it("maps paper sizes and margin presets to inches", () => {
    const a4 = buildPrintToPdfParams(BASE);
    expect(a4["paperWidth"]).toBeCloseTo(8.27);
    expect(a4["paperHeight"]).toBeCloseTo(11.69);
    const letter = buildPrintToPdfParams({ ...BASE, pageSize: "letter" });
    expect(letter["paperWidth"]).toBeCloseTo(8.5);
    const narrow = buildPrintToPdfParams({ ...BASE, margin: "narrow", headerFooter: false });
    expect(narrow["marginLeft"]).toBeCloseTo(0.47);
    expect(narrow["marginTop"]).toBeCloseTo(0.47);
  });

  it("prints backgrounds and controls geometry itself (no CSS page size)", () => {
    const params = buildPrintToPdfParams(BASE);
    expect(params["printBackground"]).toBe(true);
    expect(params["preferCSSPageSize"]).toBe(false);
  });

  it("emits title header and page-number footer only when enabled, escaped", () => {
    const on = buildPrintToPdfParams({ ...BASE, title: `<em>"doc"</em>.md` });
    expect(on["displayHeaderFooter"]).toBe(true);
    expect(on["headerTemplate"]).toContain("&lt;em&gt;&quot;doc&quot;&lt;/em&gt;.md");
    expect(on["footerTemplate"]).toContain('class="pageNumber"');
    expect(on["footerTemplate"]).toContain('class="totalPages"');
    // Header/footer need vertical room — margins are raised to fit.
    expect(on["marginTop"] as number).toBeGreaterThanOrEqual(0.6);

    const off = buildPrintToPdfParams({ ...BASE, headerFooter: false });
    expect(off["displayHeaderFooter"]).toBe(false);
    expect(off["headerTemplate"]).toBeUndefined();
    expect(off["marginTop"]).toBeCloseTo(0.71);
  });
});
