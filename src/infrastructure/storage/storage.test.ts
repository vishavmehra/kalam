import Dexie from 'dexie';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type InferenceEvent, type StoredApp } from '@/core/contracts';
import type { KalamSpec } from '@/core/spec/schema';
import { validateSpec } from '@/core/spec/validate';
import { createWebDatabase } from './database.web';
import { EVENT_CAP, InvalidSpecError, RecordValidationError } from './kalam-database';

let dbCounter = 0;
const freshName = () => `kalam-test-${++dbCounter}-${Date.now()}`;
const fresh = () => createWebDatabase(freshName());

function expenseSpec(id = 'app_expenses', name = 'Expenses'): KalamSpec {
  return {
    id,
    schemaVersion: '1.0.0',
    version: 1,
    name,
    lang: 'en',
    theme: { primary: '#315C4C', radius: 12, fontScale: 1 },
    collections: {
      expenses: {
        label: 'Expenses',
        fields: {
          title: { type: 'text', label: 'Title', required: true, maxLength: 40 },
          amount: { type: 'number', label: 'Amount', required: true, min: 0, max: 100000 },
          category: { type: 'enum', label: 'Category', options: ['Food', 'Travel'] },
          spent_on: { type: 'date', label: 'Date' },
          paid: { type: 'boolean', label: 'Paid' },
        },
      },
    },
    screens: [
      {
        id: 'home',
        title: name,
        form: 'expenses',
        children: [
          { id: 'title_input', type: 'textInput', label: 'Title', field: 'title' },
          { id: 'amount_input', type: 'number', label: 'Amount', field: 'amount' },
          { id: 'save', type: 'bigButton', label: 'Save', action: 'add_expense' },
          { id: 'all', type: 'list', source: 'expenses', primary: 'title', secondary: 'amount' },
          { id: 'cups', type: 'counter', label: 'Cups' },
        ],
      },
    ],
    initialScreen: 'home',
    actions: { add_expense: { type: 'insert', collection: 'expenses' } },
    aiBlocks: {},
    intents: {},
    meta: { createdAt: 1 },
  };
}

const stored = (spec: KalamSpec): StoredApp => ({
  id: spec.id, spec, createdAt: 1, updatedAt: 1, origin: { route: 'template', templateId: 'expense_tracker' },
});
const renamed = (spec: KalamSpec, name: string): KalamSpec => ({ ...spec, name });
const create = { summary: 'Created', source: 'create' } as const;
const edit = (n: number) => ({ summary: `Edit ${n}`, source: 'edit' as const });

describe('fixture', () => {
  it('is a valid KalamSpec', () => {
    const result = validateSpec(expenseSpec());
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

describe('apps', () => {
  it('saves, lists, reads, touches and versions an app atomically', async () => {
    const db = fresh();
    const saved = await db.apps.save(stored(expenseSpec()), create);
    expect(saved.spec.version).toBe(1);
    expect(await db.apps.get('app_expenses')).toEqual(saved);
    expect((await db.apps.list()).map((a) => a.id)).toEqual(['app_expenses']);

    const v2 = await db.apps.save({ ...saved, spec: renamed(saved.spec, 'Spending') }, edit(2));
    expect(v2.spec.version).toBe(2);
    const versions = await db.versions.list('app_expenses');
    expect(versions.map((v) => [v.version, v.kind])).toEqual([[2, 'patch'], [1, 'snapshot']]);
    expect((await db.versions.materialize('app_expenses', 1))?.name).toBe('Expenses');

    await db.apps.touch('app_expenses');
    expect((await db.apps.get('app_expenses'))?.lastOpenedAt).toBeGreaterThan(0);
  });

  it('metadata-only saves (pin) do not create a design version', async () => {
    const db = fresh();
    const saved = await db.apps.save(stored(expenseSpec()), create);
    const pinned = await db.apps.save({ ...saved, pinned: true }, { summary: 'Pinned', source: 'edit' });
    expect(pinned.pinned).toBe(true);
    expect(await db.versions.list('app_expenses')).toHaveLength(1);
  });

  it('rejects invalid designs and mismatched ids without writing', async () => {
    const db = fresh();
    const bad = { ...expenseSpec(), initialScreen: 'nowhere' };
    await expect(db.apps.save(stored(bad), create)).rejects.toBeInstanceOf(InvalidSpecError);
    await expect(db.apps.save({ ...stored(expenseSpec()), id: 'app_other' }, create)).rejects.toThrow(/does not match/);
    expect(await db.apps.list()).toEqual([]);
    expect(await db.versions.list('app_expenses')).toEqual([]);
  });

  it('keeps the last 20 versions, all materialisable, and restore appends a new version', async () => {
    const db = fresh();
    let app = await db.apps.save(stored(expenseSpec()), create);
    const record = await db.records.insert('app_expenses', 'expenses', { title: 'Tea', amount: 2 });
    for (let n = 2; n <= 25; n++) app = await db.apps.save({ ...app, spec: renamed(app.spec, `Expenses ${n}`) }, edit(n));

    const versions = await db.versions.list('app_expenses');
    expect(versions).toHaveLength(20);
    expect(versions.at(-1)).toMatchObject({ version: 6, kind: 'snapshot' });
    for (const v of versions) expect((await db.versions.materialize('app_expenses', v.version))?.name).toBe(`Expenses ${v.version}`);
    expect(await db.versions.materialize('app_expenses', 3)).toBeUndefined();

    const restored = await db.restore('app_expenses', 10);
    expect(restored.spec.name).toBe('Expenses 10');
    expect(restored.spec.version).toBe(26);
    const after = await db.versions.list('app_expenses');
    expect(after[0]).toMatchObject({ version: 26, source: 'restore', summary: 'Restored version 10' });
    expect((await db.versions.materialize('app_expenses', 25))?.name).toBe('Expenses 25');
    expect(await db.records.list('app_expenses', 'expenses')).toEqual([record]);
  });

  it('cascade-deletes versions, records and state but leaves other apps alone', async () => {
    const db = fresh();
    await db.apps.save(stored(expenseSpec()), create);
    await db.apps.save(stored(expenseSpec('app_other', 'Other')), create);
    await db.records.insert('app_expenses', 'expenses', { title: 'Tea', amount: 2 });
    const keep = await db.records.insert('app_other', 'expenses', { title: 'Bus', amount: 1 });
    await db.state.set('app_expenses', 'cups', 3);

    await db.apps.remove('app_expenses');
    expect(await db.apps.get('app_expenses')).toBeUndefined();
    expect(await db.versions.list('app_expenses')).toEqual([]);
    expect(await db.records.listAll('app_expenses')).toEqual({});
    expect(await db.state.all('app_expenses')).toEqual({});
    expect(await db.records.list('app_other', 'expenses')).toEqual([keep]);
    expect(await db.versions.list('app_other')).toHaveLength(1);
  });

  it('duplicates (remix) under a new id at version 1 without copying records', async () => {
    const db = fresh();
    await db.apps.save(stored(expenseSpec()), create);
    await db.records.insert('app_expenses', 'expenses', { title: 'Tea', amount: 2 });
    const copy = await db.duplicate('app_expenses');
    expect(copy.id).not.toBe('app_expenses');
    expect(copy.spec.id).toBe(copy.id);
    expect(copy.spec.version).toBe(1);
    expect(copy.spec.meta).toMatchObject({ basedOn: 'app_expenses', source: 'remix' });
    expect(copy.spec.name).toBe('Expenses (copy)');
    expect(await db.records.list(copy.id, 'expenses')).toEqual([]);
  });
});

describe('records', () => {
  it('validates values against the collection definition', async () => {
    const db = fresh();
    await db.apps.save(stored(expenseSpec()), create);
    const insert = (values: Record<string, unknown>) =>
      db.records.insert('app_expenses', 'expenses', values as Record<string, string | number | boolean | null>);

    const ok = await insert({ title: 'Tea', amount: 2.5, category: 'Food', spent_on: '2026-02-28', paid: true });
    expect(ok.values).toEqual({ title: 'Tea', amount: 2.5, category: 'Food', spent_on: '2026-02-28', paid: true });

    const rejects = async (values: Record<string, unknown>, field: string) => {
      const error = await insert(values).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(RecordValidationError);
      expect((error as RecordValidationError).issues.map((i) => i.field)).toContain(field);
    };
    await rejects({ amount: 1 }, 'title'); // required
    await rejects({ title: '', amount: 1 }, 'title'); // required, empty
    await rejects({ title: 'x', amount: '5' }, 'amount'); // type
    await rejects({ title: 'x', amount: Number.NaN }, 'amount');
    await rejects({ title: 'x', amount: -1 }, 'amount'); // min
    await rejects({ title: 'x', amount: 100001 }, 'amount'); // max
    await rejects({ title: 'x', amount: 1, category: 'Rent' }, 'category'); // enum
    await rejects({ title: 'x', amount: 1, spent_on: '2026-02-30' }, 'spent_on'); // impossible date
    await rejects({ title: 'x', amount: 1, paid: 'yes' }, 'paid');
    await rejects({ title: 'x'.repeat(41), amount: 1 }, 'title'); // maxLength
    await rejects({ title: 'x', amount: 1, constructor: 'boom' }, 'constructor'); // unknown / prototype names
    await expect(db.records.insert('app_expenses', 'nope', { title: 'x' })).rejects.toThrow(/does not exist/);
    await expect(db.records.insert('app_missing', 'expenses', { title: 'x' })).rejects.toThrow(/not found/);
    expect(await db.records.list('app_expenses', 'expenses')).toHaveLength(1);
  });

  it('updates merge and re-validate; remove deletes', async () => {
    const db = fresh();
    await db.apps.save(stored(expenseSpec()), create);
    const rec = await db.records.insert('app_expenses', 'expenses', { title: 'Tea', amount: 2 });
    const updated = await db.records.update('app_expenses', 'expenses', rec.id, { amount: 3, paid: true });
    expect(updated.values).toEqual({ title: 'Tea', amount: 3, paid: true });
    await expect(db.records.update('app_expenses', 'expenses', rec.id, { amount: -5 })).rejects.toBeInstanceOf(RecordValidationError);
    await db.records.remove('app_expenses', 'expenses', rec.id);
    expect(await db.records.list('app_expenses', 'expenses')).toEqual([]);
  });

  it('isolates apps: one app cannot read, update or delete another app’s records', async () => {
    const db = fresh();
    await db.apps.save(stored(expenseSpec()), create);
    await db.apps.save(stored(expenseSpec('app_other', 'Other')), create);
    const mine = await db.records.insert('app_expenses', 'expenses', { title: 'Tea', amount: 2 });

    expect(await db.records.list('app_other', 'expenses')).toEqual([]);
    expect((await db.records.listAll('app_other')).expenses).toEqual([]);
    await expect(db.records.update('app_other', 'expenses', mine.id, { amount: 99 })).rejects.toThrow(/not found/);
    await expect(db.records.remove('app_other', 'expenses', mine.id)).rejects.toThrow(/not found/);
    expect(await db.records.list('app_expenses', 'expenses')).toEqual([mine]);
  });

  it('notifies subscribers of the changed app only, until unsubscribed', async () => {
    const db = fresh();
    await db.apps.save(stored(expenseSpec()), create);
    await db.apps.save(stored(expenseSpec('app_other', 'Other')), create);
    const listener = vi.fn();
    const other = vi.fn();
    const stop = db.records.subscribe('app_expenses', listener);
    db.records.subscribe('app_other', other);
    await db.records.insert('app_expenses', 'expenses', { title: 'Tea', amount: 2 });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
    stop();
    await db.records.insert('app_expenses', 'expenses', { title: 'Tea', amount: 2 });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('state', () => {
  it('stores per-app key/values and rejects bad keys, values and unknown apps', async () => {
    const db = fresh();
    await db.apps.save(stored(expenseSpec()), create);
    const listener = vi.fn();
    db.state.subscribe('app_expenses', listener);
    await db.state.set('app_expenses', 'cups', 3);
    await db.state.set('app_expenses', 'cups', 4);
    expect(await db.state.all('app_expenses')).toEqual({ cups: 4 });
    expect(listener).toHaveBeenCalledTimes(2);
    await expect(db.state.set('app_expenses', '__proto__', 1)).rejects.toThrow();
    await expect(db.state.set('app_expenses', 'cups', Number.POSITIVE_INFINITY)).rejects.toThrow();
    await expect(db.state.set('app_missing', 'cups', 1)).rejects.toThrow(/not found/);
  });
});

describe('events', () => {
  it(`keeps only the newest ${EVENT_CAP} events, newest first`, async () => {
    const db = fresh();
    const event = (i: number): InferenceEvent => ({
      id: `e${i}`, at: i, taskId: `t${i}`, taskType: 'classify', route: 'deterministic', provider: 'deterministic',
      source: 'deterministic', latencyMs: 1, success: true, fallbackUsed: false,
    });
    for (let i = 1; i <= EVENT_CAP + 10; i++) await db.events.add(event(i));
    const all = await db.events.list();
    expect(all).toHaveLength(EVENT_CAP);
    expect(all[0].id).toBe(`e${EVENT_CAP + 10}`);
    expect(all.at(-1)?.id).toBe('e11');
    expect(await db.events.list(3)).toHaveLength(3);
    await db.events.clear();
    expect(await db.events.list()).toEqual([]);
  }, 60_000); // 510 sequential IndexedDB transactions are slow on fake-indexeddb
});

describe('settings', () => {
  it('returns defaults, merges partial updates and fills keys missing from older stored rows', async () => {
    const name = freshName();
    const db = createWebDatabase(name);
    expect(await db.settings.get()).toEqual(DEFAULT_SETTINGS);

    const updated = await db.settings.update({ onboarded: true, accessModes: { ...DEFAULT_SETTINGS.accessModes, large: true } });
    expect(updated).toEqual({ ...DEFAULT_SETTINGS, onboarded: true, accessModes: { ...DEFAULT_SETTINGS.accessModes, large: true } });
    expect(await db.settings.get()).toEqual(updated);

    // Simulate a row written by an older build that lacks newer keys.
    const raw = new Dexie(name);
    await raw.open();
    await raw.table('settings').put({ id: 'me', settings: { aiMode: 'offline_only', accessModes: { simple: true } } });
    raw.close();
    const merged = await db.settings.get();
    expect(merged.aiMode).toBe('offline_only');
    expect(merged.accessModes).toEqual({ ...DEFAULT_SETTINGS.accessModes, simple: true });
    expect(merged.language).toBe('en');
    expect(merged.onDeviceActionCount).toBe(0);
  });
});

describe('drawings', () => {
  it('saves, lists newest first and removes drawings', async () => {
    const db = fresh();
    const doc = (id: string, updatedAt: number) => ({ id, title: id, createdAt: 1, updatedAt, pages: [] });
    await db.drawings.save(doc('a', 1));
    await db.drawings.save(doc('b', 2));
    expect((await db.drawings.list()).map((d) => d.id)).toEqual(['b', 'a']);
    expect(await db.drawings.get('a')).toEqual(doc('a', 1));
    await db.drawings.remove('a');
    expect(await db.drawings.get('a')).toBeUndefined();
  });
});

describe('backup', () => {
  it('round-trips apps, records and state into a fresh database', async () => {
    const source = fresh();
    await source.apps.save(stored(expenseSpec()), create);
    await source.records.insert('app_expenses', 'expenses', { title: 'Tea', amount: 2, category: 'Food' });
    await source.state.set('app_expenses', 'cups', 5);
    const backup = JSON.parse(JSON.stringify(await source.exportAll())) as unknown;

    const target = fresh();
    const summary = await target.importAll(backup);
    expect(summary).toEqual({ apps: 1, records: 1, skippedApps: 0, skippedRecords: 0, skippedState: 0 });
    expect((await target.apps.get('app_expenses'))?.spec.name).toBe('Expenses');
    expect(await target.records.list('app_expenses', 'expenses')).toEqual(await source.records.list('app_expenses', 'expenses'));
    expect(await target.state.all('app_expenses')).toEqual({ cups: 5 });
    expect((await target.versions.list('app_expenses'))[0].source).toBe('import');

    // Importing again is idempotent for records (upsert by id) and adds no design version.
    await target.importAll(backup);
    expect(await target.records.list('app_expenses', 'expenses')).toHaveLength(1);
    expect(await target.versions.list('app_expenses')).toHaveLength(1);
  });

  it('skips invalid or malicious specs and records, and rejects broken files without writing', async () => {
    const db = fresh();
    await db.apps.save(stored(expenseSpec('app_local', 'Local')), create);
    const local = await db.records.insert('app_local', 'expenses', { title: 'Mine', amount: 1 });

    const injected = { ...expenseSpec('app_evil', 'Evil'), onLoad: 'fetch("https://evil.example")' };
    const scripted = { ...expenseSpec('app_script', 'Script'), description: '<script>alert(1)</script>' };
    const badAction = { ...expenseSpec('app_exec', 'Exec'), actions: { add_expense: { type: 'exec', code: 'rm -rf /' } } };
    const backup = {
      format: 'kalam-backup',
      formatVersion: 1,
      exportedAt: 1,
      apps: [stored(expenseSpec('app_good', 'Good')), { ...stored(expenseSpec()), spec: injected }, { spec: scripted }, { spec: badAction }, 'junk'],
      records: [
        { id: 'r1', appId: 'app_good', collectionId: 'expenses', values: { title: 'Ok', amount: 1 } },
        { id: 'r2', appId: 'app_good', collectionId: 'expenses', values: { title: 'Bad', amount: 'lots' } },
        { id: 'r3', appId: 'app_good', collectionId: 'expenses', values: JSON.parse('{"title":"x","amount":1,"__proto__":{"admin":true}}') },
        { id: 'r4', appId: 'app_evil', collectionId: 'expenses', values: { title: 'x', amount: 1 } },
        { id: 'r5', appId: 'app_good', collectionId: 'secrets', values: {} },
        // Same id as a record of another app: must not overwrite it.
        { id: local.id, appId: 'app_good', collectionId: 'expenses', values: { title: 'Hijack', amount: 1 } },
      ],
      state: [{ appId: 'app_good', key: 'cups', value: 1 }, { appId: 'app_local', key: 'cups', value: 9 }],
    };

    const summary = await db.importAll(backup);
    expect(summary).toEqual({ apps: 1, records: 2, skippedApps: 4, skippedRecords: 4, skippedState: 1 });
    expect((await db.apps.list()).map((a) => a.id).sort()).toEqual(['app_good', 'app_local']);
    expect(await db.records.list('app_local', 'expenses')).toEqual([local]);
    const good = await db.records.list('app_good', 'expenses');
    expect(good.map((r) => r.values.title).sort()).toEqual(['Hijack', 'Ok']);
    expect(good.find((r) => r.values.title === 'Hijack')?.id).not.toBe(local.id);
    expect(await db.state.all('app_local')).toEqual({});
    expect(({} as Record<string, unknown>).admin).toBeUndefined();

    await expect(db.importAll({ format: 'something-else', apps: [] })).rejects.toThrow(/not a valid Kalam backup/);
    await expect(db.importAll(null)).rejects.toThrow(/not a valid Kalam backup/);
    expect((await db.apps.list()).map((a) => a.id).sort()).toEqual(['app_good', 'app_local']);
  });
});
