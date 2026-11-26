import { describe, expect, it } from 'vitest';
import type { StoredApp } from '../../contracts';
import {
  ARCHIVE_CHANGE, TEMPLATE_CATEGORY, archivedCount, categoryOfTemplate, effectiveCategory, filterShelf, instantiateCatalogEntry,
  shelfCategories, shelfCategoryOf, withArchived,
} from './index';

let n = 0;
function fromTemplate(id: string): StoredApp {
  const r = instantiateCatalogEntry(id, { appId: `app_shelf${++n}`, now: 1, lang: 'en' });
  if (!r.ok) throw new Error(r.error);
  return { id: r.value.spec.id, spec: r.value.spec, createdAt: 1, updatedAt: 1, origin: { ...r.value.origin } };
}

/** An app that was written by the compiler: no template id anywhere. */
function written(name: string, description = '', tags: string[] = []): StoredApp {
  const base = fromTemplate('notes');
  const { templateId: _t, ...meta } = base.spec.meta;
  return {
    ...base, id: `app_written${++n}`,
    spec: {
      ...base.spec, name, description, meta: { ...meta, source: 'compiler', tags },
      collections: Object.fromEntries(Object.entries(base.spec.collections).map(([k, c]) => [k, { ...c, label: 'Entries' }])),
    },
    origin: { route: 'cloud' },
  };
}

describe('shelfCategoryOf', () => {
  it('uses the gallery category of an app made from a template', () => {
    expect(shelfCategoryOf(fromTemplate('kirana_credit_book'))).toBe('shop');
    expect(shelfCategoryOf(fromTemplate('attendance_register'))).toBe('school');
    expect(shelfCategoryOf(fromTemplate('medicine_tracker'))).toBe('health');
    expect(shelfCategoryOf(fromTemplate('household_budget'))).toBe('home');
    expect(shelfCategoryOf(fromTemplate('notes'))).toBe('personal');
  });

  it('keeps the template category after the person renames the app', () => {
    const a = fromTemplate('attendance_register');
    expect(shelfCategoryOf({ ...a, spec: { ...a.spec, name: 'My thing' } })).toBe('school');
  });

  it('works out the category of other apps from their own words', () => {
    expect(shelfCategoryOf(written('Rent and tenants tracker', 'Who has paid the rent this month', ['rent']))).toBe('home');
    expect(shelfCategoryOf(written('Class 8 marks', 'Exam marks for each student'))).toBe('school');
    expect(shelfCategoryOf(written('Gym log', '', ['workout']))).toBe('other');
  });
});

describe('shelfCategories', () => {
  const apps = [fromTemplate('kirana_credit_book'), fromTemplate('daily_sales'), fromTemplate('attendance_register'), written('Gym log')];
  it('counts apps per category, All first and Other last, and leaves out categories with no apps', () => {
    expect(shelfCategories(apps)).toEqual([
      { id: 'all', label: 'All', count: 4 },
      { id: 'shop', label: 'Shop', count: 2 },
      { id: 'school', label: 'School', count: 1 },
      { id: 'other', label: 'Other', count: 1 },
    ]);
  });
  it('does not count archived apps', () => {
    const rows = shelfCategories([...apps, withArchived(fromTemplate('notes'), true)]);
    expect(rows[0]).toEqual({ id: 'all', label: 'All', count: 4 });
    expect(rows.some((r) => r.id === 'personal')).toBe(false);
  });
});

describe('filterShelf and the archive', () => {
  const a = fromTemplate('kirana_credit_book');
  const b = fromTemplate('attendance_register');
  const c = withArchived(fromTemplate('daily_sales'), true);
  const apps = [a, b, c];

  it('the main shelf hides archived apps, and the archive shows only them', () => {
    expect(filterShelf(apps).map((x) => x.id)).toEqual([a.id, b.id]);
    expect(filterShelf(apps, { archived: true }).map((x) => x.id)).toEqual([c.id]);
    expect(archivedCount(apps)).toBe(1);
  });
  it('narrows to a category and keeps the order', () => {
    expect(filterShelf(apps, { category: 'school' }).map((x) => x.id)).toEqual([b.id]);
    expect(filterShelf(apps, { category: 'all' })).toHaveLength(2);
  });
  it('a category that no app has any more counts as All, so the shelf is never empty behind a hidden chip', () => {
    // The person chose School, then the last school app went. The bar may be gone; the filter must not stay on.
    expect(filterShelf([a], { category: 'school' }).map((x) => x.id)).toEqual([a.id]);
    expect(filterShelf(apps, { category: 'health' })).toHaveLength(2);
    expect(effectiveCategory([a], 'school')).toBe('all');
    expect(effectiveCategory(apps, 'school')).toBe('school');
    // An archived app does not keep a category alive: the chips count only the main shelf.
    expect(effectiveCategory([withArchived(b, true), a], 'school')).toBe('all');
  });
  it('the archive shows every archived app whatever category was chosen on the shelf', () => {
    expect(filterShelf(apps, { category: 'school', archived: true }).map((x) => x.id)).toEqual([c.id]);
    expect(filterShelf(apps, { category: 'shop', archived: true }).map((x) => x.id)).toEqual([c.id]);
  });
  it('archiving changes only the flag, and putting back removes it', () => {
    const archived = withArchived(a, true);
    expect(archived.archived).toBe(true);
    expect({ ...archived, archived: undefined }).toEqual({ ...a, archived: undefined });
    expect(a.archived).toBeUndefined(); // the input is not changed
    const back = withArchived(archived, false);
    expect('archived' in back).toBe(false);
    expect(back).toEqual(a);
  });
  it('the change argument for save is a constant: archiving writes no version, so it is never stored', () => {
    expect(ARCHIVE_CHANGE.source).toBe('edit');
    expect(ARCHIVE_CHANGE.summary.length).toBeGreaterThan(0);
  });
});

describe('the template to category map', () => {
  it('matches the gallery exactly, so the shelf can sort apps without loading it', async () => {
    const { CATALOG } = await import('./gallery');
    expect(Object.keys(TEMPLATE_CATEGORY).sort()).toEqual(CATALOG.map((e) => e.id).sort());
    for (const e of CATALOG) expect(TEMPLATE_CATEGORY[e.id]).toBe(e.category);
  });
  it('knows nothing about an id it does not have, including names every object has', () => {
    expect(categoryOfTemplate('constructor')).toBeUndefined();
    expect(categoryOfTemplate('__proto__')).toBeUndefined();
    expect(categoryOfTemplate('gst_calculator')).toBe('shop');
  });
});
