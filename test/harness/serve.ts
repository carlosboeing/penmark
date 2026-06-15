// Minimal static file server for the webview test harness.
// Serves: test/harness/ at / and dist/ at /dist/.
// Used by playwright.config.ts webServer.
import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import * as url from "url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
// must match playwright.config.ts webServer
const port = 4173;

const mimeTypes: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".map": "application/json",
};

const server = http.createServer((req, res) => {
  const reqUrl = req.url ?? "/";
  const parsed = new URL(reqUrl, `http://localhost:${port}`);
  let filePath: string;

  if (parsed.pathname === "/" || parsed.pathname === "/index.html") {
    filePath = path.join(root, "test/harness/index.html");
  } else {
    // strip leading slash and resolve relative to project root
    const rel = parsed.pathname.slice(1);
    const resolved = path.resolve(root, rel);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    filePath = resolved;
  }

  const ext = path.extname(filePath);
  const contentType = mimeTypes[ext] ?? "application/octet-stream";

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end(`Not found: ${parsed.pathname}`);
      return;
    }
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
});

server.on("error", (err) => {
  console.error("[harness] server error:", err.message);
  process.exit(1);
});

server.listen(port, () => {
  console.log(`Harness server listening on http://localhost:${port}`);
});
