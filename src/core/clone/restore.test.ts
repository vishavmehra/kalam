import { describe, expect, it } from 'vitest';
import type { AppVersion } from '../contracts';
import type { KalamSpec } from '../spec/schema';
import { instantiateCatalogEntry } from '../templates/catalog';
import { cloneSpec, createVersion } from '../versioning';
import { RESTORE_COPY, confirmRestore, previewRestore, undoRestoreTarget } from './index';

const T0 = 1_794_950_000_000;
const base = (): KalamSpec => {
  const r = instantiateCatalogEntry('notes', { appId: 'app_time', now: T0, lang: 'en' });
  if (!r.ok) throw new Error(r.error);
  return r.value.spec;
};

interface Step { spec: KalamSpec; source: AppVersion['source']; summary: string }

function history(steps: Step[]): AppVersion[] {
  const out: AppVersion[] = [];
  let prev: { version: number; spec: KalamSpec } | undefined;
  steps.forEach((s, i) => {
    const v = createVersion('app_time', prev, s.spec, { summary: s.summary, source: s.source, origin: 'user' }, T0 + i * 60_000);
    out.push(v);
    prev = { version: v.version, spec: s.spec };
  });
  return out;
}

function standard(): { versions: AppVersion[]; specs: KalamSpec[] } {
  const v1 = base();
  const v2 = cloneSpec(v1);
  v2.screens[0]!.title = 'Today';
  const v3 = cloneSpec(v2);
  v3.collections.tags = { label: 'Tags', fields: { name: { type: 'text', label: 'Name', required: true } } };
  const v4 = cloneSpec(v3);
  v4.theme = { ...v4.theme, primary: '#1F5F8B' };
  const specs = [v1, v2, v3, v4];
  const versions = history(specs.map((spec, i) => ({ spec, source: i === 0 ? 'create' as const : 'edit' as const, summary: `Step ${i + 1}` })));
  return { versions, specs };
}

describe('previewRestore', () => {
  it('shows, in plain words, what going back to an older version would change', () => {
    const { versions } = standard();
    const p = previewRestore(versions, 2, 4);
    expect(p.ok).toBe(true);
    expect(p.problems).toEqual([]);
    expect(p.changes.length).toBeGreaterThan(0);
    expect(p.headline.length).toBeGreaterThan(0);
    expect(p.confirm.title).toBe('Restore version 2?');
    expect(p.confirm.message).toContain('saved as a new version');
    expect(p.confirm.message).toContain('version 4'); // the way back, because 4 is the newest
    expect(JSON.stringify(p)).not.toMatch(/—|!/);
  });

  it('is a preview only: it does not change the stored history', () => {
    const { versions } = standard();
    const before = JSON.stringify(versions);
    previewRestore(versions, 1, 4);
    previewRestore(versions, 3, 4);
    expect(JSON.stringify(versions)).toBe(before);
  });

  it('the rebuilt design is exactly the older design and is a separate copy', () => {
    const { versions, specs } = standard();
    const p = previewRestore(versions, 2, 4);
    expect(p.spec).toEqual(specs[1]);
    p.spec!.name = 'Changed';
    expect(previewRestore(versions, 2, 4).spec!.name).toBe(specs[1]!.name);
  });

  it('offers nothing to restore when the two designs are the same apart from bookkeeping', () => {
    const v1 = base();
    const v2 = cloneSpec(v1);
    v2.meta = { ...v2.meta, updatedAt: T0 + 5 };
    const versions = history([{ spec: v1, source: 'create', summary: 'a' }, { spec: v2, source: 'edit', summary: 'b' }]);
    const p = previewRestore(versions, 1, 2);
    // The database saves no new version for an identical design, so no button and no claim of a restore.
    expect(p.ok).toBe(false);
    expect(p.problems).toEqual([RESTORE_COPY.nothing]);
    expect(p.headline).toBe(RESTORE_COPY.nothing);
    expect(confirmRestore(p)).toBeUndefined();
  });

  it('a title changed and changed back is the same design, so it is not offered either', () => {
    const v1 = base();
    const v2 = cloneSpec(v1);
    v2.name = 'Another name';
    const v3 = cloneSpec(v2);
    v3.name = v1.name;
    const versions = history([
      { spec: v1, source: 'create', summary: 'a' }, { spec: v2, source: 'edit', summary: 'b' }, { spec: v3, source: 'edit', summary: 'c' },
    ]);
    expect(previewRestore(versions, 1, 3).ok).toBe(false);
    expect(previewRestore(versions, 2, 3).ok).toBe(true);
  });

  it('refuses the version that is already current', () => {
    const { versions } = standard();
    const p = previewRestore(versions, 4, 4);
    expect(p.ok).toBe(false);
    expect(p.problems).toEqual([RESTORE_COPY.current]);
    expect(confirmRestore(p)).toBeUndefined();
  });

  it('refuses while a proposed change is waiting', () => {
    const { versions } = standard();
    const p = previewRestore(versions, 2, 4, { hasDraft: true });
    expect(p.ok).toBe(false);
    expect(p.problems).toEqual([RESTORE_COPY.draft]);
  });

  it('refuses a version that can no longer be rebuilt', () => {
    const { versions } = standard();
    const broken = versions.filter((v) => v.version !== 3);
    const p = previewRestore(broken, 3, 4);
    expect(p.ok).toBe(false);
    expect(p.problems).toEqual([RESTORE_COPY.gone]);
  });

  it('never lets an invalid older version become the active design', () => {
    const v1 = base();
    const bad = cloneSpec(v1);
    bad.initialScreen = 'ghost_screen';
    const versions = history([
      { spec: v1, source: 'create', summary: 'a' },
      { spec: bad, source: 'edit', summary: 'broken by an old bug' },
      { spec: v1, source: 'edit', summary: 'fixed' },
    ]);
    const p = previewRestore(versions, 2, 3);
    expect(p.ok).toBe(false);
    expect(p.problems).toEqual([RESTORE_COPY.unsafe]);
    expect(p.spec).toBeUndefined();
    expect(confirmRestore(p)).toBeUndefined();
  });

  it('keeps entries apart from the design: says how many stay behind when a list is not in the older design', () => {
    const { versions } = standard();
    const p = previewRestore(versions, 2, 3, { recordCounts: { tags: 4, notes: 20 } });
    expect(p.ok).toBe(true);
    expect(p.affectsEntries).toBe(true);
    expect(p.entryNotes.join(' ')).toContain('4 saved entries in “Tags” stay on this device');
    expect(p.entryNotes.join(' ')).not.toContain('20');
  });

  it('a look-only change does not claim to affect entries', () => {
    const { versions } = standard();
    const p = previewRestore(versions, 3, 4);
    expect(p.ok).toBe(true);
    expect(p.affectsEntries).toBe(false);
    expect(p.impact).toBe('cosmetic');
    expect(p.entryNotes).toEqual([]);
  });
});

describe('confirmRestore', () => {
  it('hands back the older design as the change to save: a restore, by the person, as a new version', () => {
    const { versions, specs } = standard();
    const req = confirmRestore(previewRestore(versions, 2, 4));
    expect(req).toBeDefined();
    expect(req!.spec).toEqual(specs[1]);
    expect(req!.change).toEqual({ summary: 'Restored version 2', source: 'restore', origin: 'user' });
  });

  it('works end to end with the version repository rules: restoring adds a version and loses none', () => {
    const { versions, specs } = standard();
    const req = confirmRestore(previewRestore(versions, 2, 4))!;
    const previous = { version: 4, spec: specs[3]! };
    const next = createVersion('app_time', previous, req.spec, req.change, T0 + 10 * 60_000);
    const after = [...versions, next];
    expect(next.version).toBe(5);
    expect(next.source).toBe('restore');
    expect(after.map((v) => v.version)).toEqual([1, 2, 3, 4, 5]);
    // The newest version now reads as version 2, and version 4 is still there to go back to.
    expect(previewRestore(after, 4, 5).ok).toBe(true);
    expect(previewRestore(after, 4, 5).spec).toEqual(specs[3]);
  });
});

describe('undoRestoreTarget', () => {
  it('points at the version that was current before the latest restore', () => {
    const { versions, specs } = standard();
    const req = confirmRestore(previewRestore(versions, 2, 4))!;
    const next = createVersion('app_time', { version: 4, spec: specs[3]! }, req.spec, req.change, T0 + 99);
    expect(undoRestoreTarget([...versions, next])).toBe(4);
  });

  it('is undefined when the newest version is not a restore, or there is nothing to go back to', () => {
    const { versions } = standard();
    expect(undoRestoreTarget(versions)).toBeUndefined();
    expect(undoRestoreTarget([])).toBeUndefined();
  });
});
