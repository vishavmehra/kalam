import { describe, expect, it, vi } from 'vitest';
import { loadFixture } from '../../../../tests/fixtures/specs/load';
import type { AccessModes, KalamRecord, RuntimeServices } from '@/core/contracts';
import { completeSpec } from '@/core/compiler/complete';
import { validateFormula } from '@/core/formula';
import { validateSpec } from '@/core/spec';
import type { ComponentOf, KalamScreen, KalamSpec } from '@/core/spec/schema';
import { collectionValues, evaluate, formulaContext, queryList } from '../data';
import { dispatchAction } from '../dispatch';
import { createMemoryStores } from '../memory-store';
import { contrastRatio, resolveAppTheme } from '../theme';
import type { EngineEnv, RuntimeState } from '../types';
import { computePlan } from '@/features/reminders/scheduler';
import {
  aiWritableFields, applyDeletePlan, arrangeScreen, componentTheme, confirmWithRelations, decodeSignature,
  deleteWithRelations, describeReminder, elapsedMs, encodeSignature, encodeTypedSignature, formatClock, formatTime,
  frameLayout, gridColumns, isSignature, machineValueErrors, MAX_CASCADE, pauseTimer, planDelete, relationLabel,
  relationOptions, remainingMs, remapLinks, reminderRule, reminderTitleField, safeLocale, setReminderEnabled, settle,
  signaturePath, spokenDuration, startTimer, TIMER_IDLE, timerFieldValue, toBox, typedSignature, V11_COPY,
  v11FieldText, withSpecReminders,
} from './index';

const spec = (name: string) => validateSpec(loadFixture('valid', name, 'v11')).spec as KalamSpec;
const tailor = spec('tailor-orders-linked');
const workout = spec('workout-timer');
const MODES: AccessModes = { large: false, highContrast: false, simple: false, readAloud: false, leftHanded: false };
const STATE: RuntimeState = { stack: ['home'], forms: {}, errors: {}, selection: null };

let seq = 0;
const rec = (collectionId: string, values: KalamRecord['values'], id = `r${++seq}`): KalamRecord =>
  ({ id, appId: 'tailor_orders_v11', collectionId, createdAt: seq, updatedAt: seq, values });

function seed() {
  const asha = rec('customers', { name: 'Asha' }, 'c_asha');
  const ravi = rec('customers', { name: 'Ravi' }, 'c_ravi');
  const o1 = rec('orders', { customer: 'c_asha', garment: 'Kurta' }, 'o1');
  const o2 = rec('orders', { customer: 'c_asha', garment: 'Shirt' }, 'o2');
  const o3 = rec('orders', { customer: 'c_ravi', garment: 'Pant' }, 'o3');
  const p1 = rec('payments', { order: 'o1', amount: 200 }, 'p1');
  const p2 = rec('payments', { order: 'o3', amount: 100 }, 'p2');
  return { customers: [asha, ravi], orders: [o1, o2, o3], payments: [p1, p2] };
}

function env(s: KalamSpec, records: Record<string, KalamRecord[]>, confirm = true) {
  const stores = createMemoryStores(s.id, { records });
  const services = { ...stores, confirm: vi.fn(async () => confirm) } as unknown as RuntimeServices;
  const e: EngineEnv = { spec: s, appId: s.id, services, data: { records, state: {} }, now: new Date(2026, 10, 20) };
  return { e, stores, services };
}

describe('relations', () => {
  const records = seed();
  const ref = { collection: 'customers', display: 'name' };

  it('lists linked entries by their label and shows a stored link', () => {
    expect(relationOptions(tailor, ref, records.customers)).toEqual([{ id: 'c_asha', label: 'Asha' }, { id: 'c_ravi', label: 'Ravi' }]);
    expect(relationLabel(tailor, ref, records.customers, 'c_ravi')).toBe('Ravi');
    expect(relationLabel(tailor, ref, records.customers, 'gone')).toBe('Missing entry');
    expect(relationLabel(tailor, ref, records.customers, null)).toBeUndefined();
    expect(v11FieldText(tailor, 'orders', 'customer', 'c_asha', records)).toBe('Asha');
    expect(v11FieldText(tailor, 'orders', 'garment', 'Kurta', records)).toBeUndefined();
  });

  it('plans cascade and clear, deepest first, without touching unrelated entries', () => {
    const plan = planDelete(tailor, 'customers', 'c_asha', records);
    expect(plan.blocked).toBeUndefined();
    expect(plan.cascade).toEqual([{ collection: 'orders', id: 'o2' }, { collection: 'orders', id: 'o1' }]);
    expect(plan.clear).toEqual([{ collection: 'payments', id: 'p1', field: 'order' }]);
    expect(confirmWithRelations('Delete Asha?', plan)).toBe('Delete Asha?\nThis also deletes 2 linked entries.\n1 linked entry loses the link.');
  });

  it('runs the plan through the repository and keeps other entries', async () => {
    const { e, stores } = env(tailor, seed());
    const r = await deleteWithRelations(e, STATE, 'customers', 'c_asha', 'Delete Asha?');
    expect(r.ok).toBe(true);
    const after = await stores.records.listAll(tailor.id);
    expect(after.customers.map((x) => x.id)).toEqual(['c_ravi']);
    expect(after.orders.map((x) => x.id)).toEqual(['o3']);
    expect(after.payments.find((p) => p.id === 'p1')?.values.order).toBeNull();
    expect(after.payments.find((p) => p.id === 'p2')?.values.order).toBe('o3');
  });

  it('refuses a delete a restrict link forbids, and changes nothing', async () => {
    const strict = structuredClone(tailor);
    const f = strict.collections.orders.fields.customer;
    if (f.type === 'text' && f.ref) f.ref.onDelete = 'restrict';
    const { e, stores, services } = env(strict, seed());
    const r = await deleteWithRelations(e, STATE, 'customers', 'c_asha', 'Delete?');
    expect(r).toMatchObject({ ok: false, error: 'validation_failed' });
    expect(r.effects[0]).toMatchObject({ type: 'toast', message: expect.stringContaining('2 entries in Orders still use it') });
    expect(services.confirm).not.toHaveBeenCalled();
    expect((await stores.records.listAll(strict.id)).customers).toHaveLength(2);
  });

  it('changes nothing when the person cancels', async () => {
    const { e, stores } = env(tailor, seed(), false);
    expect(await deleteWithRelations(e, STATE, 'customers', 'c_asha', 'Delete?')).toMatchObject({ ok: false, error: 'cancelled' });
    expect((await stores.records.listAll(tailor.id)).orders).toHaveLength(3);
  });

  it('plans again after the question and stops when a new entry linked to it meanwhile', async () => {
    const { e, stores, services } = env(tailor, seed());
    services.confirm = vi.fn(async () => {
      await stores.records.insert(tailor.id, 'orders', { customer: 'c_asha', garment: 'Coat' }); // another tab
      return true;
    });
    const r = await deleteWithRelations(e, STATE, 'customers', 'c_asha', 'Delete Asha?');
    expect(r).toMatchObject({ ok: false, error: 'validation_failed', effects: [{ message: V11_COPY.deleteChanged }] });
    const after = await stores.records.listAll(tailor.id);
    expect(after.customers).toHaveLength(2);
    expect(after.orders).toHaveLength(4);
  });

  it('never breaks on a language tag Intl refuses (an imported spec with lang "en-abc")', () => {
    const odd = { ...tailor, lang: 'en-abc' };
    expect(safeLocale('en-abc')).toBe('en');
    expect(safeLocale('hi-IN')).toBe('hi-IN');
    expect(relationOptions(odd, ref, records.customers).map((o) => o.label)).toEqual(['Asha', 'Ravi']);
    const reminder = tailor.screens[0].children.find((x) => x.type === 'reminder') as ComponentOf<'reminder'>;
    expect(describeReminder(odd, reminder)).toContain('delivery date');
  });

  it('ends on self links and loops, and caps runaway cascades', () => {
    const tree = structuredClone(tailor);
    tree.collections.customers.fields.referrer = { type: 'text', label: 'Referred by', ref: { collection: 'customers', onDelete: 'cascade' } };
    const loop = {
      customers: [rec('customers', { name: 'A', referrer: 'b' }, 'a'), rec('customers', { name: 'B', referrer: 'a' }, 'b')],
      orders: [], payments: [],
    };
    expect(planDelete(tree, 'customers', 'a', loop).cascade).toEqual([{ collection: 'customers', id: 'b' }]);
    const chain = { customers: Array.from({ length: MAX_CASCADE + 5 }, (_, i) => rec('customers', { referrer: `n${i}` }, `n${i + 1}`)), orders: [], payments: [] };
    expect(planDelete(tree, 'customers', 'n0', chain).blocked?.tooMany).toBe(true);
  });

  it('runs a delete as one storage transaction: a failed write changes nothing, and says so', async () => {
    const { e, stores, services } = env(tailor, seed());
    const batch = vi.spyOn(services.records, 'batch').mockRejectedValueOnce(new Error('disk full'));
    const r = await deleteWithRelations(e, STATE, 'customers', 'c_asha', 'Delete Asha?');
    expect(batch).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ ok: false, error: 'storage_failed', effects: [{ message: V11_COPY.deleteFailed }] });
    const after = await stores.records.listAll(tailor.id);
    expect(after.customers.map((x) => x.id)).toEqual(['c_asha', 'c_ravi']);
    expect(after.orders.map((x) => x.id).sort()).toEqual(['o1', 'o2', 'o3']);
    // The same delete, when nothing fails, is one batch of every write.
    const ok = await deleteWithRelations(e, STATE, 'customers', 'c_asha', 'Delete Asha?');
    expect(ok.ok).toBe(true);
    expect((await stores.records.listAll(tailor.id)).customers.map((x) => x.id)).toEqual(['c_ravi']);
  });

  it('a repository with no batch falls back to one write at a time and never empties a link to an entry that is still there', async () => {
    const { e, stores, services } = env(tailor, seed());
    delete (services.records as { batch?: unknown }).batch;
    // Writes: order o2, order o1, then the customer. The customer fails; the payment link is untouched.
    let n = 0;
    const remove = services.records.remove.bind(services.records);
    services.records.remove = vi.fn(async (...a: Parameters<typeof remove>) => {
      if (++n === 3) throw new Error('disk full');
      return remove(...a);
    });
    const r = await deleteWithRelations(e, STATE, 'customers', 'c_asha', 'Delete Asha?');
    expect(r).toMatchObject({ ok: false, error: 'storage_failed', effects: [{ message: V11_COPY.deletePartly }] });
    const after = await stores.records.listAll(tailor.id);
    expect(after.customers.map((x) => x.id)).toEqual(['c_asha', 'c_ravi']);
    expect(after.payments.find((p) => p.id === 'p1')?.values.order).toBe('o1');
    // A failure on the very first write changed nothing, and says that.
    const first = env(tailor, seed());
    delete (first.services.records as { batch?: unknown }).batch;
    first.services.records.remove = vi.fn(async () => {
      throw new Error('locked');
    });
    const r2 = await deleteWithRelations(first.e, STATE, 'customers', 'c_asha', 'Delete?');
    expect(r2.effects[0]).toMatchObject({ message: V11_COPY.deleteFailed });
  });

  it('never stores free text as a link, keeps AI out of links and signatures, and remaps restored ids', () => {
    const records = seed();
    expect(machineValueErrors(tailor, 'orders', { customer: 'c_ravi', garment: 'Kurta' }, records)).toEqual({});
    expect(machineValueErrors(tailor, 'orders', { customer: 'Raju' }, records)).toEqual({ customer: V11_COPY.linkNotFound });
    expect(machineValueErrors(tailor, 'orders', { customer: null }, records)).toEqual({});
    expect(machineValueErrors(tailor, 'orders', { signature: 'Asha' }, records)).toEqual({ signature: V11_COPY.signatureNotDrawn });
    expect(machineValueErrors(tailor, 'orders', { signature: 'sigt:Asha' }, records)).toEqual({});
    expect(aiWritableFields(tailor, 'orders')).toEqual(['garment', 'advance', 'delivery', 'delivered']);
    expect(aiWritableFields(tailor, 'nowhere')).toEqual([]);
    const moved = new Map([['c_asha', 'c_new']]);
    expect(remapLinks(tailor, 'orders', { customer: 'c_asha', garment: 'c_asha' }, moved)).toEqual({ customer: 'c_new', garment: 'c_asha' });
  });

  it('a 1.0 app without links deletes exactly as before', async () => {
    const plain = validateSpec(loadFixture('valid', 'expense-tracker')).spec as KalamSpec;
    const col = Object.keys(plain.collections)[0];
    const { e, stores } = env(plain, { [col]: [rec(col, {}, 'x1')] });
    expect(planDelete(plain, col, 'x1', e.data.records)).toEqual({ cascade: [], clear: [] });
    await applyDeletePlan(e, col, 'x1', { cascade: [], clear: [] });
    expect((await stores.records.listAll(plain.id))[col]).toEqual([]);
  });
});

describe('layout', () => {
  const home = tailor.screens[0];
  const kinds = (items: ReturnType<typeof arrangeScreen>): unknown[] =>
    items.map((i) => (i.kind === 'component' ? i.component.id : { [i.node.type]: kinds(i.items) }));

  it('places each group where its first member was, keeping everything else in order', () => {
    expect(kinds(arrangeScreen(home, home.children))).toEqual([
      { row: ['open_orders', 'advance_total'] },
      { grid: ['advance_chart', 'garment_chart'] },
      'delivery_reminder',
      'order_list',
      { card: [{ row: ['add_order', 'add_customer'] }] },
    ]);
  });

  it('drops hidden members and empty groups', () => {
    const visible = home.children.filter((c) => c.id !== 'add_order' && c.id !== 'add_customer');
    expect(kinds(arrangeScreen(home, visible))).toEqual([
      { row: ['open_orders', 'advance_total'] }, { grid: ['advance_chart', 'garment_chart'] }, 'delivery_reminder', 'order_list',
    ]);
  });

  it('keeps the 1.0 behaviour without a layout: consecutive stats share a row', () => {
    const plain: KalamScreen = { ...home, layout: undefined };
    expect(kinds(arrangeScreen(plain, plain.children)).slice(0, 2)).toEqual([{ row: ['open_orders', 'advance_total'] }, 'advance_chart']);
  });

  it('drops grid columns on a narrow screen or in Large mode instead of squeezing cells', () => {
    expect(gridColumns(0, 4, 1, 12)).toEqual({ columns: 4 }); // before the first measure
    expect(gridColumns(328, 4, 1, 12)).toEqual({ columns: 1, cell: 328 }); // 360 px phone minus gutters
    expect(gridColumns(700, 4, 1, 12)).toEqual({ columns: 4, cell: 166 });
    expect(gridColumns(700, 4, 1.5, 12)).toEqual({ columns: 2, cell: 344 });
    expect(gridColumns(2000, 3, 1, 12).columns).toBe(3); // never more than asked for
    const { columns, cell } = gridColumns(500, 3, 1, 12);
    expect(columns * (cell as number) + 12 * (columns - 1)).toBeLessThanOrEqual(500);
  });
});

describe('style', () => {
  const t = resolveAppTheme(tailor.theme, MODES);

  it('colours the words of a text or heading with its tone, legibly, and nothing else', () => {
    for (const tone of ['secondary', 'success', 'warning', 'danger', 'primary'] as const) {
      const heading = componentTheme(t, { tone }, 'heading');
      expect(heading.colors.text).toBe(heading.colors.primaryText);
      expect(contrastRatio(heading.colors.text, heading.colors.surface)).toBeGreaterThanOrEqual(4.5);
      expect(componentTheme(t, { tone }, 'number').colors.text).toBe(t.colors.text);
    }
    expect(componentTheme(t, { tone: 'neutral' }, 'text').colors.text).toBe(t.colors.text);
  });

  it('returns the same theme when nothing changes, so memoised parts do not re-render', () => {
    expect(componentTheme(t, undefined)).toBe(t);
    expect(componentTheme(t, { align: 'end' })).toBe(t);
  });

  it('takes tones from the palette and keeps text legible on them', () => {
    for (const tone of ['secondary', 'success', 'warning', 'danger', 'neutral'] as const) {
      const ct = componentTheme(t, { tone });
      expect(contrastRatio(ct.colors.onPrimary, ct.colors.primary)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(ct.colors.primaryText, ct.colors.surface)).toBeGreaterThanOrEqual(4.5);
    }
    expect(componentTheme(t, { tone: 'danger' }).colors.primary).toBe(t.colors.danger);
    const hc = resolveAppTheme(tailor.theme, { ...MODES, highContrast: true });
    expect(contrastRatio(componentTheme(hc, { tone: 'warning' }).colors.primaryText, '#FFFFFF')).toBeGreaterThanOrEqual(7);
  });

  it('scales size and emphasis but never the touch target', () => {
    const big = componentTheme(t, { size: 'large', emphasis: 'strong' });
    expect(big.fontScale).toBeCloseTo(t.fontScale * 1.2 * 1.06);
    expect(big.target).toBe(t.target);
    expect(big.borderWidth).toBe(t.borderWidth + 1);
    expect(componentTheme(t, { emphasis: 'subtle' }).colors.text).toBe(t.colors.textMuted);
    expect(frameLayout({ fullWidth: true, align: 'start' })).toEqual({ alignSelf: 'stretch', width: '100%' });
    expect(frameLayout({ align: 'center' })).toEqual({ alignSelf: 'center' });
    expect(frameLayout({ size: 'small' })).toBeUndefined();
  });
});

describe('timer', () => {
  const rest = workout.screens[0].children.find((c) => c.id === 'rest_timer') as ComponentOf<'timer'>;
  const session = workout.screens[1].children.find((c) => c.id === 'session_timer') as ComponentOf<'timer'>;

  it('counts from timestamps, pauses and resumes', () => {
    let s = startTimer(TIMER_IDLE, 1_000);
    expect(elapsedMs(s, 31_000)).toBe(30_000);
    s = pauseTimer(s, 31_000);
    expect(elapsedMs(s, 99_000)).toBe(30_000);
    s = startTimer(s, 100_000);
    expect(elapsedMs(s, 110_000)).toBe(40_000);
  });

  it('stops a countdown exactly at its length', () => {
    const s = startTimer(TIMER_IDLE, 0);
    expect(remainingMs(rest, s, 30_000)).toBe(60_000);
    expect(settle(rest, s, 30_000)).toBe(s);
    const done = settle(rest, s, 95_000);
    expect(done).toEqual({ running: false, accumulatedMs: 90_000 });
    expect(remainingMs(rest, done, 200_000)).toBe(0);
    expect(timerFieldValue(rest, s, 500_000)).toBe(90);
  });

  it('writes minutes to a tenth and formats for eyes and ears', () => {
    expect(timerFieldValue(session, startTimer(TIMER_IDLE, 0), 754_000)).toBe(12.6);
    expect(formatClock(75_000)).toBe('1:15');
    expect(formatClock(3_725_000)).toBe('1:02:05');
    expect(formatClock(59_100, true)).toBe('1:00');
    expect(spokenDuration(125_000)).toBe('2 minutes 5 seconds');
    expect(spokenDuration(0)).toBe('0 seconds');
    expect(spokenDuration(3_600_000)).toBe('1 hour');
  });
});

describe('reminder', () => {
  const c = tailor.screens[0].children.find((x) => x.type === 'reminder') as ComponentOf<'reminder'>;

  it('becomes one Smart Reminders rule, off until the person switches it on', () => {
    expect(reminderRule(c, false)).toEqual({
      id: 'delivery_reminder', enabled: false, collection: 'orders', dateField: 'delivery', leadDays: 1, timeOfDay: '09:30',
      condition: { field: 'delivered', op: 'is_false' }, titleField: 'garment', message: 'Deliver {title} tomorrow',
    });
    expect(withSpecReminders(undefined, tailor, {})?.rules[0].enabled).toBe(false);
    expect(withSpecReminders(undefined, tailor, { delivery_reminder: true })?.rules[0].enabled).toBe(true);
  });

  it('keeps stored rules first, skips id clashes and keeps the per-app cap', () => {
    const stored = { version: 1 as const, rules: [1, 2, 3, 4].map((i) => ({ ...reminderRule(c, true), id: `r${i}` })) };
    expect(withSpecReminders(stored, tailor, {})?.rules.map((r) => r.id)).toEqual(['r1', 'r2', 'r3', 'r4']);
    const clash = { version: 1 as const, rules: [{ ...reminderRule(c, true), id: 'delivery_reminder', leadDays: 3 }] };
    expect(withSpecReminders(clash, tailor, {})?.rules).toEqual(clash.rules);
    expect(withSpecReminders(undefined, workout, {})).toBeUndefined();
  });

  it('says when it fires in the app\'s own words and time format', () => {
    expect(describeReminder(tailor, c)).toBe('1 day before delivery date, at 9:30 AM. Entries marked delivered are skipped.');
    expect(formatTime('00:05', '12h')).toBe('12:05 AM');
    expect(formatTime('13:00', '12h')).toBe('1:00 PM');
  });

  it('stores the switch in app state and reports the write', async () => {
    const { e, stores } = env(tailor, {});
    const r = await setReminderEnabled(e, STATE, 'delivery_reminder', true);
    expect(r).toMatchObject({ ok: true, kvWrites: { delivery_reminder: true }, reminderStatus: 'on' });
    expect(await stores.state.all(tailor.id)).toEqual({ delivery_reminder: true });
  });

  it('asks for permission only on switch-on and reports what the device really did', async () => {
    const { e } = env(tailor, {});
    type Status = 'synced' | 'no_permission' | 'unsupported' | 'error';
    const device = {
      requestPermission: vi.fn(async () => undefined),
      sync: vi.fn(async (): Promise<{ status: Status }> => ({ status: 'no_permission' })),
    };
    expect((await setReminderEnabled(e, STATE, 'delivery_reminder', true, device)).reminderStatus).toBe('no_permission');
    expect(device.requestPermission).toHaveBeenCalledTimes(1);
    device.sync.mockResolvedValueOnce({ status: 'unsupported' });
    expect((await setReminderEnabled(e, STATE, 'delivery_reminder', true, device)).reminderStatus).toBe('unsupported');
    expect((await setReminderEnabled(e, STATE, 'delivery_reminder', false, device)).reminderStatus).toBe('off');
    expect(device.requestPermission).toHaveBeenCalledTimes(2); // never on switch-off
    expect(device.sync).toHaveBeenCalledTimes(3); // switch-off still cancels what was scheduled
    device.sync.mockRejectedValueOnce(new Error('boom'));
    expect((await setReminderEnabled(e, STATE, 'delivery_reminder', true, device)).reminderStatus).toBe('error');
  });

  it('goes from the switch to a scheduled notification that names the entry, never a link id', async () => {
    // No titleField: the rule picks a plain text field itself, never the link or the signature.
    const noted = structuredClone(tailor);
    noted.collections.orders.fields.note = { type: 'text', label: 'Note' };
    const comp = noted.screens[0].children.find((x) => x.type === 'reminder') as ComponentOf<'reminder'>;
    delete comp.titleField;
    // With no plain text field, the link names the entry (by the customer's own name), before a choice does.
    expect(reminderTitleField(tailor, { ...c, titleField: undefined })).toBe('customer');
    expect(reminderTitleField(noted, comp)).toBe('note');
    // The scheduler prints a choice as its option, so a choice named in the spec is kept.
    expect(reminderTitleField(noted, { ...comp, titleField: 'garment' })).toBe('garment');
    expect(reminderTitleField(tailor, c)).toBe('garment');
    expect(reminderTitleField(tailor, { ...c, titleField: 'signature' })).toBe('customer'); // a signature never names an entry

    const { e, stores } = env(noted, {});
    await setReminderEnabled(e, STATE, comp.id, true);
    const config = withSpecReminders(undefined, noted, await stores.state.all(noted.id));
    const order = rec('orders', { customer: 'c_asha', garment: 'Kurta', note: 'Blue kurta', delivery: '2026-11-22', delivered: false }, 'o9');
    const plan = computePlan({ appId: noted.id, spec: noted, records: { orders: [order] }, config, now: new Date(2026, 10, 20, 8).getTime() });
    expect(plan.desired).toHaveLength(1);
    expect(plan.desired[0].body).toBe('Deliver Blue kurta tomorrow');

    // Named by a link, the notification says the customer's name, never the stored id; a gone customer falls back.
    const byCustomer = withSpecReminders(undefined, { ...noted, screens: noted.screens.map((s) => ({ ...s, children: s.children.map((x) => (x.type === 'reminder' ? { ...x, titleField: 'customer' } : x)) })) } as KalamSpec, { [comp.id]: true });
    const linked = computePlan({ appId: noted.id, spec: noted, records: { orders: [order], customers: [rec('customers', { name: 'Asha Rao' }, 'c_asha')] }, config: byCustomer, now: new Date(2026, 10, 20, 8).getTime() });
    expect(linked.desired[0].body).toBe('Deliver Asha Rao tomorrow');
    const gone = computePlan({ appId: noted.id, spec: noted, records: { orders: [order], customers: [] }, config: byCustomer, now: new Date(2026, 10, 20, 8).getTime() });
    expect(gone.desired[0].body).toBe('Deliver Blue kurta tomorrow');
    // And as a choice, the option.
    const byGarment = withSpecReminders(undefined, { ...noted, screens: noted.screens.map((s) => ({ ...s, children: s.children.map((x) => (x.type === 'reminder' ? { ...x, titleField: 'garment' } : x)) })) } as KalamSpec, { [comp.id]: true });
    expect(computePlan({ appId: noted.id, spec: noted, records: { orders: [order] }, config: byGarment, now: new Date(2026, 10, 20, 8).getTime() }).desired[0].body).toBe('Deliver Kurta tomorrow');
  });
});

describe('signature', () => {
  const strokes = [[[0, 0], [100, 50], [200, 80]], [[500, 200]]] as const;

  it('round-trips through plain numbers', () => {
    const text = encodeSignature(strokes.map((s) => s.map(([x, y]) => [x, y] as const)));
    expect(text).toMatch(/^sig1:[0-9a-z.]+$/);
    expect(isSignature(text)).toBe(true);
    expect(decodeSignature(text)).toEqual([[[0, 0], [100, 50], [200, 80]], [[500, 200]]]);
    expect(v11FieldText(tailor, 'orders', 'signature', text, {})).toBe('Signed');
  });

  it('rejects anything that is not exactly the format', () => {
    for (const bad of ['sig1:', 'sig1:abc', 'sig2:0000', '<svg onload=alert(1)>', 'sig1:0000<script>', `sig1:${'0000'.repeat(1000)}`, 42, null]) {
      expect(decodeSignature(bad)).toBeUndefined();
    }
    expect(decodeSignature('sig1:zzzz')).toBeUndefined(); // 1295 is off the box
    expect(isSignature('sig1:zzzz')).toBe(false); // so a list never says "Signed" for it either
  });

  it('says "Signed" only for a field a signature component fills', () => {
    const text = encodeTypedSignature('Asha');
    expect(v11FieldText(tailor, 'orders', 'signature', text, {})).toBe('Signed');
    expect(v11FieldText(tailor, 'orders', 'garment', text, {})).toBeUndefined(); // typed into an ordinary field
    expect(v11FieldText(tailor, 'customers', 'name', 'sig1:0000', {})).toBeUndefined();
  });

  it('thins long signatures until they fit the field', () => {
    const long = [Array.from({ length: 4000 }, (_, i) => [(i * 7) % 1000, (i * 13) % 400] as const)];
    const text = encodeSignature(long);
    expect(text && text.length).toBeLessThanOrEqual(4000);
    expect(encodeSignature([])).toBeUndefined();
  });

  it('takes a typed name for people who cannot draw, and nothing else', () => {
    const text = encodeTypedSignature('  Asha   Rao ');
    expect(text).toBe('sigt:Asha Rao');
    expect(isSignature(text)).toBe(true);
    expect(typedSignature(text)).toBe('Asha Rao');
    expect(decodeSignature(text)).toBeUndefined();
    expect(v11FieldText(tailor, 'orders', 'signature', text, {})).toBe('Signed');
    for (const bad of ['', '   ', 'a'.repeat(81), 'x\u0000y']) expect(encodeTypedSignature(bad)).toBeUndefined();
    expect(typedSignature('sigt:')).toBeUndefined();
  });

  it('draws only numbers and maps screen points into the box', () => {
    expect(signaturePath([[[0, 0], [1000, 400]]], 300, 120)).toBe('M0 0 L300 120');
    expect(signaturePath([[[500, 200]]], 100, 40)).toBe('M50 20 L50.1 20');
    expect(toBox(150, 60, 300, 120)).toEqual([500, 200]);
    expect(toBox(-5, 999, 300, 120)).toEqual([0, 400]);
  });
});

describe('1.1 writes through the dispatcher', () => {
  const at = (screen: string, form: Record<string, unknown> = {}, selection: RuntimeState['selection'] = null): RuntimeState =>
    ({ stack: [screen], forms: { [screen]: form as never }, errors: {}, selection });

  it('never saves free text as a link, from any input', async () => {
    const { e, stores } = env(tailor, seed());
    const bad = await dispatchAction(e, at('add', { customer: 'Raju', garment: 'Kurta' }), 'save_order');
    expect(bad).toMatchObject({ ok: false, error: 'validation_failed' });
    expect(bad.state.errors.customer).toBe(V11_COPY.linkNotFound);
    const good = await dispatchAction(e, at('add', { customer: 'c_ravi', garment: 'Kurta' }), 'save_order');
    expect(good.ok).toBe(true);
    expect((await stores.records.listAll(tailor.id)).orders).toHaveLength(4);
  });

  it('checks a required signature on Save, and refuses text that is not a signature', async () => {
    const signed = structuredClone(tailor);
    const pad = signed.screens.find((s) => s.id === 'order_detail')!.children.find((c) => c.type === 'signature') as ComponentOf<'signature'>;
    pad.required = true;
    const { e } = env(signed, seed());
    const sel = { collection: 'orders', recordId: 'o1' };
    const blank = await dispatchAction(e, at('order_detail', { signature: null }, sel), 'update_order');
    expect(blank).toMatchObject({ ok: false, error: 'validation_failed' });
    expect(blank.state.errors.signature).toMatch(/Pickup signature/);
    const typed = await dispatchAction(e, at('order_detail', { signature: 'Asha' }, sel), 'update_order');
    expect(typed.state.errors.signature).toBe(V11_COPY.signatureNotDrawn);
    expect((await dispatchAction(e, at('order_detail', { signature: 'sigt:Asha' }, sel), 'update_order')).ok).toBe(true);
  });

  it('a delete follows the links, and its question says what else changes', async () => {
    const { e, stores, services } = env(tailor, seed());
    const r = await dispatchAction(e, at('order_detail', {}, { collection: 'orders', recordId: 'o1' }), 'delete_order');
    expect(r.ok).toBe(true);
    expect(services.confirm).toHaveBeenCalledWith('Delete this order?\n1 linked entry loses the link.');
    const after = await stores.records.listAll(tailor.id);
    expect(after.orders.map((o) => o.id)).toEqual(['o2', 'o3']);
    expect(after.payments.find((p) => p.id === 'p1')?.values.order).toBeNull();
  });
});

describe('formulas on a linked parent (eval 2026-11-25 s23 "Unknown name id")', () => {
  // The live build wrote the student's balance as "this student's own fee minus this student's payments".
  const fees = spec('fee-ledger-linked');
  const balance = (fees.screens[2].children[1] as ComponentOf<'stat'>).expr;
  const records = {
    students: [rec('students', { name: 'Asha', total_fee: 5000 }, 's_asha'), rec('students', { name: 'Ravi', total_fee: 3000 }, 's_ravi')],
    payments: [
      rec('payments', { student: 's_asha', amount: 1000 }, 'p1'),
      rec('payments', { student: 's_asha', amount: 500 }, 'p2'),
      rec('payments', { student: 's_ravi', amount: 700 }, 'p3'),
    ],
  };
  const ctx = (selected: string | null) => formulaContext(collectionValues(fees, records), {}, {}, new Date(2026, 10, 25), selected);

  it('validates: id inside a filter is the entry\'s own id', () => {
    expect(validateSpec(loadFixture('valid', 'fee-ledger-linked', 'v11')).errors).toEqual([]);
    expect(balance).toContain('id == selected');
    const scope = { collections: { students: ['name', 'total_fee'] }, formFields: [], stateKeys: [] };
    expect(validateFormula('sum(filter(students, id == selected).total_fee)', scope)).toEqual([]);
    expect(validateFormula('id', scope)).toEqual(['Unknown name "id"']); // only inside a filter
    // The deterministic repair keeps it valid (the golden case's sketch labels as the request).
    const request = 'Students Pending fees New student Student fees Balance Payments Collect fee Amount Date Mode of payment Save';
    const repaired = validateSpec(completeSpec(fees, { request }).spec);
    expect(repaired.errors).toEqual([]);
    expect(JSON.stringify(repaired.spec)).toContain('id == selected');
  });

  it('gives each student their own balance on their page, and nothing when none is open', () => {
    expect(evaluate(balance, ctx('s_asha'))).toEqual({ ok: true, value: 3500 });
    expect(evaluate(balance, ctx('s_ravi'))).toEqual({ ok: true, value: 2300 });
    expect(evaluate(balance, ctx(null))).toEqual({ ok: true, value: 0 });
    const list = fees.screens[2].children[2] as ComponentOf<'list'>;
    expect(queryList(list, records.payments, ctx('s_asha')).rows.map((r) => r.id).sort()).toEqual(['p1', 'p2']);
    expect(queryList({ ...list, source: 'students', filter: 'id == selected' }, records.students, ctx('s_ravi')).rows.map((r) => r.id)).toEqual(['s_ravi']);
  });

  it('lets a field the app itself named "id" win', () => {
    const own = { ...fees, collections: { ...fees.collections, students: { ...fees.collections.students, fields: { ...fees.collections.students.fields, id: { type: 'text' as const, label: 'Roll no' } } } } };
    const roll = { students: [rec('students', { id: 'R7', total_fee: 10 }, 's_x')], payments: [] };
    expect(collectionValues(own, roll).students[0]).toEqual({ id: 'R7', total_fee: 10 });
  });
});
