#!/usr/bin/env node
/**
 * Tiny static server for the production web build (dist/), used by Playwright's `webServer`.
 *  - SPA fallback: any GET that is not a file (and not asking for an asset) returns index.html
 *  - correct MIME types (a service worker is only registered for a JavaScript MIME type)
 *  - sw.js and index.html are never HTTP-cached so a rebuilt worker is picked up immediately
 *  - the security headers of the real Firebase Hosting config (firebase.json), so the Content Security Policy that
 *    production sends is the one the tests run under. Only `upgrade-insecure-requests` and HSTS are left out,
 *    because they need https. Set E2E_NO_HEADERS=1 to turn this off.
 * Usage: node tests/e2e/serve.mjs [distDir] [port]   (distDir defaults to $E2E_DIST, then dist/)
 */
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_DIST = resolve(process.argv[2] ?? process.env.E2E_DIST ?? join(ROOT, 'dist'));
const DEFAULT_PORT = Number(process.argv[3] ?? process.env.E2E_PORT ?? 4173);

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

/** The Firebase Hosting headers that apply to a request path (the global `**` block, plus exact-path blocks). */
export function hostingHeaders(pathname, config = JSON.parse(readFileSync(join(ROOT, 'firebase.json'), 'utf8'))) {
  const out = {};
  for (const block of config.hosting?.headers ?? []) {
    const src = block.source;
    const hit = src === '**' || src === pathname || (src.endsWith('/**') && pathname.startsWith(src.slice(0, -2)));
    if (!hit) continue;
    for (const { key, value } of block.headers) {
      if (key === 'Strict-Transport-Security') continue; // http only here
      out[key] = key === 'Content-Security-Policy' ? value.replace(/;?\s*upgrade-insecure-requests/, '') : value;
    }
  }
  return out;
}

/** Maps a request path to a file inside `dist`, or undefined (never escapes `dist`). */
function resolveFile(DIST, pathname) {
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

/** Starts the server. `port: 0` picks a free one. Resolves to { server, url, close }. */
export function startServer({ dist = DEFAULT_DIST, port = DEFAULT_PORT, firebaseHeaders = !process.env.E2E_NO_HEADERS } = {}) {
  const DIST = resolve(dist);
  if (!existsSync(join(DIST, 'index.html'))) throw new Error(`serve: ${join(DIST, 'index.html')} not found. Run "npm run build:web:e2e" first.`);
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    let file = resolveFile(DIST, url.pathname);
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
    if (firebaseHeaders) Object.assign(headers, hostingHeaders(url.pathname === '/' || !extname(url.pathname) ? '/index.html' : url.pathname), { 'Cache-Control': headers['Cache-Control'] });
    res.writeHead(200, headers);
    if (req.method === 'HEAD') res.end();
    else createReadStream(file).pipe(res);
  });
  return new Promise((resolveStart) => {
    server.listen(port, '127.0.0.1', () => {
      const url = `http://127.0.0.1:${server.address().port}`;
      resolveStart({ server, url, dist: DIST, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }) });
    });
  });
}

// Run as a script (Playwright's webServer, CI): serve until stopped.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { server, url, dist } = await startServer();
    console.log(`serve: ${dist} on ${url}`);
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
  } catch (e) {
    console.error(String(e instanceof Error ? e.message : e));
    process.exit(1);
  }
}
