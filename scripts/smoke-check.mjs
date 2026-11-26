#!/usr/bin/env node
/**
 * Smoke check for a deployed Kalam web app (docs/04 §22.1, checklist D04-062). Run it after every Hosting deploy.
 *
 *   node scripts/smoke-check.mjs https://<site>.web.app [--functions <firebase project id>]
 *
 * It only reads: five GET requests and, with --functions, one callable request that sends no credentials. It checks
 * that the shell, the manifest and the service worker are served the way the PWA needs, that the security headers
 * in firebase.json really reach the browser (the Content Security Policy above all), that a deep link falls back to
 * the app, and that the cloud functions refuse a caller with no App Check token. Exit code 0 when everything
 * passed, 1 when something failed, 2 when it could not be run.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The headers firebase.json sends on every path, as a lower-cased map. HSTS is included (https only). */
export function expectedGlobalHeaders(config = JSON.parse(readFileSync(join(ROOT, 'firebase.json'), 'utf8'))) {
  const block = (config.hosting?.headers ?? []).find((h) => h.source === '**');
  return Object.fromEntries((block?.headers ?? []).map((h) => [h.key.toLowerCase(), h.value]));
}

/** Compares response headers with the expected map. Returns the list of problems (empty when all match). */
export function headerProblems(actual, expected) {
  const problems = [];
  for (const [key, value] of Object.entries(expected)) {
    const got = actual.get(key);
    if (got === null || got === undefined) problems.push(`missing header ${key}`);
    else if (got.trim() !== value.trim()) problems.push(`header ${key} differs from firebase.json`);
  }
  return problems;
}

/** The first script the shell loads, as a path ("/_expo/static/js/web/entry-<hash>.js"). */
export function firstBundlePath(html) {
  return /<script[^>]+src="([^"]+\.js)"/.exec(html)?.[1];
}

/**
 * Runs every check against `base`. `fetchImpl` is injectable for tests. Resolves to [{ name, ok, detail }].
 * @param {string} base
 * @param {{ project?: string, fetchImpl?: typeof fetch, expected?: Record<string, string> }} [options]
 * @returns {Promise<Array<{ name: string, ok: boolean, detail?: string }>>}
 */
export async function runSmoke(base, { project, fetchImpl = fetch, expected = expectedGlobalHeaders() } = {}) {
  const root = base.replace(/\/+$/, '');
  const results = [];
  const record = (name, ok, detail = '') => results.push({ name, ok, detail });
  const get = (path, init) => fetchImpl(`${root}${path}`, { redirect: 'manual', ...init });

  let html = '';
  try {
    const res = await get('/');
    html = await res.text();
    record('home page is served', res.status === 200 && /text\/html/.test(res.headers.get('content-type') ?? ''), `status ${res.status}`);
    record('home page is never cached', /no-cache|no-store|max-age=0/.test(res.headers.get('cache-control') ?? ''), res.headers.get('cache-control') ?? 'no Cache-Control');
    record('home page loads the app', /id="root"|<script/.test(html) && html.length > 200);
    const problems = headerProblems(res.headers, expected);
    record('security headers match firebase.json (CSP, framing, referrer, permissions)', problems.length === 0, problems.join('; '));
  } catch (e) {
    record('home page is served', false, e instanceof Error ? e.message : String(e));
    return results;
  }

  try {
    const res = await get('/manifest.webmanifest');
    const manifest = res.status === 200 ? await res.json().catch(() => undefined) : undefined;
    record('web app manifest is valid', !!manifest && manifest.name === 'Kalam' && Array.isArray(manifest.icons) && manifest.icons.length >= 2, `status ${res.status}`);
  } catch (e) {
    record('web app manifest is valid', false, e instanceof Error ? e.message : String(e));
  }

  try {
    const res = await get('/sw.js');
    const body = res.status === 200 ? await res.text() : '';
    record('service worker is served as JavaScript and never cached', res.status === 200 && /javascript/.test(res.headers.get('content-type') ?? '') && /no-cache|no-store|max-age=0/.test(res.headers.get('cache-control') ?? ''), `status ${res.status}`);
    record('service worker precaches the app', /kalam-[0-9a-f]+/.test(body) && body.includes('/index.html'));
  } catch (e) {
    record('service worker is served as JavaScript and never cached', false, e instanceof Error ? e.message : String(e));
  }

  const bundle = firstBundlePath(html);
  if (bundle) {
    try {
      const res = await get(bundle);
      record('app bundle is served and cached for a year', res.status === 200 && /immutable/.test(res.headers.get('cache-control') ?? ''), `${bundle} status ${res.status}`);
    } catch (e) {
      record('app bundle is served and cached for a year', false, e instanceof Error ? e.message : String(e));
    }
  } else {
    record('app bundle is served and cached for a year', false, 'no script tag in the home page');
  }

  try {
    const res = await get('/app/some-saved-app');
    record('a deep link opens the app shell', res.status === 200 && /text\/html/.test(res.headers.get('content-type') ?? ''), `status ${res.status}`);
  } catch (e) {
    record('a deep link opens the app shell', false, e instanceof Error ? e.message : String(e));
  }

  if (project) {
    try {
      // No Authorization and no App Check header. A callable that enforces App Check must answer with an error, never data.
      const res = await fetchImpl(`https://us-central1-${project}.cloudfunctions.net/kalamBazaarWallet`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: {} }),
      });
      const body = await res.json().catch(() => ({}));
      record('cloud functions refuse a caller with no App Check token', res.status >= 400 && res.status < 500 && !('result' in body), `status ${res.status}`);
    } catch (e) {
      record('cloud functions refuse a caller with no App Check token', false, e instanceof Error ? e.message : String(e));
    }
  }
  return results;
}

async function main() {
  const args = process.argv.slice(2);
  const url = args.find((a) => /^https?:\/\//.test(a));
  const at = args.indexOf('--functions');
  const project = at >= 0 ? args[at + 1] : undefined;
  if (!url) {
    console.error('Usage: node scripts/smoke-check.mjs https://<site>.web.app [--functions <firebase project id>]');
    process.exit(2);
  }
  const results = await runSmoke(url, { project });
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok || !r.detail ? '' : `  (${r.detail})`}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(failed ? `\n${failed} of ${results.length} checks failed for ${url}` : `\nAll ${results.length} checks passed for ${url}`);
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
