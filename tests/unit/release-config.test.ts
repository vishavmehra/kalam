/**
 * Release configuration guards (checklist D16-029, D14-039, D11-033, D01-050, D04-062). Each one is a decision the
 * project made and wrote into a config file; the test keeps the config and the decision from drifting apart.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const json = (p: string) => JSON.parse(read(p)) as Record<string, any>;

function walk(dir: string, accept: (f: string) => boolean, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (['node_modules', 'lib', 'dist', '.expo'].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, accept, out);
    else if (accept(p)) out.push(p);
  }
  return out;
}

describe('Firebase SDK is pinned (D16-029)', () => {
  it('uses an exact version in package.json, the same one the lock file resolves', () => {
    const pkg = json('package.json');
    expect(pkg.dependencies.firebase).toMatch(/^\d+\.\d+\.\d+$/);
    const lock = json('package-lock.json');
    expect(lock.packages[''].dependencies.firebase).toBe(pkg.dependencies.firebase);
    expect(lock.packages['node_modules/firebase'].version).toBe(pkg.dependencies.firebase);
  });
});

describe('the widget module is registered (D14-039)', () => {
  const plugins = json('app.json').expo.plugins as Array<string | [string, unknown]>;
  const names = plugins.map((p) => (Array.isArray(p) ? p[0] : p));

  it('lists every native module plugin in app.json, and the files exist', () => {
    for (const plugin of ['./modules/kalam-nano/app.plugin.js', './modules/kalam-widget/app.plugin.js']) {
      expect(names, plugin).toContain(plugin);
      expect(existsSync(join(ROOT, plugin)), plugin).toBe(true);
    }
    expect(existsSync(join(ROOT, 'modules/kalam-widget/expo-module.config.json'))).toBe(true);
  });

  it('the Android build runs when a module changes and checks the widget made it into the app', () => {
    const android = read('.github/workflows/android.yml');
    expect(android).toMatch(/paths:[\s\S]*- modules\/\*\*/);
    expect(android).toContain('KalamWidgetProvider');
  });
});

describe('Cloud Storage is not used (D11-033)', () => {
  it('has no storage entry in firebase.json and no storage.rules, so a deploy cannot touch the shared bucket rules', () => {
    expect(json('firebase.json').storage).toBeUndefined();
    expect(existsSync(join(ROOT, 'storage.rules'))).toBe(false);
  });

  it('records the decision next to the rules, and no code imports Cloud Storage', () => {
    expect(read('firestore.rules')).toContain('Cloud Storage: Kalam does not use it');
    const roots = ['src', 'functions/src', 'mcp/src'].map((d) => join(ROOT, d)).filter(existsSync);
    const offenders = roots.flatMap((r) =>
      walk(r, (f) => /\.(ts|tsx|js|mjs)$/.test(f)).filter((f) => /from ['"](firebase\/storage|@firebase\/storage)['"]|require\(['"]@google-cloud\/storage['"]\)|getStorage\(/.test(readFileSync(f, 'utf8'))),
    );
    expect(offenders.map((f) => f.slice(ROOT.length + 1))).toEqual([]);
  });
});

describe('emulators and tests (D01-050, D13-009)', () => {
  it('firebase.json runs Auth, Firestore and Functions emulators for the emulator tests', () => {
    const emulators = json('firebase.json').emulators;
    for (const name of ['auth', 'firestore', 'functions']) expect(emulators[name]?.port, name).toBeGreaterThan(0);
  });

  it('package.json has scripts to run the rules, emulator, deploy and smoke steps', () => {
    const scripts = json('package.json').scripts as Record<string, string>;
    expect(scripts['test:emulators']).toContain('--only auth,firestore,functions');
    expect(scripts['test:rules']).toContain('tests/rules/vitest.config.ts');
    expect(scripts.deploy).toBe('node scripts/deploy.mjs');
    expect(scripts.smoke).toBe('node scripts/smoke-check.mjs');
    expect(Object.values(scripts).join('\n')).not.toMatch(/--force/);
  });

  it('CI runs the emulator suite and the accessibility scans', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain('tests/emulator/vitest.config.ts');
    expect(ci).toContain('@a11y');
  });
});

describe('secret scanning (the Security job)', () => {
  const gitleaks = read('.github/gitleaks.toml');

  it('allows the three known false positives by file AND line shape, not by whole directory', () => {
    for (const path of ['mcp/test/firebase', 'src/infrastructure/bazaar/cache', 'tests/unit/data-minimisation']) expect(gitleaks).toContain(path);
    expect((gitleaks.match(/condition = "AND"/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(gitleaks).not.toMatch(/paths = \[\s*'''\^?(src|tests|mcp)\/?'''/);
  });

  it('still has the project rules for provider keys and App Check debug tokens', () => {
    for (const id of ['kalam-appcheck-debug-token', 'kalam-anthropic-api-key', 'kalam-nebius-api-key']) expect(gitleaks).toContain(id);
  });
});
