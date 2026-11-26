import { describe, expect, it } from 'vitest';
import { evaluateFormula, localDate } from '../../formula';
import type { KalamSpec } from '../../spec/schema';
import {
  type CatalogCategory, CATALOG_CATEGORIES, CATEGORY_LABELS, galleryCategories, getCatalogEntry, listCatalog, resolveSample, sampleProblems, searchCatalog,
} from './index';

const NOW = new Date(2026, 10, 18, 10, 30);
const OPTS = { appId: 'app_gallery-2', now: NOW.getTime(), lang: 'en' };

/** Value of one total on the made-up entries. `open` is the sample key of the entry opened first (for `selected`). */
function total(id: string, statId: string, open?: string, now: Date = NOW): unknown {
  const entry = getCatalogEntry(id);
  if (!entry) throw new Error(`no ${id}`);
  const spec: KalamSpec = entry.build(OPTS);
  const sample = resolveSample(entry, spec, now);
  const collections = Object.fromEntries(Object.keys(spec.collections).map((c) => [c, (sample.records[c] ?? []).map((r) => r.values)]));
  const stat = spec.screens.flatMap((s) => s.children).find((c) => c.id === statId);
  if (stat?.type !== 'stat') throw new Error(`no total ${statId}`);
  const r = evaluateFormula(stat.expr, { collections, form: sample.form, state: sample.state, now, selected: open ? `sample_${Object.keys(spec.collections)[0]}_${open}` : null });
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

describe('the made-up entries give known totals', () => {
  it('Kirana Credit Book: totals and one customer’s balance', () => {
    expect(total('kirana_credit_book', 'credit_given')).toBe(850 + 420 + 2400 + 160);
    expect(total('kirana_credit_book', 'payments_received')).toBe(300 + 420);
    expect(total('kirana_credit_book', 'still_to_collect')).toBe(3830 - 720);
    expect(total('kirana_credit_book', 'customer_owes', 'ramesh')).toBe(850 + 160 - 300);
    expect(total('kirana_credit_book', 'customer_owes', 'sunita')).toBe(0);
  });

  it('Attendance Register: today, overall and one student', () => {
    expect(total('attendance_register', 'present_today')).toBe(2);
    expect(total('attendance_register', 'absent_today')).toBe(1);
    expect(total('attendance_register', 'marked_today')).toBe(3);
    expect(total('attendance_register', 'overall_rate')).toBeCloseTo(8 / 11, 5); // 7 present and 1 late, of 11 marks
    expect(total('attendance_register', 'student_present', 'aarav')).toBe(3);
    expect(total('attendance_register', 'student_rate', 'diya')).toBeCloseTo(2 / 3, 5);
  });

  it('GST Calculator: 18 percent of 2,400', () => {
    expect(total('gst_calculator', 'gst_amount')).toBe(432);
    expect(total('gst_calculator', 'total_amount')).toBe(2832);
  });

  it('Mala Counter: what is left to 108', () => {
    expect(total('mala_counter', 'left_to_target')).toBe(81);
  });

  it('Student Progress: class average and one student’s average', () => {
    expect(total('student_progress', 'class_average')).toBeCloseTo((42 + 35 + 46 + 44 + 18 + 29) / 300, 5);
    expect(total('student_progress', 'student_average', 'aarav')).toBeCloseTo(77 / 100, 5);
    expect(total('student_progress', 'low_scores')).toBe(1);
  });

  it('Tailor Order Book: open orders, ready orders and the balance to collect', () => {
    expect(total('tailor_order_book', 'open_orders')).toBe(3);
    expect(total('tailor_order_book', 'ready_orders')).toBe(1);
    expect(total('tailor_order_book', 'balance_to_collect')).toBe(600 + 4500 + 900 - (200 + 1500 + 900));
  });

  it('Medicine Tracker: today’s doses and a medicine’s streak', () => {
    expect(total('medicine_tracker', 'taken_today')).toBe(1);
    expect(total('medicine_tracker', 'missed_today')).toBe(0);
    expect(total('medicine_tracker', 'active_medicines')).toBe(2);
    expect(total('medicine_tracker', 'medicine_streak', 'vitd')).toBe(3);
  });

  it('Household Budget: this month adds up on any day of the month', () => {
    for (const day of [1, 2, 9, 18, 28]) {
      const now = new Date(2026, 10, day, 12);
      expect(total('household_budget', 'income_month', undefined, now)).toBe(42000);
      const spent = total('household_budget', 'spent_month', undefined, now);
      expect(typeof spent === 'number' && spent > 0, `day ${day}`).toBe(true);
    }
  });
});

describe('dates in the made-up entries move with the day, nothing else does', () => {
  it('shifts every date by the same number of days and keeps everything else', () => {
    const entry = getCatalogEntry('delivery_tracker')!;
    const spec = entry.build(OPTS);
    const a = resolveSample(entry, spec, new Date(2026, 10, 18, 9));
    const b = resolveSample(entry, spec, new Date(2026, 10, 20, 21));
    const dueA = a.records.deliveries!.map((r) => r.values.due);
    const dueB = b.records.deliveries!.map((r) => r.values.due);
    expect(dueA).toContain(localDate(new Date(2026, 10, 18)));
    expect(dueB).toContain(localDate(new Date(2026, 10, 20)));
    expect(a.records.deliveries!.map((r) => r.values.what)).toEqual(b.records.deliveries!.map((r) => r.values.what));
    expect(a.records.deliveries!.map((r) => r.id)).toEqual(b.records.deliveries!.map((r) => r.id));
  });

  it('links are written by name and resolve to the linked entry’s id', () => {
    const entry = getCatalogEntry('kirana_credit_book')!;
    const spec = entry.build(OPTS);
    const s = resolveSample(entry, spec, NOW);
    const ids = new Set(s.records.customers!.map((r) => r.id));
    expect(s.records.entries!.every((r) => ids.has(String(r.values.customer)))).toBe(true);
  });

  it('reports a link to nowhere and a value of the wrong kind', () => {
    const entry = getCatalogEntry('kirana_credit_book')!;
    const spec = entry.build(OPTS);
    const broken = {
      id: 'x',
      sample: { records: { entries: [{ values: { customer: '>nobody', kind: 'Gift', amount: 'ten', date: '~0' } }], ghosts: [{ values: {} }] } },
    };
    const problems = sampleProblems(broken, spec, NOW);
    expect(problems.join('\n')).toMatch(/customer.*does not resolve/);
    expect(problems.join('\n')).toMatch(/kind.*not one of the options/);
    expect(problems.join('\n')).toMatch(/amount.*should be a number/);
    expect(problems.join('\n')).toMatch(/ghosts: the app has no such list/);
  });
});

describe('galleryCategories', () => {
  it('lists All first, then each category that has templates, with real counts', () => {
    const cats = galleryCategories();
    expect(cats[0]).toEqual({ id: 'all', label: 'All', count: listCatalog().length });
    const ids = cats.slice(1).map((c) => c.id);
    expect(ids).toEqual(CATALOG_CATEGORIES.filter((c) => listCatalog().some((e) => e.category === c)));
    for (const c of cats.slice(1)) {
      expect(c.count).toBe(listCatalog().filter((e) => e.category === c.id).length);
      expect(c.label).toBe(CATEGORY_LABELS[c.id as keyof typeof CATEGORY_LABELS]);
    }
  });

  it('every one of the six categories of docs/14 §12.2 has at least one template', () => {
    for (const c of CATALOG_CATEGORIES) expect(listCatalog().some((e) => e.category === c), c).toBe(true);
  });
});

describe('searchCatalog', () => {
  const top = (q: string, category?: CatalogCategory) => searchCatalog(q, { category }).map((e) => e.id);

  it('returns everything for an empty search, showcase apps first', () => {
    const all = searchCatalog('');
    expect(all).toHaveLength(listCatalog().length);
    expect(all.slice(0, 5).map((e) => e.id)).toEqual(['tailor_book', 'medicine_tracker', 'gst_calculator', 'kirana_credit_book', 'notes']);
    expect(searchCatalog('   ')).toHaveLength(all.length);
  });

  it.each([
    ['credit book', 'kirana_credit_book'],
    ['udhaar', 'kirana_credit_book'],
    ['उधार', 'kirana_credit_book'],
    ['gst', 'gst_calculator'],
    ['tailor orders', 'tailor_order_book'],
    ['darzi', 'tailor_book'],
    ['attendance', 'attendance_register'],
    ['hazri', 'attendance_register'],
    ['medicine', 'medicine_tracker'],
    ['dawai', 'medicine_tracker'],
    ['fees', 'fee_tracker'],
    ['homework', 'homework_tracker'],
    ['household budget', 'household_budget'],
    ['stock', 'inventory_manager'],
    ['grocery', 'grocery_list'],
    ['supplier', 'supplier_list'],
    ['appointments', 'appointment_tracker'],
  ])('"%s" finds %s first', (query, id) => {
    expect(top(query)[0]).toBe(id);
  });

  it('needs every word to match, and matches the start of a word', () => {
    expect(top('kirana zebra')).toEqual([]);
    expect(top('attend')[0]).toBe('attendance_register');
    expect(top('the app for my shop credit')[0]).toBe('kirana_credit_book');
  });

  it('narrows to a category', () => {
    const school = searchCatalog('', { category: 'school' });
    expect(school.length).toBeGreaterThan(3);
    expect(school.every((e) => e.category === 'school')).toBe(true);
    expect(top('tracker', 'health')).toEqual(expect.arrayContaining(['medicine_tracker']));
    expect(top('tracker', 'health').every((id) => getCatalogEntry(id)!.category === 'health')).toBe(true);
    expect(searchCatalog('attendance', { category: 'shop' })).toEqual([]);
  });

  it('ignores case, punctuation and plurals', () => {
    expect(top('KIRANA!!')[0]).toBe('kirana_credit_book');
    expect(top('Notes')[0]).toBe('notes');
    expect(top('medicines')[0]).toBe('medicine_tracker');
  });
});
