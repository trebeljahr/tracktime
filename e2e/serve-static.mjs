#!/usr/bin/env node
// Serves the client's static export (packages/client/out) for the E2E suite.
//
// The suite deliberately runs against the exported bundle rather than
// `next dev`: Next 16's dev server detaches itself, which fights Playwright's
// process management and left the client port dead partway through a run. The
// export is also what actually ships, so this exercises the real artifact —
// including the asset paths, which is where a whole class of bugs lives.

import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";

const ROOT = resolve(process.cwd(), "packages/client/out");
const PORT = Number(process.env.PORT ?? process.env.E2E_CLIENT_PORT ?? 49762);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

if (!existsSync(ROOT)) {
  console.error(`[e2e] No static export at ${ROOT}. Run the client build first.`);
  process.exit(1);
}

/** Resolve a URL path to a file inside ROOT, or null if it escapes or is absent. */
function resolveFile(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  // normalize() collapses "..", and the prefix check keeps the served tree
  // inside ROOT even if a request tries to climb out of it.
  const candidate = resolve(join(ROOT, normalize(decoded)));
  if (candidate !== ROOT && !candidate.startsWith(ROOT + "/")) return null;

  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;

  // trailingSlash: true means routes are directories holding index.html.
  const asIndex = join(candidate, "index.html");
  if (existsSync(asIndex)) return asIndex;

  const asHtml = `${candidate}.html`;
  if (existsSync(asHtml)) return asHtml;

  return null;
}

const server = createServer((req, res) => {
  const file = resolveFile(req.url ?? "/");

  if (!file) {
    const notFound = join(ROOT, "404.html");
    if (existsSync(notFound)) {
      res.writeHead(404, { "content-type": MIME[".html"] });
      createReadStream(notFound).pipe(res);
      return;
    }
    res.writeHead(404, { "content-type": MIME[".txt"] });
    res.end("Not found");
    return;
  }

  res.writeHead(200, {
    "content-type": MIME[extname(file)] ?? "application/octet-stream",
    "cache-control": "no-store",
  });
  createReadStream(file).pipe(res);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[e2e] Serving ${ROOT} on http://127.0.0.1:${PORT}`);
});
