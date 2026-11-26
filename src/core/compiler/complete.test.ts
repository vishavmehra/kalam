/**
 * The deterministic repair on the real apps the live eval of 2026-11-25 built (tests/fixtures/compiler/
 * eval-2026-11-25-built.json: Firebase output, unchanged, with the reviewer's verdict). Each test checks the
 * behaviour the reviewer found broken, by running the repaired formulas on sample entries where it can.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FormulaContext } from '../contracts';
import { evaluateFormula } from '../formula';
import type { KalamComponent, KalamSpec } from '../spec/schema';
import { validateSpec } from '../spec/validate';
import { completeSpec } from './complete';
import { irToSpec } from './convert';
import { compilerIRSchema } from './ir';
import { EXAMPLE_IR } from './prompt';

interface Fixture { id: string; reviewer: string; request: string; spec: KalamSpec }
const FIXTURES: Fixture[] = JSON.parse(
  readFileSync(new URL('../../../tests/fixtures/compiler/eval-2026-11-25-built.json', import.meta.url), 'utf8'),
).cases;

function repair(prefix: string, currency?: string) {
  const f = FIXTURES.find((c) => c.id.startsWith(`${prefix}-`));
  if (!f) throw new Error(`no fixture ${prefix}`);
  const before = validateSpec(f.spec);
  const r = completeSpec(before.spec ?? f.spec, { request: f.request, currency });
  const v = validateSpec(r.spec);
  if (!v.ok || !v.spec) throw new Error(`${prefix} invalid after repair: ${v.errors.map((e) => `${e.code} ${e.path}`).join(', ')}`);
  return { before, spec: v.spec, notes: r.notes, warnings: v.warnings.map((w) => w.code) };
}

const screen = (spec: KalamSpec, id: string) => {
  const s = spec.screens.find((x) => x.id === id);
  if (!s) throw new Error(`no screen ${id}`);
  return s;
};
const stats = (spec: KalamSpec, screenId: string) =>
  screen(spec, screenId).children.filter((c): c is Extract<KalamComponent, { type: 'stat' }> => c.type === 'stat');
const statByLabel = (spec: KalamSpec, screenId: string, re: RegExp) => {
  const s = stats(spec, screenId).find((c) => re.test(c.label));
  if (!s) throw new Error(`no stat ${re} on ${screenId}: ${stats(spec, screenId).map((c) => c.label).join(', ')}`);
  return s;
};
const listOf = (spec: KalamSpec, screenId: string, source: string) =>
  screen(spec, screenId).children.find((c): c is Extract<KalamComponent, { type: 'list' }> => c.type === 'list' && c.source === source);
const buttonAction = (spec: KalamSpec, screenId: string, label: RegExp) => {
  const b = screen(spec, screenId).children.find((c): c is Extract<KalamComponent, { type: 'bigButton' }> => c.type === 'bigButton' && label.test(c.label));
  return b ? spec.actions[b.action] : undefined;
};

const now = new Date(2026, 10, 25, 10, 0); // Wednesday 2026-11-25, local
function value(expr: string, collections: FormulaContext['collections'], extra: Partial<FormulaContext> = {}) {
  const r = evaluateFormula(expr, { collections, form: {}, state: {}, now, ...extra });
  if (!r.ok) throw new Error(`${expr}: ${r.error}`);
  return r.value;
}

describe('completeSpec on the eval apps', () => {
  it('every repaired app is valid, and every saved field can be seen again where a screen fits', () => {
    for (const f of FIXTURES) {
      const prefix = f.id.split('-')[0];
      const { warnings } = repair(prefix);
      if (prefix !== 't18') expect([prefix, warnings.filter((w) => w === 'FIELD_NOT_SHOWN')]).toEqual([prefix, []]);
    }
  });

  it('s07: credit entries belong to one customer, and the balance takes payments off', () => {
    const { spec } = repair('s07');
    expect(spec.collections.entries.fields.customer).toMatchObject({ type: 'text', ref: { collection: 'customers', display: 'name' } });
    expect(listOf(spec, 'customer_screen', 'entries')?.filter).toBe('customer == selected');
    const balance = statByLabel(spec, 'customer_screen', /balance/i);
    const entries = [
      { customer: 'c1', amount: 500, is_payment: false }, { customer: 'c1', amount: 200, is_payment: true },
      { customer: 'c2', amount: 900, is_payment: false },
    ];
    expect(value(balance.expr, { entries }, { selected: 'c1' })).toBe(300);
    expect(value(balance.expr, { entries }, { selected: 'c2' })).toBe(900);
  });

  it('mx04: repayments subtract from each customer\'s udhaar and from the shop total, instead of adding to it', () => {
    const { spec } = repair('mx04');
    expect(spec.collections.entries.fields.customer_name).toMatchObject({ ref: { collection: 'customers' } });
    const balance = statByLabel(spec, 'customer_detail_screen', /balance/i);
    const entries = [
      { customer_name: 'c1', amount: 1000, is_payment: false }, { customer_name: 'c1', amount: 400, is_payment: true },
      { customer_name: 'c2', amount: 50, is_payment: false },
    ];
    expect(value(balance.expr, { entries }, { selected: 'c1' })).toBe(600);
    expect(value(statByLabel(spec, 'customers_screen', /total udhaar/i).expr, { entries })).toBe(650);
  });

  it('s07 with a "paid" flag: a settled entry is owed until it is paid, never taken off the balance', () => {
    const f = FIXTURES.find((c) => c.id.startsWith('s07-'))!;
    const text = JSON.stringify(f.spec).replace(/is_payment/g, 'paid').replace(/Payment received/g, 'Paid');
    const r = completeSpec(validateSpec(JSON.parse(text)).spec!, { request: f.request.replace(/Got payment|Payment received/g, '') });
    const v = validateSpec(r.spec);
    expect(v.errors).toEqual([]);
    const balance = statByLabel(v.spec!, 'customer_screen', /balance/i);
    const rows = [{ customer: 'c1', amount: 500, paid: false }, { customer: 'c1', amount: 200, paid: true }];
    expect(value(balance.expr, { entries: rows }, { selected: 'c1' })).toBe(500);
  });

  it('t16: the customers collection is filled and shown, with a balance per customer', () => {
    const { before, spec } = repair('t16');
    expect(before.warnings.map((w) => w.code)).toContain('UNUSED_COLLECTION');
    expect(spec.collections.transactions.fields.customer_name).toMatchObject({ ref: { collection: 'customers' } });
    expect(spec.screens.some((s) => s.form === 'customers' && s.children.some((c) => c.type === 'bigButton' && spec.actions[c.action]?.type === 'insert'))).toBe(true);
    const balance = statByLabel(spec, 'customer_details', /balance/i);
    const transactions = [
      { customer_name: 'c1', type: 'Udhaar Diya (Given)', amount: 700 },
      { customer_name: 'c1', type: 'Wapas Mila (Received)', amount: 300 },
      { customer_name: 'c2', type: 'Udhaar Diya (Given)', amount: 100 },
    ];
    expect(value(balance.expr, { transactions }, { selected: 'c1' })).toBe(400);
  });

  it('s23: payments belong to one student, the pending fee is per student, and the stub AI step is gone', () => {
    const { before, spec } = repair('s23');
    expect(Object.keys(before.spec!.aiBlocks)).toContain('default_stub');
    expect(spec.aiBlocks).toEqual({});
    expect(spec.collections.payments.fields.student).toMatchObject({ ref: { collection: 'students' } });
    const pending = stats(spec, 'student_detail_screen').find((c) => c.expr.startsWith('form.total_fee'));
    const payments = [{ student: 's1', amount: 2000 }, { student: 's1', amount: 500 }, { student: 's2', amount: 1000 }];
    expect(value(pending!.expr, { payments }, { selected: 's1', form: { total_fee: 5000 } })).toBe(2500);
  });

  it('t20: each student\'s paid and pending fees are shown on their page', () => {
    const { spec } = repair('t20');
    expect(spec.collections.payments.fields.student_name).toMatchObject({ ref: { collection: 'students' } });
    const pending = statByLabel(spec, 'edit_student', /pending/i);
    const payments = [{ student_name: 's1', amount: 1200 }, { student_name: 's2', amount: 300 }];
    expect(value(pending.expr, { payments }, { selected: 's1', form: { total_fee: 3000 } })).toBe(1800);
    expect(listOf(spec, 'edit_student', 'payments')?.filter).toBe('student_name == selected');
  });

  it('t17: each worker is typed once (a monthly summary of employees was asked for) and has a page with their own counts', () => {
    const { spec, warnings } = repair('t17');
    expect(spec.collections.workers.fields.name).toMatchObject({ type: 'text', required: true });
    expect(spec.collections.attendance.fields.worker_name).toMatchObject({ ref: { collection: 'workers' } });
    expect(warnings).not.toContain('SORT_BY_LINK');
    const present = statByLabel(spec, 'worker_details', /^present this month/i);
    const attendance = [
      { worker_name: 'w1', status: 'Present', shift_date: '2026-11-03' },
      { worker_name: 'w1', status: 'Present', shift_date: '2025-11-03' }, // same month last year
      { worker_name: 'w2', status: 'Present', shift_date: '2026-11-04' },
    ];
    expect(value(present.expr, { attendance }, { selected: 'w1' })).toBe(1);
  });

  it('t18: at the 8-screen limit names stay text (no page to pick a patient on), and the notes say so', () => {
    const { spec, notes } = repair('t18');
    expect(spec.collections.visits.fields.patient_name).not.toHaveProperty('ref');
    expect(notes.some((n) => /patient_name: kept as text, no room/.test(n))).toBe(true);
    expect(notes.some((n) => /no room for a detail screen/.test(n))).toBe(true);
  });

  it('s20: "Mark done" sets the status, "Cancel" marks the appointment, and Details shows the whole appointment', () => {
    const { before, spec } = repair('s20');
    expect(before.warnings.map((e) => e.code)).toContain('NO_OP_UPDATE');
    expect(buttonAction(spec, 'details_screen', /mark done/i)).toMatchObject({ type: 'update', set: { status: 'Done' } });
    expect(buttonAction(spec, 'details_screen', /cancel/i)).toMatchObject({ type: 'update', set: { status: 'Cancelled' } });
    const shown = screen(spec, 'details_screen').children.map((c) => ('field' in c ? c.field : undefined));
    expect(shown).toEqual(expect.arrayContaining(['client_name', 'phone', 'appointment_date', 'time', 'reason', 'status']));
    // Nobody asked for a client list: the booking's "Client name" stays text.
    expect(spec.collections.clients).toBeUndefined();
    expect(spec.collections.appointments.fields.client_name).not.toHaveProperty('ref');
  });

  it('a plain "Save changes" on a screen with no inputs gets inputs, never a silent "Done"', () => {
    const f = FIXTURES.find((c) => c.id.startsWith('s20-'))!;
    const text = JSON.stringify(f.spec).replace(/"Mark done"/g, '"Save changes"');
    const r = completeSpec(validateSpec(JSON.parse(text)).spec!, { request: f.request });
    expect(r.notes.some((n) => /"Save changes" now sets/.test(n))).toBe(false);
    const saves = screen(r.spec, 'details_screen').children.flatMap((c) => (c.type === 'bigButton' && c.label === 'Save changes' ? [r.spec.actions[c.action]] : []));
    expect(saves.length).toBeGreaterThan(0);
    for (const a of saves) expect(a).not.toHaveProperty('set');
    expect(validateSpec(r.spec).warnings.map((w) => w.code)).not.toContain('NO_OP_UPDATE');
  });

  it('s24: "This week" counts this week only, and sets, reps and weight can be seen again', () => {
    const { before, spec } = repair('s24');
    expect(before.warnings.filter((w) => w.code === 'FIELD_NOT_SHOWN')).toHaveLength(3);
    const week = statByLabel(spec, 'log', /this week/i);
    const workouts = [
      { exercise: 'Squat', workout_date: '2026-11-23' }, { exercise: 'Run', workout_date: '2026-11-25' },
      { exercise: 'Row', workout_date: '2026-11-22' }, { exercise: 'Swim', workout_date: '2025-11-25' },
    ];
    expect(value(week.expr, { workouts })).toBe(2);
    const detail = listOf(spec, 'log', 'workouts')?.detailScreen;
    const fields = screen(spec, detail!).children.map((c) => ('field' in c ? c.field : undefined));
    expect(fields).toEqual(expect.arrayContaining(['sets', 'reps', 'weight_kg']));
  });

  it('s21: a habit keeps a dated check-in per day, so the drawn streak is counted', () => {
    const { spec } = repair('s21');
    expect(spec.collections.habits.fields.done_today).toBeUndefined();
    expect(spec.collections.checkins.fields.habit).toMatchObject({ ref: { collection: 'habits' } });
    const streak = statByLabel(spec, 'detail_habit', /streak/i);
    const checkins = [
      { habit: 'h1', date: '2026-11-25', done: true }, { habit: 'h1', date: '2026-11-24', done: true },
      { habit: 'h1', date: '2026-11-22', done: true }, { habit: 'h2', date: '2026-11-23', done: true },
    ];
    expect(value(streak.expr, { checkins }, { selected: 'h1' })).toBe(2);
    const week = statByLabel(spec, 'detail_habit', /this week/i);
    expect(value(week.expr, { checkins }, { selected: 'h1' })).toBe(2);
    expect(spec.screens.some((s) => s.form === 'checkins')).toBe(true);
    // The old tick is one tap on the habit's page: an insert of today's check-in, linked by the runtime.
    expect(buttonAction(spec, 'detail_habit', /^done today$/i)).toMatchObject({ type: 'insert', collection: 'checkins' });
  });

  it('s22: money is in rupees, and each goal has its own page and total', () => {
    const { before, spec } = repair('s22');
    expect(JSON.stringify(before.spec)).toContain('USD');
    expect(spec.settings?.currency).toBe('INR');
    expect(JSON.stringify(spec)).not.toContain('USD');
    expect(spec.collections.savings_records.fields.goal).toMatchObject({ ref: { collection: 'goals' } });
    const page = spec.screens.find((s) => s.form === 'goals' && s.children.some((c) => c.type === 'list' && c.source === 'savings_records'));
    const total = page!.children.find((c) => c.type === 'stat' && /goal == selected/.test(c.expr));
    expect(total).toMatchObject({ format: 'currency', currency: 'INR' });
    // The model's "New goal" opened "Add money": renamed, so the only "New goal" makes a goal.
    const labels = screen(spec, 'goals_screen').children.flatMap((c) => (c.type === 'bigButton' ? [c.label] : []));
    expect(labels.filter((l) => l === 'New goal')).toHaveLength(1);
    expect(labels).toContain('Add money');
    const target = buttonAction(spec, 'goals_screen', /^new goal$/i);
    expect(target?.type === 'navigate' && screen(spec, target.screen).form).toBe('goals');
  });

  it('keeps money in the person\'s own currency when they set one', () => {
    expect(repair('s22', 'AED').spec.settings?.currency).toBe('AED');
  });

  it('s19: the item photo is kept in an image field, and rooms are their own list', () => {
    const { spec } = repair('s19');
    expect(spec.collections.items.fields.item_photo).toEqual({ type: 'image', label: 'Item photo' });
    const photo = screen(spec, 'add_item_screen').children.find((c) => c.type === 'photo');
    expect(photo).toMatchObject({ field: 'item_photo' });
    expect(spec.collections.items.fields.room).toMatchObject({ ref: { collection: 'rooms' } });
  });

  it('s15 and mx05: the Important flag and the allergies can be seen again', () => {
    expect(repair('s15').warnings).not.toContain('FIELD_NOT_SHOWN');
    const { spec } = repair('mx05');
    const page = spec.screens.find((s) => s.form === 'patients' && s.children.some((c) => c.type === 'list' && c.source === 'appointments'));
    expect(page?.children.some((c) => 'field' in c && c.field === 'allergies')).toBe(true);
  });

  it('is stable: repairing a repaired app changes nothing', () => {
    for (const f of FIXTURES) {
      const once = repair(f.id.split('-')[0]);
      expect([f.id, completeSpec(once.spec, { request: f.request }).spec]).toEqual([f.id, once.spec]);
    }
  });

  it('leaves the prompt example alone, and keeps a field an AI step fills as text', () => {
    const example = validateSpec(irToSpec(EXAMPLE_IR, { appId: 'app_example1', now: 1 }));
    expect(example.warnings.map((w) => w.code)).not.toContain('FIELD_NOT_SHOWN');
    expect(completeSpec(example.spec!, { request: 'an app to log watering my plants' }).notes).toEqual([]);
    const tailorIR = compilerIRSchema.parse(JSON.parse(readFileSync(new URL('../../../tests/fixtures/compiler/tailor-shop.ir.json', import.meta.url), 'utf8')));
    const tailor = completeSpec(validateSpec(irToSpec(tailorIR, { appId: 'app_tailor01', now: 1 })).spec!, { request: 'tailor shop' });
    const v = validateSpec(tailor.spec);
    expect(v.errors).toEqual([]);
    expect(v.spec!.collections.orders.fields.customer).not.toHaveProperty('ref'); // the slip reader fills it
    expect(v.warnings.map((w) => w.code)).not.toContain('FIELD_NOT_SHOWN');
  });
});
