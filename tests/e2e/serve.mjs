#!/usr/bin/env node
/**
 * Tiny static server for the production web build (dist/), used by Playwright's `webServer`.
 *  - SPA fallback: any GET that is not a file (and not asking for an asset) returns index.html
 *  - correct MIME types (a service worker is only registered for a JavaScript MIME type)
 *  - sw.js and index.html are never HTTP-cached so a rebuilt worker is picked up immediately
 * Usage: node tests/e2e/serve.mjs [distDir] [port]
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST = resolve(process.argv[2] ?? join(ROOT, 'dist'));
const PORT = Number(process.argv[3] ?? process.env.E2E_PORT ?? 4173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

if (!existsSync(join(DIST, 'index.html'))) {
  console.error(`serve: ${join(DIST, 'index.html')} not found. Run "npm run build:web" first.`);
  process.exit(1);
}

/** Maps a request path to a file inside DIST, or undefined (never escapes DIST). */
function resolveFile(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  const candidate = normalize(join(DIST, decoded));
  if (candidate !== DIST && !candidate.startsWith(DIST + sep)) return undefined;
  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  return undefined;
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  let file = resolveFile(url.pathname);
  if (!file) {
    // A missing asset (anything with an extension) is a real 404; app routes fall back to the SPA shell.
    if (extname(url.pathname)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    file = join(DIST, 'index.html');
  }
  const ext = extname(file).toLowerCase();
  const name = file.slice(DIST.length + 1).split(sep).join('/');
  const headers = { 'Content-Type': MIME[ext] ?? 'application/octet-stream', 'Content-Length': statSync(file).size };
  headers['Cache-Control'] = name === 'sw.js' || name === 'index.html' ? 'no-cache' : 'public, max-age=3600';
  res.writeHead(200, headers);
  if (req.method === 'HEAD') res.end();
  else createReadStream(file).pipe(res);
});

server.listen(PORT, '127.0.0.1', () => console.log(`serve: ${DIST} on http://127.0.0.1:${PORT}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
