import { describe, expect, it, vi } from 'vitest';
import type { AccessModes, RecordValue, RuntimeServices } from '@/core/contracts';
import { kalamSpecSchema, type KalamSpec } from '@/core/spec/schema';
import { validateSpec } from '@/core/spec/validate';
import { describeSpec } from '@/core/spec/describe';
import { createDraftKeeper, DRAFT_KEY, draftOf, restoreDraft } from './draft';
import { createRuntimeContext } from './context';
import { dispatchAction } from './dispatch';
import { formulaHint, formulaProblemKind } from './formula-hint';
import { createMemoryStores } from './memory-store';
import { createRuntimeState, setFieldValue } from './state';
import type { DataSnapshot, EngineEnv, RuntimeState } from './types';

const NOW = new Date(2026, 10, 17, 10, 30);
const MODES: AccessModes = { large: false, highContrast: false, simple: false, readAloud: false, leftHanded: false };

const base = {
  id: 'app_calc', schemaVersion: '1.1.0', version: 1, name: 'Calc', lang: 'en',
  theme: { primary: '#315C4C', radius: 12, fontScale: 1 },
  collections: {
    orders: { label: 'Orders', fields: { amount: { type: 'number', label: 'Amount', min: 0 } } },
    calc: {
      label: 'Calc',
      fields: {
        a: { type: 'number', label: 'A' }, b: { type: 'number', label: 'B' },
        sum: { type: 'number', label: 'Sum', max: 100 }, note: { type: 'text', label: 'Note' },
      },
    },
  },
  screens: [{
    id: 'home', title: 'Calc', form: 'calc', children: [
      { id: 'a_in', type: 'number', label: 'A', field: 'a' },
      { id: 'b_in', type: 'number', label: 'B', field: 'b' },
      { id: 'sum_in', type: 'number', label: 'Sum', field: 'sum' },
      { id: 'note_in', type: 'textInput', label: 'Note', field: 'note' },
      { id: 'total', type: 'counter', label: 'Total', min: 0, max: 50 },
      { id: 'go', type: 'bigButton', label: 'Add', action: 'add' },
    ],
  }],
  initialScreen: 'home',
  actions: {
    add: { type: 'compute', formula: 'form.a + form.b', target: 'sum', then: { feedback: 'Added' } },
    sum_orders: { type: 'compute', formula: 'sum(orders.amount)', target: 'total' },
    label: { type: 'compute', formula: "if(form.a > 5, 'big', 'small')", target: 'note' },
    orders_count: { type: 'compute', formula: 'count(orders)', target: 'sum' },
    too_big: { type: 'compute', formula: 'form.a * 1000', target: 'sum' },
    empty: { type: 'compute', formula: 'form.a / form.b', target: 'sum' },
    broken: { type: 'compute', formula: 'nope.amount', target: 'sum' },
    text_to_counter: { type: 'compute', formula: "'abc'", target: 'total' },
  },
  aiBlocks: {}, intents: {}, meta: { createdAt: 0 },
};
const spec: KalamSpec = kalamSpecSchema.parse(base);

function harness(seedOrders: number[] = []) {
  const stores = createMemoryStores(spec.id);
  const services: RuntimeServices = {
    ...stores, runAIBlock: vi.fn(), pickImage: vi.fn(), confirm: vi.fn(async () => true), speak: vi.fn(), online: () => true,
  };
  const data: DataSnapshot = { records: {}, state: {} };
  const reload = async () => {
    data.records = await stores.records.listAll(spec.id);
    data.state = await stores.state.all(spec.id);
  };
  const ready = (async () => {
    for (const amount of seedOrders) await stores.records.insert(spec.id, 'orders', { amount });
    await reload();
  })();
  const env = (): EngineEnv => ({ spec, appId: spec.id, services, data, now: NOW });
  return { env, ready, reload, stores, services, data };
}
const fill = (s: RuntimeState, values: Record<string, number | string>): RuntimeState =>
  Object.entries(values).reduce((st, [k, v]) => setFieldValue(spec, st, 'home', k, v, NOW), s);
const formValue = (s: RuntimeState, field: string) => s.forms.home?.[field];

describe('compute action (docs/05 §7.2)', () => {
  it('is part of the schema and passes validation', () => {
    const { broken: _runtimeOnly, ...fine } = base.actions;
    const result = validateSpec(kalamSpecSchema.parse({ ...base, actions: fine }));
    expect(result.errors).toEqual([]);
    expect(describeSpec(spec).actions.some((a) => a.startsWith('Works out a formula'))).toBe(true);
  });

  it('writes the answer to a form field and then applies its follow-up', async () => {
    const h = harness();
    await h.ready;
    const start = fill(createRuntimeState(spec), { a: '2', b: 3 });
    const r = await dispatchAction(h.env(), start, 'add');
    expect(r.ok).toBe(true);
    expect(formValue(r.state, 'sum')).toBe(5);
    expect(r.effects).toEqual([{ type: 'toast', message: 'Added', tone: 'success' }]);
  });

  it('keeps the answer to the field limits and says what is wrong', async () => {
    const h = harness();
    await h.ready;
    const start = fill(createRuntimeState(spec), { a: 5 });
    const r = await dispatchAction(h.env(), start, 'too_big');
    expect(r.ok).toBe(false);
    expect(r.state).toBe(start);
    expect(r.error).toBe('validation_failed');
    expect(r.effects[0]).toMatchObject({ type: 'toast', tone: 'warning', message: 'Sum must be at most 100' });
  });

  it('reads collections and writes a counter into app state, inside its min and max', async () => {
    const h = harness([30, 40, 5]);
    await h.ready;
    const r = await dispatchAction(h.env(), createRuntimeState(spec), 'sum_orders');
    expect(r.ok).toBe(true);
    expect(r.kvWrites).toEqual({ total: 50 }); // 75 held to the counter's max of 50
    expect((await h.stores.state.all(spec.id)).total).toBe(50);
  });

  it('puts text into a text field and a list size into a number field', async () => {
    const h = harness([1, 2, 3]);
    await h.ready;
    const big = await dispatchAction(h.env(), fill(createRuntimeState(spec), { a: 9 }), 'label');
    expect(formValue(big.state, 'note')).toBe('big');
    const count = await dispatchAction(h.env(), createRuntimeState(spec), 'orders_count');
    expect(formValue(count.state, 'sum')).toBe(3);
  });

  it('clears the field for an empty answer (division by nothing) and leaves a counter alone', async () => {
    const h = harness();
    await h.ready;
    const r = await dispatchAction(h.env(), fill(createRuntimeState(spec), { a: 4, b: 0 }), 'empty');
    expect(r.ok).toBe(true);
    expect(formValue(r.state, 'sum')).toBe('');
    const c = await dispatchAction(h.env(), createRuntimeState(spec), 'text_to_counter');
    expect(c.ok).toBe(false);
    expect(c.error).toBe('formula_failed');
    expect(await h.stores.state.all(spec.id)).toEqual({});
  });

  it('changes nothing and gives the way to fix a formula that cannot be worked out', async () => {
    const h = harness();
    await h.ready;
    const start = fill(createRuntimeState(spec), { a: 1 });
    const r = await dispatchAction(h.env(), start, 'broken');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('formula_failed');
    expect(r.state).toBe(start);
    expect(r.effects[0]).toMatchObject({ type: 'toast', tone: 'warning', message: expect.stringContaining('Open Edit') });
  });

  it('is rejected by validation when the formula or the target is wrong', () => {
    const bad = {
      ...base,
      actions: {
        ...base.actions,
        bad_formula: { type: 'compute', formula: 'sum(nothing.amount)', target: 'sum' },
        bad_target: { type: 'compute', formula: '1 + 1', target: 'missing_field' },
        sneaky: { type: 'compute', formula: 'constructor.constructor("x")()', target: 'sum' },
      },
    };
    const codes = validateSpec(kalamSpecSchema.parse(bad)).errors.map((e) => `${e.code}:${e.path}`);
    expect(codes).toContain('INVALID_FORMULA:actions.bad_formula.formula');
    expect(codes).toContain('UNKNOWN_TARGET:actions.bad_target.target');
    expect(codes).toContain('INVALID_FORMULA:actions.sneaky.formula');
  });

  it('rejects an unknown member or an over-long formula at the schema', () => {
    const withAction = (action: unknown) => kalamSpecSchema.safeParse({ ...base, actions: { x: action } }).success;
    expect(withAction({ type: 'compute', formula: '1', target: 'sum' })).toBe(true);
    expect(withAction({ type: 'compute', formula: '1', target: 'sum', code: 'alert(1)' })).toBe(false);
    expect(withAction({ type: 'compute', formula: '1'.repeat(301), target: 'sum' })).toBe(false);
    expect(withAction({ type: 'compute', formula: '', target: 'sum' })).toBe(false);
  });
});

describe('formula error hints (docs/09 §8.7)', () => {
  it('sorts an error into a cause and words the way out in the app language', () => {
    expect(formulaProblemKind('Formula is too complex to calculate')).toBe('too_complex');
    expect(formulaProblemKind('Unknown name "orders"')).toBe('unknown_name');
    expect(formulaProblemKind('Syntax error: Unexpected token')).toBe('invalid');
    const en = formulaHint({ ok: false, error: 'Unknown name "x"' }, 'en');
    expect(en).toEqual({ kind: 'unknown_name', message: 'This formula uses a name the app does not have. Open Edit and fix the formula.' });
    expect(formulaHint({ ok: false, error: 'Syntax error' }, 'hi')?.message).toMatch(/संपादन/);
    expect(formulaHint({ ok: false, error: 'x' }, 'fr')?.message).toMatch(/Open Edit/); // no French text: English
  });

  it('gives no hint for a formula that worked, even with an empty answer', () => {
    expect(formulaHint({ ok: true, value: 3 })).toBeUndefined();
    expect(formulaHint({ ok: true, value: null })).toBeUndefined();
  });

  it('never repeats the formula, a name or a value', () => {
    const hint = formulaHint({ ok: false, error: 'Unknown name "secret_customer_ravi"' }, 'en');
    expect(hint?.message).not.toContain('ravi');
  });
});

describe('unsent draft (docs/09 §15.5)', () => {
  const typed = () => fill(createRuntimeState(spec), { a: '12.', note: 'for Asha' });

  it('keeps only typed values of known fields and brings them back', () => {
    const text = draftOf(spec, typed());
    expect(JSON.parse(text)).toEqual({ v: 1, stack: ['home'], forms: { home: { a: '12.', note: 'for Asha' } } });
    expect(restoreDraft(spec, text)).toEqual({ stack: ['home'], forms: { home: { a: '12.', note: 'for Asha' } } });
  });

  it('keeps nothing when nothing is typed, and drops empty values', () => {
    expect(draftOf(spec, createRuntimeState(spec))).toBe('');
    expect(draftOf(spec, fill(createRuntimeState(spec), { a: '', note: '' }))).toBe('');
  });

  it('restores only what the app still has, and refuses a damaged or foreign draft', () => {
    const odd = JSON.stringify({ v: 1, stack: ['gone', 'home'], forms: { home: { a: 1, ghost: 'x', __proto__: 'y' }, nowhere: { a: 1 } } });
    expect(restoreDraft(spec, odd)).toEqual({ stack: ['home'], forms: { home: { a: 1 } } });
    expect(restoreDraft(spec, '{not json')).toBeUndefined();
    expect(restoreDraft(spec, JSON.stringify({ v: 2, stack: [], forms: {} }))).toBeUndefined();
    expect(restoreDraft(spec, JSON.stringify({ v: 1, stack: ['home'], forms: { home: { a: { evil: true } } } }))).toBeUndefined();
    expect(restoreDraft(spec, JSON.stringify({ v: 1, stack: ['home'], forms: { home: { ghost: 'x' } } }))).toBeUndefined();
    expect(restoreDraft(spec, undefined)).toBeUndefined();
    expect(restoreDraft(spec, 42)).toBeUndefined();
  });

  it('stays inside the 5000 character value limit', () => {
    const long = fill(createRuntimeState(spec), { note: 'x'.repeat(2000) });
    const text = draftOf(spec, long);
    expect(text.length).toBeLessThanOrEqual(4800);
    expect(JSON.parse(text).forms.home.note).toHaveLength(500);
  });

  it('reads and writes through the app key-value state, skipping a write of the same text', async () => {
    const stores = createMemoryStores(spec.id);
    const set = vi.spyOn(stores.state, 'set');
    const keeper = createDraftKeeper(stores.state, spec.id, () => spec);
    expect(await keeper.load()).toBeUndefined();
    await keeper.save(createRuntimeState(spec));
    expect(set).not.toHaveBeenCalled(); // nothing to keep, nothing stored
    await keeper.save(typed());
    await keeper.save(typed());
    expect(set).toHaveBeenCalledTimes(1);
    expect((await stores.state.all(spec.id))[DRAFT_KEY]).toContain('for Asha');

    const next = createDraftKeeper(stores.state, spec.id, () => spec);
    expect((await next.load())?.forms.home.note).toBe('for Asha');
    await next.save(createRuntimeState(spec)); // saved or cleared: the draft goes
    expect((await stores.state.all(spec.id))[DRAFT_KEY]).toBe('');
  });

  it('survives a storage failure', async () => {
    const stores = createMemoryStores(spec.id);
    stores.state.set = async () => {
      throw new Error('full');
    };
    await expect(createDraftKeeper(stores.state, spec.id, () => spec).save(typed())).resolves.toBeUndefined();
  });

  it('the draft key cannot be used by the app itself', () => {
    const clash = { ...base, screens: [{ ...base.screens[0], children: [...base.screens[0].children, { id: 'kalam_draft', type: 'counter', label: 'X' }] }] };
    expect(validateSpec(kalamSpecSchema.parse(clash)).errors.map((e) => e.code)).toContain('RESERVED_ID');
  });
});

describe('runtime context (docs/09 §6)', () => {
  function context() {
    const h = harness([10, 20]);
    const ctx = createRuntimeContext({ spec, appId: spec.id, services: h.services, accessibility: MODES, now: () => NOW });
    return { h, ctx };
  }

  it('hands the engine one consistent env and keeps counter writes in its data', async () => {
    const { h, ctx } = context();
    await h.ready;
    ctx.patchData({ records: h.data.records, state: h.data.state });
    expect(ctx.env().data).toBe(ctx.data());
    expect(ctx.env().now).toEqual(NOW);
    const r = await ctx.dispatch(createRuntimeState(spec), 'sum_orders');
    expect(r.kvWrites).toEqual({ total: 30 });
    expect(ctx.data().state.total).toBe(30);
  });

  it('evaluates formulas through the cache over its own data and the screen form', async () => {
    const { h, ctx } = context();
    await h.ready;
    ctx.patchData({ records: h.data.records, state: h.data.state });
    const st = fill(createRuntimeState(spec), { a: 4, b: 5 });
    expect(ctx.evaluate('sum(orders.amount) + form.a + form.b', st)).toEqual({ ok: true, value: 39 });
    expect(ctx.evaluate('sum(orders.amount) + form.a + form.b', st)).toEqual({ ok: true, value: 39 });
    expect(ctx.formulas().stats.hits).toBe(1);
    expect(ctx.collections()).toBe(ctx.collections()); // rebuilt only when the records change
    // New records invalidate; the same text gives the new answer.
    await h.stores.records.insert(spec.id, 'orders', { amount: 1 });
    ctx.patchData({ records: await h.stores.records.listAll(spec.id) });
    expect(ctx.evaluate('sum(orders.amount) + form.a + form.b', st)).toEqual({ ok: true, value: 40 });
  });

  it('swaps spec, theme and formula cache together when the design changes', () => {
    const { ctx } = context();
    const before = ctx.formulas();
    const theme = ctx.theme();
    ctx.setSpec({ ...spec, version: 2, theme: { ...spec.theme, primary: '#8A2B2B' } });
    expect(ctx.spec().version).toBe(2);
    expect(ctx.formulas()).not.toBe(before);
    expect(ctx.theme()).not.toBe(theme);
  });

  it('run() tracks any operation and merges its counter writes, so idle() waits and evaluate() sees them', async () => {
    const { ctx } = context();
    const st = createRuntimeState(spec);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const work = ctx.run(async (e) => {
      expect(e.data).toBe(ctx.data());
      await gate;
      return { kvWrites: { total: 7 } };
    });
    let idle = false;
    void ctx.idle().then(() => { idle = true; });
    await new Promise((r) => setTimeout(r, 5));
    expect(idle).toBe(false);
    release();
    await work;
    await ctx.idle();
    expect(ctx.data().state.total).toBe(7);
    expect(ctx.evaluate('state.total', st)).toEqual({ ok: true, value: 7 });
    // A synchronous throw is a rejection, and it does not leave the context busy.
    await expect(ctx.run(() => { throw new Error('boom'); })).rejects.toThrow('boom');
    await ctx.idle();
  });

  it('waits for actions in flight', async () => {
    const h = harness([10]);
    await h.ready;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slowState = { ...h.services.state, set: async (a: string, k: string, v: RecordValue) => { await gate; return h.services.state.set(a, k, v); } };
    const ctx = createRuntimeContext({ spec, appId: spec.id, services: { ...h.services, state: slowState }, accessibility: MODES, data: h.data });
    const run = ctx.dispatch(createRuntimeState(spec), 'sum_orders');
    let idle = false;
    void ctx.idle().then(() => { idle = true; });
    await new Promise((r) => setTimeout(r, 5));
    expect(idle).toBe(false);
    release();
    await run;
    await new Promise((r) => setTimeout(r, 5));
    expect(idle).toBe(true);
    expect(ctx.data().state.total).toBe(10);
  });
});
