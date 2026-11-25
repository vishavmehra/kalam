import { describe, expect, it } from 'vitest';
import type { TemplateId } from '../contracts';
import { evaluateFormula, localDate } from '../formula';
import { kalamSpecSchema, type KalamComponent, type KalamSpec } from '../spec/schema';
import { validateSpec } from '../spec/validate';
import { extractAppName, extractCurrency, extractList, extractUnit } from './extract';
import { getTemplate, instantiateTemplate, listTemplates, matchTemplates } from './index';

const OPTS = { appId: 'app_test-1', now: 1_794_950_000_000, lang: 'en' };
const today = localDate(new Date());

/** Three request variations per template (deterministic extraction → different params). */
const VARIATIONS: Record<TemplateId, string[]> = {
  calculator: [
    'Make a calculator with addition and division only, blue theme',
    'GST calculator called Bill Mate with 5%, 18% and 28% rates in rupees',
    'jod ghata guna bhag wala calculator, high contrast',
  ],
  counter: [
    'Counter for glasses of water with target 8',
    'mala jaap counter',
    'tally counter called Gate Count that can go negative',
  ],
  checklist: ['grocery shopping list', 'to-do checklist named Office Tasks in lavender', 'packing checklist for my trip'],
  notes: ['daily diary', 'ideas notebook called Spark', 'simple notes app in minimal black and white'],
  expense_tracker: [
    'Record my daily spending in euros with a blue theme',
    'Expense tracker with categories food, travel and rent in dollars',
    "Kharcha app named Ghar Ka Hisaab with categories Kid's school, sabzi and bijli bill",
  ],
  habit_tracker: [
    'Habit tracker for exercise, reading and water',
    'habits like yoga, walking and no sugar, green theme',
    'Daily routine tracker called Streaks',
  ],
  contact_book: [
    'contact book with name, phone and address',
    'customer phone book grouped by Wholesale, Retail and Online',
    'phonebook without email named Family Numbers',
  ],
  inventory: [
    'Inventory for my shop with units kg, litre and pieces, alert below 10',
    'dukaan ka stock register without price',
    'warehouse stock in euros called Depot',
  ],
  simple_form: [
    'Registration form with name, phone number, age, date of birth and email',
    'attendance register with student name, date and present',
    'Visitor register with name, purpose, address, visit date and paid',
  ],
  measurement_log: [
    'Tailor measurement book with chest, waist and sleeve in inches',
    'darzi naap book in cm called Ramesh Tailors',
    'body measurements: neck, shoulder, bust, hip, inseam, thigh and wrist',
  ],
  reminder_list: ['medicine reminder', 'bills ki due date yaad rakhne ka app', 'birthday reminders in lavender'],
};

function expectValid(spec: KalamSpec, label: string): void {
  const structural = kalamSpecSchema.safeParse(spec);
  expect(structural.success, `${label}: ${structural.success ? '' : structural.error.message}`).toBe(true);
  const result = validateSpec(spec);
  expect(result.errors, `${label}: ${JSON.stringify(result.errors, null, 1)}`).toEqual([]);
  expect(result.ok).toBe(true);
  expect(spec.meta.source).toBe('template');
  expect(spec.initialScreen).toBe(spec.screens[0]?.id);
  expect(spec.icon?.glyph).toBeTruthy();
  expect(spec.theme.preset).toBeTruthy();
}

const stats = (spec: KalamSpec): Map<string, string> => {
  const out = new Map<string, string>();
  for (const s of spec.screens) for (const c of s.children) if (c.type === 'stat') out.set(c.id, c.expr);
  return out;
};
const evalStat = (spec: KalamSpec, id: string, ctx: Partial<Parameters<typeof evaluateFormula>[1]>) => {
  const expr = stats(spec).get(id);
  if (!expr) throw new Error(`no stat ${id}`);
  const r = evaluateFormula(expr, { collections: {}, form: {}, state: {}, now: new Date(), ...ctx });
  if (!r.ok) throw new Error(`${id}: ${r.error}`);
  return r.value;
};

describe('template registry', () => {
  it('has one template per TemplateId', () => {
    const ids = listTemplates().map((t) => t.id).sort();
    expect(ids).toEqual(Object.keys(VARIATIONS).sort());
  });

  for (const t of listTemplates()) {
    describe(t.id, () => {
      it('defaults pass schema + validateSpec', () => {
        expect(t.paramsSchema.safeParse(t.defaults).success).toBe(true);
        expectValid(t.build(t.defaults, OPTS), `${t.id} defaults`);
      });
      it('3 extracted param variations pass schema + validateSpec and differ from defaults', () => {
        const defaultsJson = JSON.stringify(t.build(t.defaults, OPTS));
        for (const text of VARIATIONS[t.id]) {
          const res = instantiateTemplate(t.id, text, OPTS);
          if (!res.ok) throw new Error(`${t.id} "${text}": ${res.error}`);
          expectValid(res.value.spec, `${t.id} "${text}"`);
          expect(JSON.stringify(res.value.spec), `"${text}" changed nothing`).not.toEqual(defaultsJson);
        }
      });
      it('examples match this template first', () => {
        for (const ex of t.examples) expect(matchTemplates(ex)[0]?.templateId, ex).toBe(t.id);
      });
      it('every intent phrase list is bilingual and bounded', () => {
        const spec = t.build(t.defaults, OPTS);
        for (const [action, list] of Object.entries(spec.intents)) {
          expect(spec.actions[action], action).toBeDefined();
          expect(list.length).toBeLessThanOrEqual(12);
        }
        const all = Object.values(spec.intents).flat().join(' ');
        expect(/[ऀ-ॿ]/.test(all), 'has Devanagari phrase').toBe(true);
      });
    });
  }

  it('rejects invalid overrides instead of partially applying them', () => {
    const res = instantiateTemplate('counter', 'counter', OPTS, { step: -5 });
    expect(res.ok).toBe(false);
  });
});

describe('matchTemplates', () => {
  const cases: Array<[string, TemplateId]> = [
    ['Make a calculator with addition, subtraction, multiplication and division', 'calculator'],
    ['roz ka hisaab rakhne ka app', 'expense_tracker'],
    ['kharcha likhne wala app', 'expense_tracker'],
    ['ginti karne ke liye app', 'counter'],
    ['saman ki suchi', 'checklist'],
    ['darzi ke liye naap book', 'measurement_log'],
    ['dukaan ka stock', 'inventory'],
    ['मेरा खर्चा लिखने का ऐप', 'expense_tracker'],
    ['dawai ka reminder', 'reminder_list'],
  ];
  it.each(cases)('%s → %s', (text, id) => {
    const top = matchTemplates(text)[0];
    expect(top?.templateId).toBe(id);
    expect(top?.score).toBeGreaterThanOrEqual(0.7);
  });
  it('weak words alone never reach the strong threshold', () => {
    expect(matchTemplates('my shop')[0]?.score ?? 0).toBeLessThan(0.7);
    expect(matchTemplates('hello there')).toEqual([]);
  });
});

describe('deterministic extraction', () => {
  it.each([
    ['an expense app called Ghar Ka Hisaab', 'Ghar Ka Hisaab'],
    ['make "Ramesh Tailors" measurements', 'Ramesh Tailors'],
    ['Ramesh Tailors naam ka app banao', 'Ramesh Tailors'],
    ['counter named Gate 3 for visitors', 'Gate 3'],
  ])('app name: %s', (text, name) => expect(extractAppName(text)).toBe(name));
  it.each([
    ['in rupees', 'INR'], ['₹ 200', 'INR'], ['Rs 50', 'INR'], ['$ budget', 'USD'], ['in USD', 'USD'],
    ['€ please', 'EUR'], ['in euros', 'EUR'], ['no currency here', undefined],
  ])('currency: %s', (text, code) => expect(extractCurrency(text)).toBe(code));
  it('lists after keywords, stopping at clause words', () => {
    expect(extractList('expense tracker with categories food, travel and rent for my family', ['categories']))
      .toEqual(['Food', 'Travel', 'Rent']);
    expect(extractList('a habit tracker for exercise, reading and water', ['habit', 'for'])).toEqual(['Exercise', 'Reading', 'Water']);
    expect(extractList('a tracker for me', ['for'])).toBeUndefined();
  });
  it('units', () => {
    expect(extractUnit('in inches')).toBe('in');
    expect(extractUnit('measured in cm')).toBe('cm');
    expect(extractUnit('a log in my shop')).toBeUndefined();
  });
});

describe('template formulas compute real values', () => {
  const build = (id: TemplateId, text = '') => {
    const res = instantiateTemplate(id, text, OPTS);
    if (!res.ok) throw new Error(res.error);
    return res.value.spec;
  };

  it('calculator: four operations and divide-by-zero', () => {
    const spec = build('calculator', 'calculator with addition, subtraction, multiplication and division');
    expect(evalStat(spec, 'add_result', { form: { a: 6, b: 3 } })).toBe(9);
    expect(evalStat(spec, 'subtract_result', { form: { a: 6, b: 3 } })).toBe(3);
    expect(evalStat(spec, 'multiply_result', { form: { a: 6, b: 3 } })).toBe(18);
    expect(evalStat(spec, 'divide_result', { form: { a: 6, b: 3 } })).toBe(2);
    expect(evalStat(spec, 'divide_result', { form: { a: 6, b: 0 } })).toBe('Not defined');
  });

  it('calculator GST: tax, CGST/SGST split and total', () => {
    const spec = build('calculator', 'GST calculator with 5%, 12% and 18%');
    const form = { amount: 1000, rate: '18%' };
    expect(evalStat(spec, 'gst_amount', { form })).toBe(180);
    expect(evalStat(spec, 'cgst_sgst', { form })).toBe(90);
    expect(evalStat(spec, 'total_amount', { form })).toBe(1180);
    const rateChoice = spec.screens[0]?.children.find((c) => c.type === 'choice') as Extract<KalamComponent, { type: 'choice' }>;
    expect(rateChoice.options).toEqual(['5%', '12%', '18%']);
  });

  it('docs/07 §4.4: daily expenses in rupees → INR with amount, category, date, note', () => {
    const spec = build('expense_tracker', 'Make a simple application to record my daily expenses in rupees');
    expect(Object.keys(spec.collections.expenses?.fields ?? {})).toEqual(['amount', 'category', 'date', 'note']);
    const total = spec.screens[0]?.children.find((c) => c.id === 'spent_total');
    expect(total).toMatchObject({ format: 'currency', currency: 'INR' });
  });

  it('expense tracker: today, this month, total and per-category', () => {
    const spec = build('expense_tracker', 'expenses with categories food, travel and rent');
    const expenses = [
      { amount: 120, category: 'Food', date: today },
      { amount: 80, category: 'Travel', date: today },
      { amount: 30, category: 'Food', date: `${today.slice(0, 7)}-01` },
      { amount: 5000, category: 'Rent', date: '2020-01-01' },
    ];
    expect(evalStat(spec, 'spent_today', { collections: { expenses } })).toBe(today.endsWith('-01') ? 230 : 200);
    expect(evalStat(spec, 'spent_month', { collections: { expenses } })).toBe(230);
    expect(evalStat(spec, 'spent_total', { collections: { expenses } })).toBe(5230);
    expect(evalStat(spec, 'category_total_1', { collections: { expenses } })).toBe(150);
    expect(evalStat(spec, 'category_total_3', { collections: { expenses } })).toBe(5000);
  });

  it('counter target and checklist / reminders / inventory counts', () => {
    const counter = build('counter', 'counter with target 10');
    expect(evalStat(counter, 'left_to_target', { state: { count: 4 } })).toBe(6);
    expect(evalStat(counter, 'target_status', { state: { count: 10 } })).toBe('Target reached');

    const checklist = build('checklist');
    const items = [{ title: 'a', done: true }, { title: 'b', done: false }, { title: 'c', done: false }];
    expect(evalStat(checklist, 'remaining', { collections: { items } })).toBe(2);

    const reminders = build('reminder_list');
    const rs = [
      { title: 'x', due: today, done: false }, { title: 'y', due: '2000-01-01', done: false },
      { title: 'z', due: '2000-01-01', done: true },
    ];
    expect(evalStat(reminders, 'due_today', { collections: { reminders: rs } })).toBe(1);
    expect(evalStat(reminders, 'overdue', { collections: { reminders: rs } })).toBe(1);

    const inventory = build('inventory');
    const products = [{ name: 'Rice', qty: 2, reorder_level: 5 }, { name: 'Dal', qty: 20, reorder_level: 5 }];
    expect(evalStat(inventory, 'low_stock_count', { collections: { products } })).toBe(1);

    const habits = build('habit_tracker', 'habits like yoga and walking');
    const logs = [{ habit: 'Yoga', date: today, done: true }, { habit: 'Walking', date: '2020-01-01', done: true }];
    expect(evalStat(habits, 'done_today', { collections: { logs } })).toBe(1);
    expect(evalStat(habits, 'habit_days_2', { collections: { logs } })).toBe(1);
  });

  it('simple form infers field types and safe identifiers', () => {
    const spec = build('simple_form', 'Registration form with name, phone number, age, date of birth and email');
    const fields = spec.collections.entries?.fields ?? {};
    expect(Object.keys(fields)).toEqual(['name', 'phone_number', 'age', 'date_of_birth', 'email']);
    expect(fields.age?.type).toBe('number');
    expect(fields.date_of_birth?.type).toBe('date');
    expect(fields.name?.required).toBe(true);
  });
});

describe('getTemplate', () => {
  it('returns the definition by id', () => expect(getTemplate('notes')?.title).toBe('Notes'));
});
