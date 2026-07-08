/**
 * Local-image inlining for export (R17, ADR 0007).
 *
 * The captured preview DOM references local images through webview resource
 * URIs (`https://file+.vscode-resource.vscode-cdn.net/<path>`), which resolve
 * ONLY inside a webview. A self-contained export re-encodes each one as a
 * `data:` URI; http(s) and data URIs pass through unchanged.
 *
 * Node-only, no vscode imports — the file reader is injected so unit tests run
 * under plain vitest and the command layer can pass `vscode.workspace.fs`.
 */

import { Buffer } from "node:buffer";

/** Media types by extension for the `data:` URI. Unknown types are left alone. */
const IMAGE_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
};

/**
 * Decode a webview resource URI back to the filesystem path it was minted
 * from, or null when `src` is not a webview resource URI.
 *
 * Desktop VS Code ≥1.64 (compat floor is 1.105) serves workspace files at
 * `https://{scheme}+.vscode-resource.vscode-cdn.net/<encoded fs path>`; forks
 * may remap the domain via product.json but keep the `.vscode-resource.`
 * authority marker, so match on that (or the bare vscode-cdn.net host).
 * Only `file` scheme resources map to a local path.
 */
export function webviewSrcToFsPath(src: string): string | null {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname;
  const isWebviewResource = host.includes(".vscode-resource.") || host.endsWith(".vscode-cdn.net");
  if (!isWebviewResource) return null;
  // Non-file schemes (e.g. vscode-remote) have no local path to read.
  if (host.includes("+") && !host.startsWith("file+")) return null;

  let fsPath = decodeURIComponent(url.pathname);
  // Windows: the URI pathname is /c:/Users/... — drop the leading slash.
  if (/^\/[a-zA-Z]:[/\\]/.test(fsPath)) {
    fsPath = fsPath.slice(1);
  }
  return fsPath;
}

/** Extension (lowercased, with dot) of a path, tolerant of query suffixes. */
function extOf(fsPath: string): string {
  const clean = fsPath.split(/[?#]/)[0] ?? fsPath;
  const dot = clean.lastIndexOf(".");
  return dot >= 0 ? clean.slice(dot).toLowerCase() : "";
}

export interface InlineImagesResult {
  html: string;
  /** Fs paths that could not be embedded (unreadable or unknown type). */
  failures: string[];
}

/**
 * Rewrite every `<img src="...">` that points at a webview resource URI into a
 * self-contained `data:` URI. Images that cannot be embedded (missing file,
 * unknown media type) keep their original src and are reported in `failures`
 * so the caller can surface them — never a silent drop.
 *
 * @param html      Captured export HTML.
 * @param readFile  Reads a local file (the command layer passes workspace.fs).
 */
export async function inlineLocalImages(
  html: string,
  readFile: (fsPath: string) => Promise<Uint8Array>,
): Promise<InlineImagesResult> {
  const failures: string[] = [];
  const imgTags = [...html.matchAll(/<img\b[^>]*>/gi)];

  let out = html;
  for (const match of imgTags) {
    const tag = match[0];
    const srcMatch = /\bsrc\s*=\s*"([^"]*)"/i.exec(tag) ?? /\bsrc\s*=\s*'([^']*)'/i.exec(tag);
    const src = srcMatch?.[1];
    if (!src) continue;

    const fsPath = webviewSrcToFsPath(src);
    if (fsPath === null) continue; // http(s), data:, or relative — pass through

    const mime = IMAGE_MIME[extOf(fsPath)];
    if (!mime) {
      failures.push(fsPath);
      continue;
    }

    let data: Uint8Array;
    try {
      data = await readFile(fsPath);
    } catch {
      failures.push(fsPath);
      continue;
    }

    const dataUri = `data:${mime};base64,${Buffer.from(data).toString("base64")}`;
    // Function replacements: a literal `$&`/`$'` in alt text must not be
    // interpreted as a replacement pattern.
    const newTag = tag.replace(srcMatch![0], () => `src="${dataUri}"`);
    out = out.replace(tag, () => newTag);
  }

  return { html: out, failures };
}
