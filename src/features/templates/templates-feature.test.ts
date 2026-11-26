import { describe, expect, it } from 'vitest';
import type { KalamRecord, RecordValue, StoredApp } from '@/core/contracts';
import { CLONE_COPY } from '@/core/clone';
import { CATALOG, getCatalogEntry, instantiateCatalogEntry } from '@/core/templates/catalog';
import { createWebDatabase } from '@/infrastructure/storage/database.web';
import { EMPTY_STAT } from '@/runtime/engine/data';
import { cloneApp, installTemplate, type TemplateDb } from './actions';
import { emptyListAdd } from './empty-list-add';
import { PREVIEW_ROWS, buildPreview } from './model';

const NOW = new Date(2026, 10, 18, 10, 30);
let n = 0;
const ids = { newId: () => `app_feat${++n}`, now: NOW.getTime() };

describe('the preview of every template', () => {
  for (const entry of CATALOG) {
    it(`${entry.id}: shows every total as a real value and every list from the made-up entries`, () => {
      const p = buildPreview(entry, NOW);
      expect(p.entryId).toBe(entry.id);
      expect(p.screens.length).toBeGreaterThan(0);
      expect(p.screens[0]!.blocks.length).toBeGreaterThan(0);
      for (const s of p.screens) {
        for (const b of s.blocks) {
          if (b.kind === 'stat') expect(b.value, `${s.id}.${b.id}`).not.toBe(EMPTY_STAT);
          if (b.kind === 'list') {
            expect(b.rows.length).toBeLessThanOrEqual(PREVIEW_ROWS);
            for (const r of b.rows) expect(r.primary, `${s.id}.${b.id}`).not.toMatch(/^sample_|^local:/); // a link reads as a name, never an id
          }
        }
      }
    });
  }

  it('is the same on the same day', () => {
    const e = getCatalogEntry('kirana_credit_book')!;
    expect(buildPreview(e, NOW)).toEqual(buildPreview(e, NOW));
  });

  it('Kirana Credit Book: formatted totals, linked names in the lists, and a customer’s own page', () => {
    const p = buildPreview(getCatalogEntry('kirana_credit_book')!, NOW);
    const home = p.screens[0]!;
    const stat = (id: string) => (home.blocks.find((b) => b.kind === 'stat' && b.id === id) as { value: string } | undefined)?.value;
    expect(stat('still_to_collect')).toMatch(/3,110/);
    const recent = home.blocks.find((b) => b.kind === 'list' && b.id === 'entries_list');
    expect(recent && recent.kind === 'list' && recent.rows.map((r) => r.primary)).toEqual(
      expect.arrayContaining(['Ramesh Kumar', 'Sunita Devi', 'Anil Traders']),
    );
    const page = p.screens.find((s) => s.id === 'customers_detail')!;
    const owes = page.blocks.find((b) => b.kind === 'stat' && b.id === 'customer_owes');
    expect(owes && owes.kind === 'stat' && owes.value).toMatch(/710/);
    const own = page.blocks.find((b) => b.kind === 'list');
    expect(own && own.kind === 'list' && own.rows.length).toBe(3); // Ramesh's three entries, not everyone's
  });

  it('shows a counter and a calculator on their own made-up values', () => {
    const mala = buildPreview(getCatalogEntry('mala_counter')!, NOW).screens[0]!.blocks;
    expect(mala.some((b) => b.kind === 'other' && b.label === 'Mala count: 27')).toBe(true);
    expect(mala.some((b) => b.kind === 'stat' && b.label.startsWith('Left to reach') && b.value === '81')).toBe(true);
    const gst = buildPreview(getCatalogEntry('gst_calculator')!, NOW).screens[0]!.blocks;
    expect(gst.some((b) => b.kind === 'stat' && /2,832/.test(b.value))).toBe(true);
  });

  it('shows a tick state for lists that tick', () => {
    const p = buildPreview(getCatalogEntry('grocery_list')!, NOW);
    const list = p.screens[0]!.blocks.find((b) => b.kind === 'list');
    expect(list && list.kind === 'list' && list.rows.some((r) => r.checked === true)).toBe(true);
    expect(list && list.kind === 'list' && list.rows.some((r) => r.checked === false)).toBe(true);
  });

  it('says how many more rows there are than it shows', () => {
    const p = buildPreview(getCatalogEntry('daily_sales')!, NOW);
    const list = p.screens[0]!.blocks.find((b) => b.kind === 'list');
    expect(list && list.kind === 'list' && list.rows.length).toBe(PREVIEW_ROWS);
    expect(list && list.kind === 'list' && list.more).toBe(9 - PREVIEW_ROWS);
  });
});

// ─── Storage actions against memory ──────────────────────────────────────────
function memoryDb(): TemplateDb & { apps: Map<string, StoredApp>; rows: KalamRecord[]; kv: Array<[string, string, RecordValue]>; failSave?: boolean } {
  const apps = new Map<string, StoredApp>();
  const rows: KalamRecord[] = [];
  const kv: Array<[string, string, RecordValue]> = [];
  let c = 0;
  const self = {
    apps,
    rows,
    kv,
    failSave: false,
  };
  return Object.assign(self, {
    apps: Object.assign(apps, {
      async save(app: StoredApp) { if (self.failSave) throw new Error('disk full'); apps.set(app.id, app); return app; },
      async remove(id: string) { apps.delete(id); },
    }),
    records: {
      async listAll(appId: string) {
        const out: Record<string, KalamRecord[]> = {};
        for (const r of rows.filter((x) => x.appId === appId)) (out[r.collectionId] ??= []).push(r);
        return out;
      },
      async insert(appId: string, collectionId: string, values: Record<string, RecordValue>) {
        const r: KalamRecord = { id: `r${++c}`, appId, collectionId, createdAt: c, updatedAt: c, values };
        rows.push(r);
        return r;
      },
      async update(appId: string, collectionId: string, id: string, values: Record<string, RecordValue>) {
        const r = rows.find((x) => x.id === id)!;
        r.values = { ...r.values, ...values };
        return r;
      },
    },
    state: {
      async all(appId: string) { return Object.fromEntries(kv.filter(([a]) => a === appId).map(([, k, v]) => [k, v])); },
      async set(appId: string, key: string, value: RecordValue) { kv.push([appId, key, value]); },
    },
  }) as never;
}

describe('installTemplate', () => {
  it('saves an independent app made from the template and says where it came from', async () => {
    const db = memoryDb();
    const r = await installTemplate(db, 'attendance_register', { name: 'Class 6A' }, ids);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(db.apps.get(r.app.id)?.spec.name).toBe('Class 6A');
    expect(r.app.origin).toMatchObject({ route: 'template', templateId: 'attendance_register' });
    expect(db.rows).toEqual([]); // no example entries are installed
  });

  it('refuses an unknown template or a bad name and saves nothing', async () => {
    const db = memoryDb();
    expect((await installTemplate(db, 'nope', {}, ids)).ok).toBe(false);
    expect((await installTemplate(db, 'notes', { name: ' ' }, ids)).ok).toBe(false);
    expect(db.apps.size).toBe(0);
  });

  it('reports a failed save in plain words', async () => {
    const db = memoryDb();
    db.failSave = true;
    const r = await installTemplate(db, 'notes', {}, ids);
    expect(r).toEqual({ ok: false, error: 'The template could not be added. Nothing was saved.' });
  });
});

describe('cloneApp', () => {
  const sourceOf = (): StoredApp => {
    const r = instantiateCatalogEntry('kirana_credit_book', { appId: 'app_source', now: 1, lang: 'en' });
    if (!r.ok) throw new Error(r.error);
    return { id: 'app_source', spec: r.value.spec, createdAt: 1, updatedAt: 1, origin: { ...r.value.origin } };
  };

  async function seeded() {
    const db = memoryDb();
    const a = await db.records.insert('app_source', 'customers', { name: 'Ramesh' });
    await db.records.insert('app_source', 'entries', { customer: a.id, kind: 'Credit given', amount: 5, date: '2026-11-01' });
    await db.state.set('app_source', 'count', 4);
    return db;
  }

  it('copies the design only by default', async () => {
    const db = await seeded();
    const before = db.rows.length;
    const r = await cloneApp(db, sourceOf(), { name: 'Branch', mode: 'design' }, ids);
    expect(r.ok).toBe(true);
    expect(db.rows).toHaveLength(before);
  });

  it('does not copy entries without the confirmation, and copies them with it', async () => {
    const db = await seeded();
    const no = await cloneApp(db, sourceOf(), { name: 'Branch', mode: 'with_records' }, ids);
    expect(no).toEqual({ ok: false, error: 'Copying entries needs your confirmation first.' });
    expect(db.rows).toHaveLength(2);
    const yes = await cloneApp(db, sourceOf(), { name: 'Branch', mode: 'with_records', confirmedRecords: true }, ids);
    expect(yes.ok).toBe(true);
    if (!yes.ok) return;
    const copied = db.rows.filter((r) => r.appId === yes.app.id);
    expect(copied.map((r) => r.collectionId)).toEqual(['customers', 'entries']);
    expect(copied[1]!.values.customer).toBe(copied[0]!.id);
    expect(db.rows.filter((r) => r.appId === 'app_source')).toHaveLength(2); // the original is untouched
  });

  it('on the real database a required picture does not stop the copy, and the result says what stayed behind', async () => {
    const real = createWebDatabase(`kalam-feature-${Date.now()}`);
    const source = sourceOf();
    source.spec.collections.customers!.fields.photo = { type: 'image', label: 'Photo' };
    await real.apps.save(source, { summary: 'Created', source: 'create' });
    await real.records.insert('app_source', 'customers', { name: 'Ramesh', photo: 'local:abc1' });
    source.spec.collections.customers!.fields.photo = { type: 'image', label: 'Photo', required: true };
    const strict = await real.apps.save(source, { summary: 'Photo is required', source: 'edit' });
    const r = await cloneApp(real, strict, { name: 'Branch', mode: 'with_records', confirmedRecords: true }, ids);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.outcome).toMatchObject({ entriesCopied: 1, skippedEntries: 0, skippedPictures: 1 });
    expect((await real.records.listAll(r.app.id)).customers).toHaveLength(1);
    expect(r.app.spec.collections.customers!.fields.photo).toMatchObject({ required: true });
  });

  it('when the copy fails and cannot be cleaned up, it says the copy is still on the shelf', async () => {
    const db = await seeded();
    db.records.insert = async () => { throw new Error('disk full'); };
    (db.apps as unknown as { remove: () => Promise<void> }).remove = async () => { throw new Error('storage gone'); };
    const r = await cloneApp(db, sourceOf(), { name: 'Branch', mode: 'with_records', confirmedRecords: true }, ids);
    expect(r).toEqual({ ok: false, error: CLONE_COPY.errors.leftover });
  });

  it('a plain failure says the copy was not saved and the original is unchanged', async () => {
    const db = await seeded();
    db.records.insert = async () => { throw new Error('disk full'); };
    const r = await cloneApp(db, sourceOf(), { name: 'Branch', mode: 'with_records', confirmedRecords: true }, ids);
    expect(r).toEqual({ ok: false, error: CLONE_COPY.errors.save });
  });
});

describe('emptyListAdd', () => {
  const spec = (id: string) => getCatalogEntry(id)!.build({ appId: 'app_empty', now: 1, lang: 'en' });

  it('reuses the app’s own add button for the list on the same screen', () => {
    expect(emptyListAdd(spec('expense_tracker'), 'home', 'expenses')).toEqual({ action: 'go_add', label: 'Add expense' });
    expect(emptyListAdd(spec('daily_sales'), 'home', 'sales')).toEqual({ action: 'go_add_sales', label: 'Add sale' });
  });

  it('finds the right button when an app has several lists', () => {
    const s = spec('kirana_credit_book');
    expect(emptyListAdd(s, 'home', 'customers')).toEqual({ action: 'go_add_customers', label: 'Add customer' });
    expect(emptyListAdd(s, 'home', 'entries')).toEqual({ action: 'go_add_entries', label: 'New entry' });
  });

  it('offers nothing when the screen has no such button, or the list is unknown', () => {
    expect(emptyListAdd(spec('notes'), 'missing_screen', 'notes')).toBeUndefined();
    expect(emptyListAdd(spec('notes'), 'home', 'ghosts')).toBeUndefined();
    expect(emptyListAdd(spec('mala_counter'), 'counter', 'anything')).toBeUndefined();
  });

  it('every list that can be added to has an add button on the screen that shows it', () => {
    for (const e of CATALOG) {
      const s = e.build({ appId: 'app_empty', now: 1, lang: 'en' });
      for (const screen of s.screens) {
        for (const c of screen.children) {
          if (c.type !== 'list' || screen.form) continue; // lists on a home page
          const saves = s.screens.some((x) => x.form === c.source && x.children.some((b) => b.type === 'bigButton' && s.actions[b.action]?.type === 'insert'));
          if (saves) expect(emptyListAdd(s, screen.id, c.source), `${e.id}.${c.id}`).toBeDefined();
        }
      }
    }
  });
});
