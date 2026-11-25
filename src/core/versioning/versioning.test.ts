import { describe, expect, it } from 'vitest';
import type { AppVersion } from '../contracts';
import type { KalamSpec } from '../spec/schema';
import { MAX_VERSIONS, applyRetention, createVersion, materialize, sameDesign } from './index';

function spec(name: string, extraScreens = 0): KalamSpec {
  return {
    id: 'app_test',
    schemaVersion: '1.0.0',
    version: 1,
    name,
    lang: 'en',
    theme: { primary: '#315C4C', radius: 12, fontScale: 1 },
    collections: {},
    screens: [
      { id: 'home', title: name, children: [{ id: 'hello', type: 'text', label: `Hello ${name}` }] },
      ...Array.from({ length: extraScreens }, (_, i) => ({ id: `s${i}`, title: `Screen ${i}`, children: [] })),
    ],
    initialScreen: 'home',
    actions: {},
    aiBlocks: {},
    intents: {},
    meta: { createdAt: 1 },
  };
}

/** Builds a history of `count` versions; returns the entries and the exact spec of each version. */
function history(count: number): { versions: AppVersion[]; specs: Map<number, KalamSpec> } {
  const versions: AppVersion[] = [];
  const specs = new Map<number, KalamSpec>();
  let previous: { version: number; spec: KalamSpec } | undefined;
  for (let n = 1; n <= count; n++) {
    const s = { ...spec(`App ${n}`, n % 4), version: n };
    versions.push(createVersion('app_test', previous, s, { summary: `edit ${n}`, source: n === 1 ? 'create' : 'edit' }, n));
    specs.set(n, s);
    previous = { version: n, spec: s };
  }
  return { versions, specs };
}

describe('versioning', () => {
  it('snapshots version 1 and every 10th version, patches in between', () => {
    const { versions } = history(21);
    const snapshots = versions.filter((v) => v.kind === 'snapshot').map((v) => v.version);
    expect(snapshots).toEqual([1, 11, 21]);
    expect(versions[1].patch?.length).toBeGreaterThan(0);
    expect(versions[1].snapshot).toBeUndefined();
  });

  it('materializes every version exactly', () => {
    const { versions, specs } = history(23);
    for (const [n, s] of specs) expect(materialize(versions, n)).toEqual(s);
    expect(materialize(versions, 99)).toBeUndefined();
  });

  it('returns undefined for broken chains and corrupt patches instead of throwing', () => {
    const { versions } = history(5);
    expect(materialize(versions.filter((v) => v.version !== 3), 4)).toBeUndefined();
    const corrupt = versions.map((v) =>
      v.version === 2 ? { ...v, patch: [{ op: 'replace' as const, path: '/nope/deep', value: 1 }] } : v,
    );
    expect(materialize(corrupt, 3)).toBeUndefined();
  });

  it('retains the newest 20 and rebases the oldest kept version into a snapshot', () => {
    const { versions, specs } = history(25);
    const { keep, remove, rebased } = applyRetention(versions);
    expect(keep).toHaveLength(MAX_VERSIONS);
    expect(remove).toEqual([1, 2, 3, 4, 5]);
    expect(rebased?.version).toBe(6);
    expect(keep[0].kind).toBe('snapshot');
    for (const v of keep) expect(materialize(keep, v.version)).toEqual(specs.get(v.version));
    expect(applyRetention(versions.slice(0, 20)).remove).toEqual([]);
  });

  it('restore = materialize old version and append it as a new version; later history survives', () => {
    const { versions, specs } = history(12);
    const latest = { version: 12, spec: specs.get(12)! };
    const restored = { ...materialize(versions, 3)!, version: 13 };
    const entry = createVersion('app_test', latest, restored, { summary: 'Restored version 3', source: 'restore' }, 13);
    const all = [...versions, entry];
    expect(entry.version).toBe(13);
    expect(sameDesign(materialize(all, 13)!, specs.get(3)!)).toBe(true);
    for (let n = 1; n <= 12; n++) expect(materialize(all, n)).toEqual(specs.get(n));
  });

  it('sameDesign ignores version and meta.updatedAt only', () => {
    const a = spec('A');
    expect(sameDesign(a, { ...a, version: 9, meta: { ...a.meta, updatedAt: 5 } })).toBe(true);
    expect(sameDesign(a, { ...a, name: 'B' })).toBe(false);
  });
});
