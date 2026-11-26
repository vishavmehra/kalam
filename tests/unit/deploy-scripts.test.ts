/**
 * The deploy script and the smoke check (checklist D04-062). The Firebase project is shared with another app, so the
 * script must only ever deploy Kalam's own named targets and never accept --force. The smoke check is exercised
 * with a fake fetch that serves what Firebase Hosting would.
 */
import { describe, expect, it } from 'vitest';
import { TARGETS, bundleSecretFiles, parseArgs, planDeploy, siteUrlFromFirebaserc } from '../../scripts/deploy.mjs';
import { expectedGlobalHeaders, firstBundlePath, headerProblems, runSmoke } from '../../scripts/smoke-check.mjs';

describe('deploy: the command line', () => {
  it('defaults to Hosting only', () => {
    expect(parseArgs([])).toMatchObject({ only: 'hosting', dryRun: false, skipBuild: false, skipSmoke: false });
  });

  it('refuses --force in every spelling', () => {
    for (const bad of [['--force'], ['-f'], ['--force=true'], ['--only', 'hosting', '--force']]) {
      expect(() => parseArgs(bad), bad.join(' ')).toThrow(/--force is not allowed/);
    }
  });

  it('refuses unknown options, an unknown target and a malformed project or address', () => {
    expect(() => parseArgs(['--all'])).toThrow(/Unknown option/);
    expect(() => parseArgs(['--only', 'everything'])).toThrow(/--only must be/);
    expect(() => parseArgs(['--project', 'Not A Project'])).toThrow(/valid Firebase project id/);
    expect(() => parseArgs(['--url', 'http://example.web.app'])).toThrow(/https/);
    expect(() => parseArgs(['--url', 'https://example.web.app/some/path'])).toThrow(/no path/);
    expect(parseArgs(['--project', 'demo-kalam', '--url', 'https://kalam-x.web.app', '--dry-run'])).toMatchObject({ project: 'demo-kalam', url: 'https://kalam-x.web.app', dryRun: true });
  });
});

describe('deploy: the plan', () => {
  it('builds, scans the bundle, deploys the kalam Hosting target, then smoke checks', () => {
    const steps = planDeploy(parseArgs([]));
    expect(steps.map((s) => s.label)).toEqual([
      'Build the web app',
      'Check the bundle has no provider keys',
      'Deploy hosting:kalam',
      'Smoke check the live site',
    ]);
  });

  it('puts rules first and Hosting last when everything is deployed', () => {
    const labels = planDeploy(parseArgs(['--only', 'all'])).filter((s) => s.cmd === 'firebase').map((s) => s.label);
    expect(labels).toEqual(['Deploy firestore:kalam', 'Deploy functions:kalam', 'Deploy hosting:kalam']);
  });

  it('only ever deploys named kalam targets, non-interactively, with no --force and never a bare deploy', () => {
    for (const only of ['hosting', 'functions', 'rules', 'all']) {
      for (const step of planDeploy(parseArgs(['--only', only, '--project', 'demo-kalam']))) {
        if (step.cmd !== 'firebase') continue;
        expect(step.args[0]).toBe('deploy');
        const target = step.args[step.args.indexOf('--only') + 1]!;
        expect(Object.values(TARGETS)).toContain(target);
        expect(target).toMatch(/:kalam$/);
        expect(step.args).toContain('--non-interactive');
        expect(step.args).not.toContain('--force');
        expect(step.args).toContain('--project');
      }
    }
  });

  it('can skip the build and the smoke check, and never builds for functions or rules alone', () => {
    expect(planDeploy(parseArgs(['--skip-build', '--skip-smoke'])).map((s) => s.label)).toEqual(['Check the bundle has no provider keys', 'Deploy hosting:kalam']);
    expect(planDeploy(parseArgs(['--only', 'functions'])).map((s) => s.label)).toEqual(['Deploy functions:kalam']);
  });

  it('finds the Hosting site address in .firebaserc, or says nothing', () => {
    expect(siteUrlFromFirebaserc({ targets: { proj: { hosting: { kalam: ['kalam-live'] } } } })).toBe('https://kalam-live.web.app');
    expect(siteUrlFromFirebaserc({ targets: { proj: { hosting: { kalam: [] } } } })).toBeUndefined();
    expect(siteUrlFromFirebaserc({})).toBeUndefined();
  });

  it('flags a provider key in a built script and nothing else', () => {
    const planted = `const k = "${['sk', 'ant', 'x'.repeat(30)].join('-')}";`;
    const files: Record<string, string> = { '/d/a.js': 'console.log(1)', '/d/b.js': planted, '/d/c.json': planted };
    const found = bundleSecretFiles('/d', { walk: () => Object.keys(files), read: (f: string) => files[f]! });
    expect(found).toEqual(['/d/b.js']);
  });
});

/** What Firebase Hosting would answer for each path of a healthy deploy. */
function healthySite(overrides: { dropHeader?: string; noSwCache?: boolean } = {}) {
  const expected = { ...expectedGlobalHeaders() };
  if (overrides.dropHeader) delete expected[overrides.dropHeader];
  const html = '<!doctype html><html><body><div id="root"></div><script src="/_expo/static/js/web/entry-abc123.js" defer></script></body></html>'.padEnd(400, ' ');
  const sw = `const CACHE = 'kalam-0123456789ab'; const SHELL = ['/index.html'];`;
  const manifest = { name: 'Kalam', start_url: '/', icons: [{ src: '/a.png' }, { src: '/b.png' }] };
  return async (input: string | URL | Request): Promise<Response> => {
    const path = new URL(String(input)).pathname;
    const base = { ...expected };
    if (path === '/sw.js') {
      return new Response(sw, { status: 200, headers: { ...base, 'content-type': 'text/javascript', 'cache-control': overrides.noSwCache ? 'max-age=3600' : 'no-cache' } });
    }
    if (path === '/manifest.webmanifest') return new Response(JSON.stringify(manifest), { status: 200, headers: { ...base, 'content-type': 'application/manifest+json', 'cache-control': 'no-cache' } });
    if (path.startsWith('/_expo/static/')) return new Response('//js', { status: 200, headers: { ...base, 'content-type': 'text/javascript', 'cache-control': 'public, max-age=31536000, immutable' } });
    if (path.endsWith('/kalamBazaarWallet')) return new Response(JSON.stringify({ error: { status: 'UNAUTHENTICATED' } }), { status: 401 });
    return new Response(html, { status: 200, headers: { ...base, 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' } });
  };
}

describe('smoke check', () => {
  it('reads the global headers from firebase.json, including a Content Security Policy', () => {
    const expected = expectedGlobalHeaders();
    expect(expected['content-security-policy']).toContain("default-src 'self'");
    expect(expected['x-content-type-options']).toBe('nosniff');
    expect(expected['strict-transport-security']).toBeDefined();
  });

  it('compares headers case-insensitively and names what is missing or different', () => {
    const actual = new Headers({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN' });
    expect(headerProblems(actual, { 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer' })).toEqual([
      'header x-frame-options differs from firebase.json',
      'missing header referrer-policy',
    ]);
  });

  it('finds the first script in the shell', () => {
    expect(firstBundlePath('<html><script src="/_expo/static/js/web/entry-1.js" defer></script></html>')).toBe('/_expo/static/js/web/entry-1.js');
    expect(firstBundlePath('<html></html>')).toBeUndefined();
  });

  it('passes on a healthy deploy, including the functions check', async () => {
    const results = await runSmoke('https://kalam-live.web.app', { project: 'kalam-proj', fetchImpl: healthySite() as typeof fetch });
    const failed = results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed)).toEqual([]);
    expect(results.length).toBeGreaterThanOrEqual(9);
  });

  it('fails when the Content Security Policy does not reach the browser', async () => {
    const results = await runSmoke('https://kalam-live.web.app', { fetchImpl: healthySite({ dropHeader: 'content-security-policy' }) as typeof fetch, expected: expectedGlobalHeaders() });
    const bad = results.filter((r) => !r.ok);
    expect(bad.map((r) => r.name)).toEqual(['security headers match firebase.json (CSP, framing, referrer, permissions)']);
    expect(bad[0]!.detail).toContain('missing header content-security-policy');
  });

  it('fails when the service worker could be cached', async () => {
    const results = await runSmoke('https://kalam-live.web.app', { fetchImpl: healthySite({ noSwCache: true }) as typeof fetch });
    expect(results.filter((r) => !r.ok).map((r) => r.name)).toEqual(['service worker is served as JavaScript and never cached']);
  });

  it('reports a site that cannot be reached as one failed check', async () => {
    const results = await runSmoke('https://kalam-live.web.app', { fetchImpl: (async () => { throw new Error('getaddrinfo ENOTFOUND'); }) as typeof fetch });
    expect(results).toEqual([{ name: 'home page is served', ok: false, detail: 'getaddrinfo ENOTFOUND' }]);
  });
});
