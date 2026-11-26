/**
 * The install-menu shortcuts of the web app (docs/14 §18.3), in scripts/build-pwa.mjs: the fixed ones in the
 * built manifest, and the pinned-app ones the service worker adds from what the page keeps in its cache.
 * The worker is built for real into a temporary folder and run in a small fake of the browser's worker scope.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pinnedShortcuts, SHORTCUT_URL } from './shortcuts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SCRIPT = join(ROOT, 'scripts', 'build-pwa.mjs');

interface Shortcut {
  name: string;
  short_name?: string;
  url: string;
  icons?: Array<{ src: string; sizes: string }>;
}
interface PwaModule {
  SHORTCUTS: Shortcut[];
  manifestShortcuts(icons?: unknown[]): Shortcut[];
  pinnedShortcutEntries(list: unknown, max: number): Shortcut[];
}
const load = async (): Promise<PwaModule> => (await import(/* @vite-ignore */ pathToFileURL(SCRIPT).href)) as PwaModule;

/** A page that exists in the app for a path like /create/draw (a file or a folder index). */
const routeExists = (url: string): boolean =>
  existsSync(join(ROOT, 'src', 'app', `${url}.tsx`)) || existsSync(join(ROOT, 'src', 'app', url, 'index.tsx'));

describe('fixed shortcuts', () => {
  it('open pages that exist in the app', async () => {
    const { SHORTCUTS } = await load();
    expect(SHORTCUTS.map((s) => s.name)).toEqual(['New app', 'Draw an app']);
    for (const s of SHORTCUTS) {
      expect(routeExists(s.url), s.url).toBe(true);
      expect(s.short_name && s.short_name.length).toBeLessThanOrEqual(12);
    }
  });

  it('carry the 192 px icon when the manifest has one, and none otherwise', async () => {
    const { manifestShortcuts } = await load();
    const icons = [
      { src: '/icons/a.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/b.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/m.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
    ];
    expect(manifestShortcuts(icons)[0].icons).toEqual([{ src: '/icons/b.png', sizes: '192x192', type: 'image/png' }]);
    expect(manifestShortcuts([])[0].icons).toBeUndefined();
  });
});

describe('the list the page hands to the worker', () => {
  it('keeps only same-origin app paths, with short names, at most the limit', async () => {
    const { pinnedShortcutEntries } = await load();
    const out = pinnedShortcutEntries(
      [
        { name: ' Tea shop ', url: '/app/app_tea1' },
        { name: 'Evil', url: 'https://evil.example/app/abc' },
        { name: 'Script', url: 'javascript:alert(1)' },
        { name: 'Deep', url: '/app/app_tea1/edit' },
        { name: 'Query', url: '/app/app_tea1?x=1' },
        { name: '', url: '/app/app_empty1' },
        { name: 42, url: '/app/app_num01' },
        null,
        { name: 'L'.repeat(80), url: '/app/app_long01' },
        { name: 'Three', url: '/app/app_three' },
        { name: 'Four', url: '/app/app_four1' },
      ],
      3,
    );
    expect(out.map((s) => s.url)).toEqual(['/app/app_tea1', '/app/app_long01', '/app/app_three']);
    expect(out[0]).toEqual({ name: 'Tea shop', short_name: 'Tea shop', url: '/app/app_tea1' });
    expect(out[1].name).toHaveLength(30);
    expect((await load()).pinnedShortcutEntries('nope', 4)).toEqual([]);
  });

  it('accepts everything the app writes: pinnedShortcuts() output passes the worker check unchanged', async () => {
    const { pinnedShortcutEntries } = await load();
    const written = pinnedShortcuts([
      { id: 'app_tea0001', pinned: true, spec: { name: 'Tea' } },
      { id: 'app_book001', pinned: true, spec: { name: 'Book' } },
    ]);
    expect(written.every((s) => SHORTCUT_URL.test(s.url))).toBe(true);
    expect(pinnedShortcutEntries(written, 4).map(({ name, url }) => ({ name, url }))).toEqual(written);
  });
});

describe('the built manifest and service worker', () => {
  let dist = '';
  beforeAll(() => {
    dist = mkdtempSync(join(tmpdir(), 'kalam-pwa-'));
    writeFileSync(join(dist, 'index.html'), '<!doctype html><html><head></head><body></body></html>');
    const run = spawnSync(process.execPath, [SCRIPT, dist], { encoding: 'utf8' });
    if (run.status !== 0) throw new Error(`build-pwa failed: ${run.stderr || run.stdout}`);
  });
  afterAll(() => rmSync(dist, { recursive: true, force: true }));

  it('writes the fixed shortcuts into the manifest, with icons that were copied', () => {
    const manifest = JSON.parse(readFileSync(join(dist, 'manifest.webmanifest'), 'utf8')) as { shortcuts: Shortcut[] };
    expect(manifest.shortcuts.map((s) => s.url)).toEqual(['/create', '/create/draw']);
    for (const s of manifest.shortcuts) {
      expect(s.icons?.[0].sizes).toBe('192x192');
      expect(existsSync(join(dist, (s.icons?.[0].src ?? '').slice(1)))).toBe(true);
    }
  });

  /** Runs sw.js in a fake worker scope, with an in-memory cache, and answers one request for the manifest. */
  async function askForManifest(pinned: unknown): Promise<{ shortcuts: Shortcut[] }> {
    const store = new Map<string, Map<string, Response>>();
    const bucket = (name: string) => {
      let b = store.get(name);
      if (!b) store.set(name, (b = new Map()));
      return b;
    };
    const path = (r: Request | string) => new URL(typeof r === 'string' ? r : r.url, 'https://kalam.test').pathname;
    const caches = {
      open: async (name: string) => ({
        match: async (r: Request | string) => bucket(name).get(path(r))?.clone(),
        put: async (r: Request | string, res: Response) => void bucket(name).set(path(r), res),
      }),
      match: async (r: Request | string, o?: { cacheName?: string }) => (o?.cacheName ? bucket(o.cacheName).get(path(r))?.clone() : undefined),
      keys: async () => [...store.keys()],
      delete: async (name: string) => store.delete(name),
    };
    // What the install step would have cached: the manifest as built.
    const built = readFileSync(join(dist, 'manifest.webmanifest'), 'utf8');
    const cacheName = /const CACHE = "([^"]+)"/.exec(readFileSync(join(dist, 'sw.js'), 'utf8'))?.[1] ?? '';
    bucket(cacheName).set('/manifest.webmanifest', new Response(built));
    if (pinned !== undefined) bucket('pinned-shortcuts').set('/__kalam/pinned.json', new Response(JSON.stringify(pinned)));

    const listeners: Record<string, (e: unknown) => void> = {};
    const scope = {
      location: { origin: 'https://kalam.test' },
      addEventListener: (type: string, fn: (e: unknown) => void) => void (listeners[type] = fn),
      clients: { claim: async () => undefined },
      skipWaiting: () => undefined,
    };
    const sandbox = { self: scope, caches, fetch: async () => new Response('offline', { status: 503 }), Response, Request, URL, setTimeout, Promise, JSON };
    vm.runInNewContext(readFileSync(join(dist, 'sw.js'), 'utf8'), sandbox);

    let answer: Promise<Response> | undefined;
    listeners.fetch({
      request: new Request('https://kalam.test/manifest.webmanifest'),
      respondWith: (p: Promise<Response>) => void (answer = p),
    });
    if (!answer) throw new Error('the worker did not answer for the manifest');
    return (await (await answer).json()) as { shortcuts: Shortcut[] };
  }

  it('answers the manifest as built when the person has pinned nothing or switched it off', async () => {
    expect((await askForManifest(undefined)).shortcuts.map((s) => s.url)).toEqual(['/create', '/create/draw']);
    expect((await askForManifest([])).shortcuts.map((s) => s.url)).toEqual(['/create', '/create/draw']);
  });

  it('adds the pinned apps after the fixed shortcuts', async () => {
    const m = await askForManifest([{ name: 'Tea shop', url: '/app/app_tea0001' }, { name: 'Ledger', url: '/app/app_ledger1' }]);
    expect(m.shortcuts.map((s) => s.url)).toEqual(['/create', '/create/draw', '/app/app_tea0001', '/app/app_ledger1']);
    expect(m.shortcuts[2]).toEqual({ name: 'Tea shop', short_name: 'Tea shop', url: '/app/app_tea0001' });
  });

  it('ignores anything in the cache that is not a plain app path', async () => {
    const m = await askForManifest([{ name: 'Evil', url: 'https://evil.example/' }, { name: 'Bad', url: '/create' }]);
    expect(m.shortcuts.map((s) => s.url)).toEqual(['/create', '/create/draw']);
  });

  it('never keeps more than four pinned apps', async () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ name: `App ${i}`, url: `/app/app_many0${i}` }));
    expect((await askForManifest(many)).shortcuts).toHaveLength(2 + 4);
  });

  it('keeps the pinned list in a cache the worker does not clear when it updates', () => {
    const sw = readFileSync(join(dist, 'sw.js'), 'utf8');
    const name = /const PINNED_CACHE = '([^']+)'/.exec(sw)?.[1] ?? '';
    expect(name).not.toMatch(/^kalam-/);
    expect(sw).toContain("key.startsWith('kalam-')");
  });
});
