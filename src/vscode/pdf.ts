/**
 * PDF printing via a system-installed Chromium-based browser (R17, ADR 0007).
 *
 * Penmark ships no print engine — bundling one (puppeteer/playwright) would
 * multiply the VSIX size far past the 1 MiB core budget. Instead the exported
 * HTML (which contains no JavaScript, so printing is deterministic) is handed
 * to a local Chrome/Edge/Chromium/Brave in headless mode:
 *
 *   <browser> --headless --print-to-pdf=<out.pdf> --no-pdf-header-footer <file-url>
 *
 * Discovery checks well-known install paths per OS; `penmark.export.chromiumPath`
 * overrides it. When nothing is found the command layer degrades gracefully
 * (offer HTML export instead) — PDF is additive, never a hard dependency.
 *
 * Node-only, no vscode imports: unit tests inject `exists`/`spawn` seams, and
 * the browser-test suite drives the REAL spawn path with Playwright's Chromium.
 */

import { spawn as nodeSpawn } from "node:child_process";
import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

/** Well-known Chromium-family executable locations for `platform`. */
export function candidateBrowsers(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined> = process.env,
): string[] {
  switch (platform) {
    case "darwin":
      return [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      ];
    case "win32": {
      const roots = [env["ProgramFiles"], env["ProgramFiles(x86)"], env["LOCALAPPDATA"]].filter(
        (r): r is string => typeof r === "string" && r.length > 0,
      );
      const out: string[] = [];
      for (const root of roots) {
        out.push(`${root}\\Google\\Chrome\\Application\\chrome.exe`);
      }
      for (const root of roots) {
        out.push(`${root}\\Microsoft\\Edge\\Application\\msedge.exe`);
      }
      return out;
    }
    default:
      return [
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/snap/bin/chromium",
        "/usr/bin/microsoft-edge",
        "/usr/bin/brave-browser",
      ];
  }
}

/**
 * Resolve the browser executable to print with. An explicit path (the
 * `penmark.export.chromiumPath` setting) wins and is only validated for
 * existence; otherwise the first existing well-known candidate is used.
 * Returns null when nothing usable is found.
 */
export async function findChromium(
  explicitPath?: string,
  platform: NodeJS.Platform = process.platform,
  exists: (p: string) => Promise<boolean> = async (p) => {
    try {
      await access(p, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  },
): Promise<string | null> {
  if (explicitPath && explicitPath.trim() !== "") {
    return (await exists(explicitPath)) ? explicitPath : null;
  }
  for (const candidate of candidateBrowsers(platform)) {
    if (await exists(candidate)) return candidate;
  }
  return null;
}

/** Headless print arguments. The file URL must be the LAST argument. */
export function buildPrintArgs(
  htmlPath: string,
  pdfPath: string,
  extraArgs: string[] = [],
): string[] {
  return [
    "--headless",
    "--disable-gpu",
    "--no-pdf-header-footer",
    `--print-to-pdf=${pdfPath}`,
    ...extraArgs,
    pathToFileURL(htmlPath).toString(),
  ];
}

export interface PrintOptions {
  /** Kill the browser and fail after this long. Default 60 s. */
  timeoutMs?: number;
  /** Extra browser flags (the CI smoke passes --no-sandbox for root containers). */
  extraArgs?: string[];
  /** Injectable spawner (unit-test seam). */
  spawnFn?: typeof nodeSpawn;
}

/**
 * Print `htmlPath` to `pdfPath` with the given browser executable. Throws with
 * the browser's stderr tail on a non-zero exit, on timeout, and when the
 * output is missing or not a PDF (`%PDF-` magic check) — a zero-byte or HTML
 * error page must never be reported as a successful export.
 */
export async function printHtmlToPdf(
  executable: string,
  htmlPath: string,
  pdfPath: string,
  opts: PrintOptions = {},
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const spawnFn = opts.spawnFn ?? nodeSpawn;
  const args = buildPrintArgs(htmlPath, pdfPath, opts.extraArgs ?? []);

  await new Promise<void>((resolve, reject) => {
    const child = spawnFn(executable, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`browser did not finish within ${String(timeoutMs)} ms`));
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`could not start browser: ${err.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        const tail = stderr.trim().split("\n").slice(-3).join("\n");
        reject(new Error(`browser exited with code ${String(code)}${tail ? `: ${tail}` : ""}`));
      }
    });
  });

  let pdf: Buffer;
  try {
    pdf = await readFile(pdfPath);
  } catch {
    throw new Error("browser reported success but produced no PDF file");
  }
  if (pdf.length === 0 || pdf.subarray(0, 5).toString("latin1") !== "%PDF-") {
    throw new Error("browser output is not a valid PDF");
  }
}
