import { describe, expect, it } from 'vitest';
import type { KalamRecord, RecordValue, StoredApp } from '../contracts';
import { validateSpec } from '../spec/validate';
import { instantiateCatalogEntry } from '../templates/catalog';
import {
  CLONE_COPY, applyClonePlan, applyLookFrom, cloneDoneMessage, copyOrder, countCopyableEntries, countPictures, defaultCloneName,
  planClone, type CloneStore, type ClonePlan,
} from './index';

const NOW = 1_794_950_000_000;
let counter = 0;
const ctxBase = { newId: () => `app_clone${++counter}`, now: NOW };

function install(id: string, appId = 'app_source', theme: 'ocean_blue' | 'warm_paper' = 'ocean_blue'): StoredApp {
  const r = instantiateCatalogEntry(id, { appId, now: NOW - 86_400_000, lang: 'en' }, { theme });
  if (!r.ok) throw new Error(r.error);
  return { id: appId, spec: r.value.spec, createdAt: NOW - 86_400_000, updatedAt: NOW - 86_400_000, origin: { ...r.value.origin }, creationInput: { text: 'my private words', modalities: ['text'] }, pinned: true };
}

const rec = (id: string, collectionId: string, values: Record<string, RecordValue>, createdAt: number, appId = 'app_source'): KalamRecord =>
  ({ id, appId, collectionId, createdAt, updatedAt: createdAt, values });

/** Customers and entries of a credit book, linked by id. */
const RECORDS: KalamRecord[] = [
  rec('c1', 'customers', { name: 'Ramesh' }, 1),
  rec('c2', 'customers', { name: 'Sunita' }, 2),
  rec('e1', 'entries', { customer: 'c1', kind: 'Credit given', amount: 100, date: '2026-11-01' }, 3),
  rec('e2', 'entries', { customer: 'c2', kind: 'Credit given', amount: 50, date: '2026-11-02' }, 4),
  rec('e3', 'entries', { customer: 'c1', kind: 'Payment received', amount: 30, date: '2026-11-03' }, 5),
];

describe('defaultCloneName', () => {
  it('adds (copy), then (copy 2), and skips names that are taken', () => {
    expect(defaultCloneName('Kirana Book')).toBe('Kirana Book (copy)');
    expect(defaultCloneName('Kirana Book', ['kirana book (copy)'])).toBe('Kirana Book (copy 2)');
    expect(defaultCloneName('Kirana Book', ['Kirana Book (copy)', 'Kirana Book (copy 2)'])).toBe('Kirana Book (copy 3)');
  });
  it('shortens a long name instead of the suffix and stays within 60 characters', () => {
    const name = defaultCloneName('A'.repeat(60));
    expect(name.length).toBeLessThanOrEqual(60);
    expect(name.endsWith(' (copy)')).toBe(true);
  });
});

describe('planClone: design only (the default)', () => {
  const source = install('kirana_credit_book');
  const before = JSON.stringify(source);
  const r = planClone(source, { name: ' Branch Two ', mode: 'design' }, { ...ctxBase, records: RECORDS, state: { count: 3 } });

  it('makes an independent, valid app with a new id and version 1', () => {
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { app } = r.plan;
    expect(app.id).not.toBe(source.id);
    expect(app.spec.id).toBe(app.id);
    expect(app.spec.version).toBe(1);
    expect(app.spec.name).toBe('Branch Two');
    expect(app.spec.meta.basedOn).toBe(source.id);
    expect(app.spec.meta.source).toBe('remix');
    expect(app.spec.meta.createdAt).toBe(NOW);
    expect(validateSpec(app.spec).ok).toBe(true);
  });

  it('copies no entries, no saved values and nothing about the original’s history or private words', () => {
    if (!r.ok) throw new Error('plan failed');
    expect(r.plan.records).toEqual([]);
    expect(r.plan.state).toEqual([]);
    expect(r.plan.app.creationInput).toBeUndefined();
    expect(r.plan.app.pinned).toBeUndefined();
    expect(r.plan.app.archived).toBeUndefined();
  });

  it('starts with the standard look, not the original’s', () => {
    if (!r.ok) throw new Error('plan failed');
    expect(source.spec.theme.preset).toBe('ocean_blue');
    expect(r.plan.app.spec.theme.preset).toBe('calm_green');
    expect(r.plan.app.spec.icon?.background).toBe(r.plan.app.spec.theme.primary);
  });

  it('leaves the original exactly as it was', () => {
    expect(JSON.stringify(source)).toBe(before);
  });

  it('shares nothing mutable with the original', () => {
    if (!r.ok) throw new Error('plan failed');
    r.plan.app.spec.screens[0]!.title = 'Changed';
    r.plan.app.spec.collections.customers!.label = 'Changed';
    expect(source.spec.screens[0]!.title).not.toBe('Changed');
    expect(source.spec.collections.customers!.label).not.toBe('Changed');
  });
});

describe('planClone: design and look', () => {
  it('keeps the original’s colours and icon colour', () => {
    const source = install('kirana_credit_book');
    const r = planClone(source, { name: 'Copy', mode: 'design_theme' }, ctxBase);
    expect(r.ok && r.plan.app.spec.theme).toEqual(source.spec.theme);
    expect(r.ok && r.plan.app.spec.icon?.background).toBe(source.spec.icon?.background);
    expect(r.ok && r.plan.records).toEqual([]);
  });

  it('applyLookFrom copies only the look onto another app', () => {
    const a = install('kirana_credit_book', 'app_a');
    const b = install('notes', 'app_b', 'warm_paper');
    const out = applyLookFrom(b.spec, a.spec);
    expect(out.theme).toEqual(a.spec.theme);
    expect(out.icon?.background).toBe(a.spec.icon?.background);
    expect(out.screens).toEqual(b.spec.screens);
    expect(out.name).toBe(b.spec.name);
    expect(b.spec.theme).not.toEqual(a.spec.theme); // the input is not changed
  });
});

describe('planClone: entries need a confirmation', () => {
  const source = install('kirana_credit_book');
  it('refuses without a yes, and says why', () => {
    const r = planClone(source, { name: 'Copy', mode: 'with_records' }, { ...ctxBase, records: RECORDS });
    expect(r).toMatchObject({ ok: false, code: 'needs_confirmation', message: CLONE_COPY.errors.confirm });
    expect(planClone(source, { name: 'Copy', mode: 'with_records', confirmedRecords: false }, { ...ctxBase, records: RECORDS }).ok).toBe(false);
  });

  it('a confirmation on a design-only copy copies no entries', () => {
    const r = planClone(source, { name: 'Copy', mode: 'design', confirmedRecords: true }, { ...ctxBase, records: RECORDS });
    expect(r.ok && r.plan.records).toEqual([]);
  });

  it('with the yes, copies this app’s entries oldest first, plus saved values, and keeps the look', () => {
    const other = rec('x1', 'customers', { name: 'Other app' }, 9, 'app_other');
    const r = planClone(source, { name: 'Copy', mode: 'with_records', confirmedRecords: true }, { ...ctxBase, records: [...RECORDS.slice().reverse(), other], state: { count: 3 } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.records.map((x) => x.sourceId)).toEqual(['c1', 'c2', 'e1', 'e2', 'e3']);
    expect(r.plan.state).toEqual([{ key: 'count', value: 3 }]);
    expect(r.plan.app.spec.theme).toEqual(source.spec.theme);
  });

  it('drops values of fields the design no longer has, and counts pictures it leaves behind', () => {
    const r = planClone(source, { name: 'Copy', mode: 'with_records', confirmedRecords: true }, {
      ...ctxBase, records: [rec('c1', 'customers', { name: 'Ramesh', gone_field: 'x' }, 1)],
    });
    expect(r.ok && r.plan.records[0]?.values).toEqual({ name: 'Ramesh' });
    expect(countPictures(source.spec, RECORDS)).toBe(0);
  });
});

describe('planClone: bad requests', () => {
  const source = install('notes');
  it('rejects an empty or too long name', () => {
    expect(planClone(source, { name: '   ', mode: 'design' }, ctxBase)).toMatchObject({ ok: false, code: 'invalid_name' });
    expect(planClone(source, { name: 'x'.repeat(61), mode: 'design' }, ctxBase)).toMatchObject({ ok: false, code: 'invalid_name' });
  });
  it('rejects an id the spec would not accept', () => {
    expect(planClone(source, { name: 'Copy', mode: 'design' }, { ...ctxBase, newId: () => 'Not A Valid Id' })).toMatchObject({ ok: false, code: 'invalid_id' });
  });
  it('rejects a design that fails validation', () => {
    const broken: StoredApp = { ...source, spec: { ...source.spec, initialScreen: 'missing_screen' } };
    expect(planClone(broken, { name: 'Copy', mode: 'design' }, ctxBase)).toMatchObject({ ok: false, code: 'invalid_design' });
  });
});

// ─── applyClonePlan against an in-memory store ────────────────────────────────
function memoryStore(failOnInsert?: number) {
  const apps = new Map<string, StoredApp>();
  const records: KalamRecord[] = [];
  const state: Array<{ appId: string; key: string; value: RecordValue }> = [];
  const log: string[] = [];
  let n = 0;
  const store: CloneStore = {
    apps: {
      async save(app) { apps.set(app.id, app); log.push(`save ${app.id}`); return app; },
      async remove(id) { apps.delete(id); for (let i = records.length - 1; i >= 0; i--) if (records[i]!.appId === id) records.splice(i, 1); log.push(`remove ${id}`); },
    },
    records: {
      async insert(appId, collectionId, values) {
        if (failOnInsert !== undefined && n === failOnInsert) throw new Error('disk full');
        n++;
        const row = rec(`new_${n}`, collectionId, { ...values }, 100 + n, appId);
        records.push(row);
        return row;
      },
      async update(appId, collectionId, id, values) {
        const row = records.find((r) => r.id === id && r.appId === appId && r.collectionId === collectionId);
        if (!row) throw new Error('missing');
        row.values = { ...row.values, ...values };
        return row;
      },
    },
    state: { async set(appId, key, value) { state.push({ appId, key, value }); } },
  };
  return { store, apps, records, state, log };
}

describe('applyClonePlan', () => {
  const source = install('kirana_credit_book');
  const planned = (): ClonePlan => {
    const r = planClone(source, { name: 'Branch Two', mode: 'with_records', confirmedRecords: true }, { ...ctxBase, records: RECORDS, state: { count: 3 } });
    if (!r.ok) throw new Error(r.message);
    return r.plan;
  };

  it('copies every entry and rewrites each link to the new entry, never the original', async () => {
    const m = memoryStore();
    const plan = planned();
    await applyClonePlan(plan, m.store);
    expect(m.apps.has(plan.app.id)).toBe(true);
    const customers = m.records.filter((r) => r.collectionId === 'customers');
    const entries = m.records.filter((r) => r.collectionId === 'entries');
    expect(customers.map((r) => r.values.name)).toEqual(['Ramesh', 'Sunita']);
    expect(entries).toHaveLength(3);
    const newIds = new Set(customers.map((r) => r.id));
    expect(entries.every((e) => newIds.has(String(e.values.customer)))).toBe(true);
    expect(entries.some((e) => ['c1', 'c2'].includes(String(e.values.customer)))).toBe(false);
    // The same customer owns the same entries as before.
    const ramesh = customers.find((r) => r.values.name === 'Ramesh')!.id;
    expect(entries.filter((e) => e.values.customer === ramesh).map((e) => e.values.amount)).toEqual([100, 30]);
    expect(m.state).toEqual([{ appId: plan.app.id, key: 'count', value: 3 }]);
    expect(m.records.every((r) => r.appId === plan.app.id)).toBe(true);
  });

  it('saves the app first, then the entries, and writes only to the copy', async () => {
    const m = memoryStore();
    await applyClonePlan(planned(), m.store);
    expect(m.log[0]).toMatch(/^save app_clone/);
    expect([...m.apps.keys()].includes('app_source')).toBe(false);
  });

  it('removes the new app again if any step fails, and raises the error', async () => {
    const m = memoryStore(2);
    const plan = planned();
    await expect(applyClonePlan(plan, m.store)).rejects.toThrow('disk full');
    expect(m.apps.has(plan.app.id)).toBe(false);
    expect(m.records).toEqual([]);
    expect(m.log.at(-1)).toBe(`remove ${plan.app.id}`);
  });

  it('copies a design-only plan with no entries at all', async () => {
    const m = memoryStore();
    const r = planClone(source, { name: 'Just design', mode: 'design' }, ctxBase);
    if (!r.ok) throw new Error('plan failed');
    await applyClonePlan(r.plan, m.store);
    expect(m.records).toEqual([]);
    expect(m.apps.size).toBe(1);
  });
});

describe('copyOrder', () => {
  it('fills a list that others link to before the lists that link to it', () => {
    const source = install('kirana_credit_book');
    expect(copyOrder(source.spec)).toEqual(['customers', 'entries']);
    expect(copyOrder(install('attendance_register').spec)).toEqual(['students', 'attendance']);
  });

  it('survives a loop between two lists', () => {
    const base = install('kirana_credit_book').spec;
    const looped = structuredClone(base);
    looped.collections.customers!.fields.latest = { type: 'text', label: 'Latest', ref: { collection: 'entries', onDelete: 'clear' } };
    expect(copyOrder(looped).sort()).toEqual(['customers', 'entries']);
  });
});

describe('what the person reads about a copy', () => {
  it('counts only the entries of lists the design still has, as the copy does', () => {
    const source = install('kirana_credit_book');
    const orphan = rec('o1', 'old_list', { a: 1 }, 6);
    expect(countCopyableEntries(source.spec, [...RECORDS, orphan])).toBe(5);
    const r = planClone(source, { name: 'Copy', mode: 'with_records', confirmedRecords: true }, { ...ctxBase, records: [...RECORDS, orphan] });
    expect(r.ok && r.plan.records).toHaveLength(5);
  });

  it('the toast says what stayed behind, in plain words, and nothing when nothing did', () => {
    expect(cloneDoneMessage('Branch Two', { skippedEntries: 0, skippedPictures: 0 })).toEqual({ message: 'Branch Two is on your shelf', partial: false });
    const left = cloneDoneMessage('Branch Two', { skippedEntries: 2, skippedPictures: 1 });
    expect(left.partial).toBe(true);
    expect(left.message).toBe('Branch Two is on your shelf. 2 entries did not fit their list and were left out. 1 picture stays with the original.');
    expect(`${left.message}${JSON.stringify(CLONE_COPY)}`).not.toMatch(/—|!/);
  });

  it('says before copying that entries get the day they were copied as their date', () => {
    expect(CLONE_COPY.confirmEntries.message('Kirana Credit Book')).toContain('today');
  });
});

describe('what the clone does not do', () => {
  it('versions are not copied: the new app starts at version 1 with its own first version summary', () => {
    const source = install('notes');
    const r = planClone(source, { name: 'Copy', mode: 'design' }, ctxBase);
    expect(r.ok && r.plan.summary).toBe(CLONE_COPY.summary(source.spec.name));
    // The repository creates versions when it saves; a plan carries none, so history is never shared.
    expect(r.ok && Object.keys(r.plan)).not.toContain('versions');
  });
});
