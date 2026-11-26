#!/usr/bin/env node
/**
 * Turns the `npx expo export --platform web` output (dist/, web.output 'single') into an offline PWA:
 *   - dist/manifest.webmanifest (+ content-hashed icons: 192, 512, maskable 512, apple-touch) and <link rel="manifest"> in index.html
 *   - dist/sw.js: precaches every built file; cache name derives from the build's content hash.
 * Usage: node scripts/build-pwa.mjs [distDir]
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(process.argv[2] ?? join(ROOT, 'dist'));
/**
 * Web app icons, rendered from the Kalam mark by assets/images/src/render.mjs. "any" icons are drawn as they are;
 * the maskable one is full bleed with the mark inside the safe circle, so a circular or squircle mask never clips it.
 */
const ICON_DIR = join(ROOT, 'assets', 'images');
const ICONS = [
  { file: 'pwa-192.png', purpose: 'any' },
  { file: 'pwa-512.png', purpose: 'any' },
  { file: 'pwa-maskable-512.png', purpose: 'maskable' },
];
/** iOS Safari ignores manifest icons for "Add to Home Screen" and wants this one (180 px, opaque, full bleed). */
const TOUCH_ICON = 'apple-touch-icon.png';
/** Paper canvas (iconColors.paper in src/design/tokens.ts): the install splash and the title bar match the app splash. brand-assets.test.ts checks it. */
const THEME = '#F4F5F0';
const BACKGROUND = '#F4F5F0';
/** Not needed at runtime (source maps, Expo export metadata) or must never be precached (the worker). */
const SKIP = /(^|\/)(sw\.js|metadata\.json|.*\.map)$/;

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function copyIcon(file) {
  const png = readFileSync(join(ICON_DIR, file));
  // PNG IHDR: width/height are big-endian u32 at bytes 16 and 20.
  const sizes = `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`;
  const name = `icons/${file.replace(/\.png$/, '')}.${sha256(png).slice(0, 12)}.png`; // hashed name → immutable, reused across builds
  mkdirSync(join(DIST, 'icons'), { recursive: true });
  writeFileSync(join(DIST, name), png);
  return { src: `/${name}`, sizes };
}

function writeIcons() {
  return {
    icons: ICONS.map(({ file, purpose }) => ({ ...copyIcon(file), type: 'image/png', purpose })),
    touchIcon: copyIcon(TOUCH_ICON).src,
  };
}

/**
 * Install-menu shortcuts (docs/14 §18.3), shown on a long press or right click of the installed icon. These two
 * are fixed and point at routes in src/app. The apps a person pinned on the shelf are added at run time by the
 * service worker, only after they switch that on in widget settings (src/features/widgets).
 */
export const SHORTCUTS = [
  { name: 'New app', short_name: 'New app', description: 'Describe or draw a new app', url: '/create' },
  { name: 'Draw an app', short_name: 'Draw', description: 'Open the Drawing Studio', url: '/create/draw' },
];

/** The fixed shortcuts for the manifest, each with the 192 px icon when there is one. */
export function manifestShortcuts(icons = []) {
  const icon = icons.find((i) => i.sizes === '192x192' && i.purpose === 'any');
  return SHORTCUTS.map((s) => ({ ...s, ...(icon ? { icons: [{ src: icon.src, sizes: icon.sizes, type: icon.type }] } : {}) }));
}

/**
 * Turns the list the page keeps for the worker into manifest shortcuts. The page is trusted no further than
 * this: only same-origin /app/<id> paths, short names, at most `max`. The worker source contains this very
 * function (Function.prototype.toString), so what the tests check is what runs. Self-contained on purpose.
 */
export function pinnedShortcutEntries(list, max) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const item of list) {
    if (out.length >= max) break;
    if (!item || typeof item.name !== 'string' || typeof item.url !== 'string') continue;
    const name = item.name.trim().slice(0, 30);
    if (!name || !/^\/app\/[a-z][a-z0-9_-]{2,63}$/.test(item.url)) continue;
    out.push({ name, short_name: name, url: item.url });
  }
  return out;
}

function writeManifest(icons) {
  const manifest = {
    name: 'Kalam',
    short_name: 'Kalam',
    description: 'Draw the app you need. Own it forever.',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    theme_color: THEME,
    background_color: BACKGROUND,
    icons,
    shortcuts: manifestShortcuts(icons),
  };
  writeFileSync(join(DIST, 'manifest.webmanifest'), `${JSON.stringify(manifest, null, 2)}\n`);
}

function linkManifest(touchIcon) {
  const file = join(DIST, 'index.html');
  let html = readFileSync(file, 'utf8');
  const tags = [];
  if (!/rel=["']manifest["']/.test(html)) tags.push('<link rel="manifest" href="/manifest.webmanifest" />');
  if (!/rel=["']apple-touch-icon["']/.test(html)) tags.push(`<link rel="apple-touch-icon" href="${touchIcon}" />`);
  if (!/name=["']theme-color["']/.test(html)) tags.push(`<meta name="theme-color" content="${THEME}" />`);
  if (tags.length) {
    html = html.replace(/<\/head>/i, `  ${tags.join('\n  ')}\n</head>`);
    writeFileSync(file, html);
  }
}

function serviceWorker(cacheName, precache) {
  return `/* Kalam service worker — generated by scripts/build-pwa.mjs. Do not edit. */
const CACHE = ${JSON.stringify(cacheName)};
const PRECACHE = ${JSON.stringify(precache)};
// Content-hashed file names never change content, so they can be reused from an older cache.
// Matches entry-<hash>.js, name.<hash>.ttf and scale variants like name.<hash>@2x.png.
const HASHED = /[.-][0-9a-f]{8,}(@\\d+(\\.\\d+)?x)?\\.[a-z0-9]+$/i;
const NAV_TIMEOUT_MS = 4000;
// Pinned-app shortcuts (docs/14 §18.3): the page writes them to this cache when the person opts in. The name must not
// start with "kalam-", or activate() below would delete it.
const PINNED_CACHE = 'pinned-shortcuts';
const PINNED_URL = '/__kalam/pinned.json';
const MAX_PINNED = 4;
const pinnedShortcutEntries = ${pinnedShortcutEntries.toString()};

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(PRECACHE.map(async (url) => {
      const reused = HASHED.test(url) ? await caches.match(url) : undefined;
      if (reused) return cache.put(url, reused);
      const response = await fetch(url, { cache: 'reload' });
      if (!response.ok) throw new Error('Precache failed: ' + url + ' ' + response.status);
      return cache.put(url, response);
    }));
  })());
  // No skipWaiting here: the page decides when to activate an update (never mid-edit).
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('kalam-') && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Never touch cross-origin traffic (Firebase, Google APIs, AI providers) or Firebase Hosting's /__/ paths.
  if (url.origin !== self.location.origin || url.pathname.startsWith('/__/')) return;
  if (url.pathname === '/manifest.webmanifest') return event.respondWith(manifestWithPinned(request));
  event.respondWith(request.mode === 'navigate' ? networkFirst(request) : cacheFirst(request));
});

/** SPA navigation: fresh HTML when online, the precached shell when offline or slow. */
async function networkFirst(request) {
  let response;
  try {
    response = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NAV_TIMEOUT_MS)),
    ]);
    if (response.ok) return response;
  } catch (_) {}
  return (await caches.match('/index.html', { cacheName: CACHE })) || response || Response.error();
}

async function cacheFirst(request) {
  const cached = await caches.match(request, { cacheName: CACHE });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.status === 200 && HASHED.test(new URL(request.url).pathname)) {
    const copy = response.clone();
    caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
  }
  return response;
}

/** The built manifest, plus the person's pinned apps as shortcuts. Any trouble reading them leaves the manifest as built. */
async function manifestWithPinned(request) {
  const base = (await caches.match(request, { cacheName: CACHE })) || (await fetch(request));
  try {
    const stored = await (await caches.open(PINNED_CACHE)).match(PINNED_URL);
    if (!stored) return base;
    const extra = pinnedShortcutEntries(await stored.json(), MAX_PINNED);
    if (!extra.length) return base;
    const manifest = await base.clone().json();
    manifest.shortcuts = (manifest.shortcuts || []).concat(extra);
    return new Response(JSON.stringify(manifest), { headers: { 'Content-Type': 'application/manifest+json' } });
  } catch (_) {
    return base;
  }
}
`;
}

function main() {
  if (!existsSync(join(DIST, 'index.html'))) {
    console.error(`build-pwa: ${join(DIST, 'index.html')} not found. Run "npx expo export --platform web" first.`);
    process.exit(1);
  }
  const { icons, touchIcon } = writeIcons();
  writeManifest(icons);
  linkManifest(touchIcon);

  const files = walk(DIST)
    .map((path) => ({ path, url: `/${relative(DIST, path).split(sep).join('/')}` }))
    .filter((f) => !SKIP.test(f.url))
    .sort((a, b) => a.url.localeCompare(b.url));
  const buildHash = createHash('sha256');
  let bytes = 0;
  for (const f of files) {
    const data = readFileSync(f.path);
    bytes += data.length;
    buildHash.update(`${f.url}\0${sha256(data)}\0`);
  }
  const cacheName = `kalam-${buildHash.digest('hex').slice(0, 12)}`;
  const precache = files.map((f) => encodeURI(f.url));
  writeFileSync(join(DIST, 'sw.js'), serviceWorker(cacheName, precache));
  console.log(`build-pwa: ${precache.length} files (${(bytes / 1024 / 1024).toFixed(2)} MB) precached as ${cacheName}`);
}

/**
 * True when this file is the script being run, not a module a test imports. Compares real paths: Node does not resolve a
 * symlink in argv[1] but does in import.meta.url, so a repo reached through a link (macOS /tmp, some CI mounts) would
 * otherwise build nothing and still exit 0.
 */
export function isDirectRun(argv1, metaUrl) {
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(metaUrl));
  } catch {
    return false;
  }
}

if (isDirectRun(process.argv[1], import.meta.url)) main();
