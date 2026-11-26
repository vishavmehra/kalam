/**
 * Web security headers and privacy rules (docs/11 §19.5-19.6, D11-049). Reads the two places the policy
 * lives: the hosting headers in firebase.json (what the browser really gets) and the CSP in the HTML shell
 * (src/app/+html.tsx). Both apply at once, so each must be safe alone and they must agree on scripts.
 * The privacy rules that are about requests (what leaves the device) are in data-minimisation.test.ts.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

type Policy = Map<string, string[]>;
const parse = (csp: string): Policy =>
  new Map(csp.split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
    const [name, ...values] = d.split(/\s+/);
    return [name!, values] as const;
  }));

const hosting = JSON.parse(read('firebase.json')).hosting.headers as Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
const global = Object.fromEntries((hosting.find((h) => h.source === '**')?.headers ?? []).map((h) => [h.key, h.value]));
const headerCsp = parse(global['Content-Security-Policy'] ?? '');

/** The CSP array in +html.tsx, with the development-only host list removed (release build). */
function shellCsp(): Policy {
  const body = /const CSP = \[([\s\S]*?)\]\.join\('; '\)/.exec(read('src/app/+html.tsx'))?.[1] ?? '';
  // One alternative per quote kind, so "default-src 'self'" stays whole.
  const quoted = /"([^"]*)"|`([^`]*)`|'([^']*)'/g;
  const literals = [...body.replace(/\$\{[^}]*\}/g, '').matchAll(quoted)].map((m) => m[1] ?? m[2] ?? m[3] ?? '');
  return parse(literals.join('; '));
}
const meta = shellCsp();

const POLICIES: Array<[string, Policy]> = [['firebase.json header', headerCsp], ['+html.tsx meta', meta]];
/** Hosts that hold provider keys or models. The app must never talk to them directly (docs/07 §7, §8). */
const PROVIDER_HOSTS = /anthropic|claude|nebius|tokenfactory|openai|api\.groq|mistral|cohere/i;

describe.each(POLICIES)('CSP in %s', (_name, csp) => {
  it('is a real policy: it parsed and starts from same-origin', () => {
    expect(csp.size).toBeGreaterThan(8);
    expect(csp.get('default-src')).toEqual(["'self'"]);
  });

  it('allows no inline or eval script, no wildcard and no plain http', () => {
    const script = csp.get('script-src') ?? [];
    expect(script).toContain("'self'");
    for (const bad of ["'unsafe-inline'", "'unsafe-eval'", "'wasm-unsafe-eval'", '*', 'data:', 'blob:', 'http:', 'https:']) expect(script, bad).not.toContain(bad);
    for (const [directive, values] of csp) {
      expect(values, directive).not.toContain('*');
      expect(values.filter((v) => /^(http|ws):\/\//.test(v)), directive).toEqual([]);
    }
  });

  it('only lets scripts load from the same origin, Google reCAPTCHA (App Check) and Google sign-in', () => {
    const hosts = (csp.get('script-src') ?? []).filter((v) => !v.startsWith("'"));
    expect(hosts.sort()).toEqual(['https://apis.google.com', 'https://www.google.com/recaptcha/', 'https://www.gstatic.com/recaptcha/']);
  });

  it('shuts the doors that generated apps never need: plugins, base tag, form posts elsewhere', () => {
    expect(csp.get('object-src')).toEqual(["'none'"]);
    expect(csp.get('base-uri')).toEqual(["'self'"]);
    expect(csp.get('form-action')).toEqual(["'self'"]);
  });

  it('lets the app talk to Firebase and Google only: a provider key never has a route from the browser', () => {
    const connect = csp.get('connect-src') ?? [];
    expect(connect).toContain("'self'");
    expect(connect.filter((v) => PROVIDER_HOSTS.test(v))).toEqual([]);
    expect(connect.filter((v) => !v.startsWith("'") && !/^https:\/\/[^/]*\b(googleapis\.com|cloudfunctions\.net|run\.app|google\.com)\b/.test(v))).toEqual([]);
    for (const [directive, values] of csp) expect(values.filter((v) => PROVIDER_HOSTS.test(v)), directive).toEqual([]);
  });

  it('keeps no localhost or development host in the release policy', () => {
    for (const [directive, values] of csp) expect(values.filter((v) => /localhost|127\.0\.0\.1/.test(v)), directive).toEqual([]);
  });

  it('allows inline style only (react-native-web needs it) and no remote style host', () => {
    const style = csp.get('style-src') ?? [];
    expect(style).toEqual(["'self'", "'unsafe-inline'"]);
  });
});

describe('the policies agree', () => {
  it('both name the same script hosts', () => {
    expect(meta.get('script-src')).toEqual(headerCsp.get('script-src'));
  });

  it('the hosting header adds what a meta tag cannot: no framing, https only', () => {
    expect(headerCsp.get('frame-ancestors')).toEqual(["'none'"]);
    expect(headerCsp.has('upgrade-insecure-requests')).toBe(true);
    expect(global['X-Frame-Options']).toBe('DENY');
  });

  it('the header lists no host the shell does not also allow to connect to, except the Firebase endpoints it names', () => {
    // The meta policy uses https://*.googleapis.com; every googleapis host in the header must fit under it.
    for (const host of (headerCsp.get('connect-src') ?? []).filter((v) => v.includes('googleapis.com'))) {
      expect(host).toMatch(/^https:\/\/(\*\.)?[a-z0-9-]*\.?googleapis\.com$/);
    }
    expect(meta.get('connect-src')).toContain('https://*.googleapis.com');
  });
});

describe('other headers', () => {
  it('stops sniffing, framing and referrer leaks, and forces https', () => {
    expect(global['X-Content-Type-Options']).toBe('nosniff');
    expect(global['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(global['Strict-Transport-Security']).toMatch(/max-age=\d{7,}/);
    expect(global['Cross-Origin-Resource-Policy']).toBe('same-origin');
  });

  it('grants camera and microphone to this origin only, and nothing else sensitive', () => {
    const grants = Object.fromEntries((global['Permissions-Policy'] ?? '').split(',').map((p) => p.trim().split('=') as [string, string]));
    expect(grants.camera).toBe('(self)');
    expect(grants.microphone).toBe('(self)');
    for (const feature of ['geolocation', 'payment', 'usb', 'serial', 'bluetooth', 'hid', 'display-capture']) expect(grants[feature], feature).toBe('()');
  });

  it('serves the service worker and the entry page without long caching, so a fix reaches people', () => {
    for (const source of ['/sw.js', '/index.html']) {
      expect(hosting.find((h) => h.source === source)?.headers.find((h) => h.key === 'Cache-Control')?.value, source).toBe('no-cache');
    }
  });
});

describe('the HTML shell', () => {
  const shell = read('src/app/+html.tsx');

  it('has no script tag of its own, so there is no inline script to allow', () => {
    expect(shell).not.toMatch(/<script/i);
    expect(shell).not.toMatch(/\beval\s*\(|new Function\s*\(/);
  });

  it('asks browsers not to send the page address to other sites', () => {
    expect(shell).toContain('name="referrer"');
  });
});

describe('secrets stay on the server (docs/11 §12, CLAUDE.md §12)', () => {
  const env = read('.env.example');

  it('names no provider key as a public client variable', () => {
    const publicNames = [...env.matchAll(/^\s*(EXPO_PUBLIC_[A-Z0-9_]+)\s*=/gm)].map((m) => m[1]!);
    expect(publicNames.length).toBeGreaterThan(0);
    expect(publicNames.filter((n) => /(ANTHROPIC|CLAUDE|NEBIUS|OPENAI)[A-Z_]*(KEY|TOKEN|SECRET)|SECRET|PRIVATE/.test(n))).toEqual([]);
  });

  it('holds placeholders only: no value that looks like a real key', () => {
    for (const [, name, value] of env.matchAll(/^\s*([A-Z0-9_]+)\s*=\s*(\S+)\s*$/gm)) {
      expect(value, name).not.toMatch(/^(sk-[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{30,}|ya29\.[0-9A-Za-z_-]+|eyJ[0-9A-Za-z_-]{20,})/);
    }
  });
});

describe('privacy defaults (nothing leaves without a choice)', () => {
  it('keeps other AI providers off and does not keep recordings until the person asks', async () => {
    const { DEFAULT_SETTINGS } = await import('@/core/contracts');
    expect(DEFAULT_SETTINGS.allowExternalProviders).toBe(false);
    expect(DEFAULT_SETTINGS.speech?.keepRecordings ?? false).toBe(false);
  });

  it('ships the specialist providers switched off in the example environment', () => {
    const line = /^\s*EXPO_PUBLIC_SPECIALIST_ENABLED\s*=\s*(\S*)\s*$/m.exec(read('.env.example'))?.[1];
    expect(line === undefined || line === '' || line === 'false').toBe(true);
  });

  it('records no recovery or timing detail beyond closed lists (see the recovery and observability tests)', async () => {
    const { createRecoveryLog, createTimingLog } = await import('@/core/observability');
    const recovery = createRecoveryLog();
    const timing = createTimingLog();
    recovery.note({ code: 'timeout', outcome: 'shown', ...({ detail: 'SENTINEL' } as object) });
    timing.record('thumbnail', 5, { count: 1, ...({ file: 'SENTINEL.jpg' } as object) });
    expect(JSON.stringify([recovery.recent(), timing.events()])).not.toContain('SENTINEL');
  });
});
