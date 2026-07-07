/**
 * Unit tests for export image inlining (R17): webview resource URIs decode
 * back to fs paths and embed as data: URIs; everything else passes through,
 * and failures are reported (never silently dropped).
 */
import { describe, it, expect } from "vitest";
import { inlineLocalImages, webviewSrcToFsPath } from "./exportImages.js";

const CDN = "https://file+.vscode-resource.vscode-cdn.net";

describe("webviewSrcToFsPath", () => {
  it("decodes the desktop vscode-cdn form to a posix path", () => {
    expect(webviewSrcToFsPath(`${CDN}/Users/carlos/docs/photo.png`)).toBe(
      "/Users/carlos/docs/photo.png",
    );
  });

  it("decodes percent-encoded segments (spaces, unicode)", () => {
    expect(webviewSrcToFsPath(`${CDN}/Users/carlos/My%20Docs/caf%C3%A9.png`)).toBe(
      "/Users/carlos/My Docs/café.png",
    );
  });

  it("strips the leading slash from Windows drive paths", () => {
    expect(webviewSrcToFsPath(`${CDN}/c%3A/Users/carlos/photo.png`)).toBe(
      "c:/Users/carlos/photo.png",
    );
  });

  it("accepts fork domains that keep the .vscode-resource. authority marker", () => {
    expect(
      webviewSrcToFsPath("https://file+.vscode-resource.cursor-cdn.example/tmp/a.png"),
    ).toBe("/tmp/a.png");
  });

  it("rejects non-file webview schemes and ordinary URLs", () => {
    expect(
      webviewSrcToFsPath("https://vscode-remote+.vscode-resource.vscode-cdn.net/x.png"),
    ).toBeNull();
    expect(webviewSrcToFsPath("https://example.com/photo.png")).toBeNull();
    expect(webviewSrcToFsPath("data:image/png;base64,AAAA")).toBeNull();
    expect(webviewSrcToFsPath("./relative.png")).toBeNull();
  });
});

describe("inlineLocalImages", () => {
  const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  const readOk = async (): Promise<Uint8Array> => PNG_BYTES;

  it("re-encodes webview-resource images as data: URIs", async () => {
    const html = `<p><img src="${CDN}/docs/a.png" alt="A"></p>`;
    const { html: out, failures } = await inlineLocalImages(html, readOk);
    expect(out).toContain(`src="data:image/png;base64,${Buffer.from(PNG_BYTES).toString("base64")}"`);
    expect(out).toContain('alt="A"');
    expect(failures).toEqual([]);
  });

  it("leaves http(s) and data: images untouched", async () => {
    const html =
      `<img src="https://example.com/remote.png">` + `<img src="data:image/gif;base64,R0lGOD">`;
    const { html: out, failures } = await inlineLocalImages(html, readOk);
    expect(out).toBe(html);
    expect(failures).toEqual([]);
  });

  it("reports unreadable files and keeps their original src", async () => {
    const html = `<img src="${CDN}/docs/missing.png">`;
    const { html: out, failures } = await inlineLocalImages(html, async () => {
      throw new Error("ENOENT");
    });
    expect(out).toBe(html);
    expect(failures).toEqual(["/docs/missing.png"]);
  });

  it("reports unknown media types instead of embedding garbage", async () => {
    const html = `<img src="${CDN}/docs/render.tiff">`;
    const { failures } = await inlineLocalImages(html, readOk);
    expect(failures).toEqual(["/docs/render.tiff"]);
  });

  it("handles multiple images, including repeated identical tags", async () => {
    const html =
      `<img src="${CDN}/a.png">` + `<img src="${CDN}/a.png">` + `<img src="${CDN}/b.svg">`;
    const { html: out, failures } = await inlineLocalImages(html, readOk);
    expect(out.match(/data:image\/png;base64/g)).toHaveLength(2);
    expect(out.match(/data:image\/svg\+xml;base64/g)).toHaveLength(1);
    expect(out).not.toContain("vscode-resource");
    expect(failures).toEqual([]);
  });

  it("does not interpret replacement patterns in alt text", async () => {
    const html = `<img src="${CDN}/a.png" alt="costs $& more">`;
    const { html: out } = await inlineLocalImages(html, readOk);
    expect(out).toContain('alt="costs $& more"');
  });
});
