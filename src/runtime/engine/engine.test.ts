import { describe, expect, it, vi } from 'vitest';
import type { AccessModes, AIExecutionResult, RecordValue, RuntimeServices } from '@/core/contracts';
import { kalamSpecSchema, type ComponentOf, type KalamSpec } from '@/core/spec/schema';
import {
  acceptProposal, collectionValues, contrastRatio, createMemoryStores, createRuntimeState, currentScreen, dispatchAction,
  evaluate, formatStat, formulaContext, getForm, isoDate, navigate, openRecord, parseNumber, queryList,
  resolveAppTheme, runAIBlockFlow, setFieldValue, stepCounter, visibleChildren, type DataSnapshot, type EngineEnv,
  type RuntimeState,
} from './index';

const NOW = new Date(2026, 10, 17, 10, 30);
const NO_MODES: AccessModes = { large: false, highContrast: false, simple: false, readAloud: false, leftHanded: false };

const tailor: KalamSpec = kalamSpecSchema.parse({
  id: 'app_tailor',
  schemaVersion: '1.0.0',
  version: 1,
  name: 'Tailor book',
  lang: 'en',
  theme: { primary: '#315C4C', radius: 12, fontScale: 1, preset: 'calm_green' },
  collections: {
    orders: {
      label: 'Orders',
      fields: {
        customer: { type: 'text', label: 'Customer', required: true },
        chest: { type: 'number', label: 'Chest', min: 10, max: 80, unit: 'in' },
        garment: { type: 'enum', label: 'Garment', options: ['Kurta', 'Shirt', 'Pant'] },
        delivery: { type: 'date', label: 'Delivery', defaultValue: 'today' },
        amount: { type: 'number', label: 'Amount', min: 0 },
        paid: { type: 'boolean', label: 'Paid' },
      },
    },
  },
  screens: [
    {
      id: 'home', title: 'Orders', children: [
        { id: 'total_orders', type: 'stat', label: 'Orders', expr: 'count(orders)', format: 'integer' },
        { id: 'total_amount', type: 'stat', label: 'Total', expr: 'sum(orders.amount)', format: 'currency', currency: 'INR' },
        { id: 'unpaid', type: 'stat', label: 'Unpaid', expr: 'count(filter(orders, paid != true))' },
        { id: 'new_btn', type: 'bigButton', label: 'New order', action: 'go_new' },
        {
          id: 'orders_list', type: 'list', source: 'orders', primary: 'customer', secondary: 'delivery',
          detailScreen: 'edit', toggleField: 'paid', allowDelete: true,
        },
        { id: 'tips', type: 'text', label: 'Tip: tap an order to edit it', secondary: true },
        { id: 'hidden', type: 'text', label: 'Hidden', visible: false },
      ],
    },
    {
      id: 'new', title: 'New order', form: 'orders', children: [
        { id: 'customer_in', type: 'textInput', label: 'Customer', field: 'customer', required: true },
        { id: 'chest_in', type: 'number', label: 'Chest', field: 'chest' },
        { id: 'garment_in', type: 'choice', label: 'Garment', field: 'garment' },
        { id: 'delivery_in', type: 'date', label: 'Delivery', field: 'delivery' },
        { id: 'amount_in', type: 'number', label: 'Amount', field: 'amount' },
        { id: 'scan', type: 'photo', label: 'Scan slip', aiBlock: 'slip' },
        { id: 'save_btn', type: 'bigButton', label: 'Save', action: 'save_order' },
      ],
    },
    {
      id: 'edit', title: 'Edit order', form: 'orders', children: [
        { id: 'customer_ed', type: 'textInput', label: 'Customer', field: 'customer', required: true },
        { id: 'amount_ed', type: 'number', label: 'Amount', field: 'amount' },
        { id: 'update_btn', type: 'bigButton', label: 'Save changes', action: 'update_order' },
        { id: 'delete_btn', type: 'bigButton', label: 'Delete', action: 'delete_order', tone: 'danger' },
      ],
    },
    {
      id: 'tea', title: 'Tea', children: [
        { id: 'cups', type: 'counter', label: 'Cups', min: 0, max: 3 },
        { id: 'sugar', type: 'counter', label: 'Sugar', field: 'spoons', min: 0, max: 1, step: 0.5 },
      ],
    },
  ],
  initialScreen: 'home',
  actions: {
    go_new: { type: 'navigate', screen: 'new' },
    save_order: { type: 'insert', collection: 'orders', then: { navigate: 'home', speak: 'Order saved' } },
    update_order: { type: 'update', collection: 'orders', record: 'selected', then: { navigate: 'home' } },
    delete_order: { type: 'delete', collection: 'orders', record: 'selected', confirm: 'Delete this order?' },
    more_cups: { type: 'increment', target: 'cups' },
    fewer_cups: { type: 'decrement', target: 'cups' },
    reset_cups: { type: 'reset', target: 'cups' },
    more_sugar: { type: 'increment', target: 'sugar' },
    read_slip: { type: 'runAI', aiBlock: 'slip', then: { feedback: 'Slip read' } },
    hello: { type: 'speak', text: 'Hello' },
    clear: { type: 'clearForm' },
  },
  aiBlocks: {
    slip: {
      kind: 'extractFromPhoto', prompt: 'Read the measurement slip', verified: 'cloudPreferred',
      target: 'orders', fields: ['customer', 'chest', 'garment'],
    },
  },
  intents: {},
  meta: { createdAt: 0 },
});

function harness(opts: { confirm?: boolean; online?: boolean; ai?: AIExecutionResult<Record<string, RecordValue>> } = {}) {
  const stores = createMemoryStores(tailor.id);
  const runAIBlock = vi.fn(async () =>
    opts.ai ?? { success: true, output: {}, provider: 'firebase', source: 'cloud', latencyMs: 5, fallbackUsed: false } as AIExecutionResult<Record<string, RecordValue>>);
  const pickImage = vi.fn(async () => ({ mimeType: 'image/jpeg' as const, base64: 'AAAA' }));
  const confirm = vi.fn(async () => opts.confirm ?? true);
  const services: RuntimeServices = {
    ...stores, runAIBlock, pickImage, confirm, speak: vi.fn(), online: () => opts.online ?? true,
  };
  const data: DataSnapshot = { records: {}, state: {} };
  const env = (): EngineEnv => ({ spec: tailor, appId: tailor.id, services, data, now: NOW });
  const reload = async () => {
    data.records = await stores.records.listAll(tailor.id);
    data.state = await stores.state.all(tailor.id);
  };
  return { env, reload, data, runAIBlock, pickImage, confirm };
}

function fill(state: RuntimeState, screenId: string, values: Record<string, RecordValue>): RuntimeState {
  let s = state;
  for (const [k, v] of Object.entries(values)) s = setFieldValue(tailor, s, screenId, k, v, NOW);
  return s;
}

function stat(id: string, h: ReturnType<typeof harness>) {
  const c = tailor.screens[0].children.find((x) => x.id === id) as ComponentOf<'stat'>;
  const ctx = formulaContext(collectionValues(tailor, h.data.records), {}, h.data.state, NOW);
  return formatStat(c, evaluate(c.expr, ctx), 'en');
}

async function addOrder(h: ReturnType<typeof harness>, values: Record<string, RecordValue>) {
  let s = (await dispatchAction(h.env(), createRuntimeState(tailor), 'go_new')).state;
  s = fill(s, 'new', values);
  const r = await dispatchAction(h.env(), s, 'save_order');
  await h.reload();
  return r;
}

describe('tailor app flow', () => {
  it('fills a form, inserts, clears and updates list + stats', async () => {
    const h = harness();
    let s = createRuntimeState(tailor);
    expect(currentScreen(tailor, s).id).toBe('home');

    s = (await dispatchAction(h.env(), s, 'go_new')).state;
    expect(s.stack).toEqual(['home', 'new']);
    // Date default 'today' is the local calendar date.
    expect(getForm(tailor, s, currentScreen(tailor, s), NOW).delivery).toBe('2026-11-17');

    s = fill(s, 'new', { customer: '  Asha ', chest: '38,5', garment: 'Kurta', amount: '1200' });
    const r = await dispatchAction(h.env(), s, 'save_order');
    expect(r.ok).toBe(true);
    expect(r.state.stack).toEqual(['home']);
    expect(r.state.forms.new).toBeUndefined(); // cleared
    expect(r.effects).toEqual([{ type: 'toast', message: 'Saved', tone: 'success' }, { type: 'speak', text: 'Order saved' }]);

    await h.reload();
    const rec = h.data.records.orders[0];
    expect(rec.values).toMatchObject({ customer: 'Asha', chest: 38.5, garment: 'Kurta', delivery: '2026-11-17', amount: 1200, paid: false });

    await addOrder(h, { customer: 'Ravi', amount: 800 });
    expect(stat('total_orders', h)).toBe('2');
    expect(stat('total_amount', h)).toBe('₹2,000.00');
    expect(stat('unpaid', h)).toBe('2');

    const list = tailor.screens[0].children.find((c) => c.type === 'list') as ComponentOf<'list'>;
    const ctx = formulaContext(collectionValues(tailor, h.data.records), {}, {}, NOW);
    expect(queryList(list, h.data.records.orders, ctx).rows.map((x) => x.values.customer)).toEqual(['Ravi', 'Asha']);
  });

  it('rejects invalid input with per-field errors and writes nothing', async () => {
    const h = harness();
    let s = (await dispatchAction(h.env(), createRuntimeState(tailor), 'go_new')).state;
    s = fill(s, 'new', { customer: '', chest: '5', garment: 'Dress', amount: 'abc' });
    const r = await dispatchAction(h.env(), s, 'save_order');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('validation_failed');
    expect(r.state.errors).toEqual({
      customer: 'Customer is required',
      chest: 'Chest must be at least 10',
      garment: 'Choose one of the options for Garment',
      amount: 'Amount must be a number',
    });
    expect(r.effects[0]).toMatchObject({ type: 'toast', tone: 'warning', message: 'Customer is required (and 3 more)' });
    expect(r.state.stack).toEqual(['home', 'new']); // stays on the form
    await h.reload();
    expect(h.data.records.orders ?? []).toHaveLength(0);
    // Editing a field clears just that field's error.
    expect(setFieldValue(tailor, r.state, 'new', 'customer', 'Asha', NOW).errors.customer).toBeUndefined();
  });

  it('clearForm resets to defaults; speak and unknown actions are handled', async () => {
    const h = harness();
    let s = (await dispatchAction(h.env(), createRuntimeState(tailor), 'go_new')).state;
    s = fill(s, 'new', { customer: 'X' });
    s = (await dispatchAction(h.env(), s, 'clear')).state;
    expect(getForm(tailor, s, currentScreen(tailor, s), NOW).customer).toBeNull();
    expect((await dispatchAction(h.env(), s, 'hello')).effects).toEqual([{ type: 'speak', text: 'Hello' }]);
    const bad = await dispatchAction(h.env(), s, 'does_not_exist');
    expect(bad).toMatchObject({ ok: false, error: 'unknown_action' });
  });
});

describe('counters', () => {
  it('state counter honours max / min and persists', async () => {
    const h = harness();
    const s = navigate(tailor, createRuntimeState(tailor), 'tea')!;
    for (let i = 0; i < 5; i++) {
      const r = await dispatchAction(h.env(), s, 'more_cups');
      await h.reload();
      expect(r.ok).toBe(true);
    }
    expect(h.data.state.cups).toBe(3);
    for (let i = 0; i < 5; i++) {
      await dispatchAction(h.env(), s, 'fewer_cups');
      await h.reload();
    }
    expect(h.data.state.cups).toBe(0);
    await dispatchAction(h.env(), s, 'more_cups');
    await h.reload();
    const r = await dispatchAction(h.env(), s, 'reset_cups');
    expect(r.kvWrites).toEqual({ cups: 0 });
  });

  it('form-bound counter uses step and clamps without float drift', async () => {
    const h = harness();
    let s = navigate(tailor, createRuntimeState(tailor), 'tea')!;
    expect(getForm(tailor, s, currentScreen(tailor, s), NOW).spoons).toBe(0);
    for (let i = 0; i < 4; i++) s = (await stepCounter(h.env(), s, 'sugar', 'increment')).state;
    expect(s.forms.tea.spoons).toBe(1);
    s = (await stepCounter(h.env(), s, 'sugar', 'decrement')).state;
    expect(s.forms.tea.spoons).toBe(0.5);
  });
});

describe('selection: update and delete', () => {
  async function seeded(confirm = true) {
    const h = harness({ confirm });
    await addOrder(h, { customer: 'Asha', garment: 'Shirt', amount: 500 });
    const list = tailor.screens[0].children.find((c) => c.type === 'list') as ComponentOf<'list'>;
    const rec = h.data.records.orders[0];
    const s = openRecord(tailor, createRuntimeState(tailor), list, rec, NOW)!;
    return { h, s, rec };
  }

  it('opening a record selects it and pre-fills the detail form', async () => {
    const { s, rec } = await seeded();
    expect(s.stack).toEqual(['home', 'edit']);
    expect(s.selection).toEqual({ collection: 'orders', recordId: rec.id });
    expect(s.forms.edit).toMatchObject({ customer: 'Asha', amount: 500 });
  });

  it('update changes only edited fields of the selected record', async () => {
    const { h, s, rec } = await seeded();
    const r = await dispatchAction(h.env(), setFieldValue(tailor, s, 'edit', 'amount', '650', NOW), 'update_order');
    expect(r.ok).toBe(true);
    expect(r.state.stack).toEqual(['home']);
    await h.reload();
    expect(h.data.records.orders[0]).toMatchObject({ id: rec.id, values: { customer: 'Asha', amount: 650, garment: 'Shirt' } });
  });

  it('update without a selection is refused', async () => {
    const h = harness();
    const s = navigate(tailor, createRuntimeState(tailor), 'edit')!;
    expect(await dispatchAction(h.env(), s, 'update_order')).toMatchObject({ ok: false, error: 'no_selection' });
  });

  it('delete asks for confirmation and keeps the record when cancelled', async () => {
    const { h, s } = await seeded(false);
    const r = await dispatchAction(h.env(), s, 'delete_order');
    expect(h.confirm).toHaveBeenCalledWith('Delete this order?');
    expect(r).toMatchObject({ ok: false, error: 'cancelled' });
    await h.reload();
    expect(h.data.records.orders).toHaveLength(1);
  });

  it('confirmed delete removes the record, clears selection and goes back', async () => {
    const { h, s } = await seeded(true);
    const r = await dispatchAction(h.env(), s, 'delete_order');
    expect(r.ok).toBe(true);
    expect(r.state.selection).toBeNull();
    expect(r.state.stack).toEqual(['home']);
    await h.reload();
    expect(h.data.records.orders).toHaveLength(0);
  });
});

describe('lists', () => {
  it('filters with a record predicate, sorts and limits', async () => {
    const h = harness();
    await addOrder(h, { customer: 'Bina', amount: 300 });
    await addOrder(h, { customer: 'Asha', amount: 900 });
    await addOrder(h, { customer: 'Chand', amount: 100 });
    const base = tailor.screens[0].children.find((c) => c.type === 'list') as ComponentOf<'list'>;
    const ctx = formulaContext(collectionValues(tailor, h.data.records), {}, {}, NOW);
    const q = (extra: Partial<ComponentOf<'list'>>) =>
      queryList({ ...base, ...extra }, h.data.records.orders, ctx).rows.map((r) => r.values.customer);
    expect(q({ filter: 'amount >= 300', sort: { field: 'amount', direction: 'desc' } })).toEqual(['Asha', 'Bina']);
    expect(q({ sort: { field: 'customer', direction: 'asc' }, limit: 2 })).toEqual(['Asha', 'Bina']);
    const bad = queryList({ ...base, filter: 'nope(' }, h.data.records.orders, ctx);
    expect(bad.filterError).toBeTruthy();
    expect(bad.rows).toHaveLength(3); // fails open rather than hiding the user's data
  });
});

describe('AI blocks', () => {
  it('runAI returns a validated proposal; nothing is applied until accepted', async () => {
    const h = harness({
      ai: {
        success: true, provider: 'firebase', source: 'on_device', model: 'gemini-nano', latencyMs: 420, fallbackUsed: false,
        output: { customer: 'Meera', chest: 'xx', garment: 'Kurta', amount: 999, evil: 'drop me' },
      },
    });
    const s = (await dispatchAction(h.env(), createRuntimeState(tailor), 'go_new')).state;
    const r = await dispatchAction(h.env(), s, 'read_slip');
    expect(h.pickImage).toHaveBeenCalledOnce();
    expect(h.runAIBlock).toHaveBeenCalledWith(expect.objectContaining({ blockId: 'slip', image: { mimeType: 'image/jpeg', base64: 'AAAA' } }));
    expect(r.state).toBe(s); // form untouched
    const effect = r.effects[0];
    expect(effect.type).toBe('aiProposal');
    if (effect.type !== 'aiProposal') return;
    expect(effect.proposal.source).toBe('on_device');
    expect(effect.proposal.values).toEqual({ customer: 'Meera', garment: 'Kurta' }); // amount not in block.fields
    expect(effect.proposal.rejected).toEqual([{ field: 'chest', reason: 'Chest must be a number' }]);

    const accepted = acceptProposal(h.env(), s, effect.proposal);
    expect(accepted.state.forms.new).toMatchObject({ customer: 'Meera', garment: 'Kurta' });
    expect(accepted.effects).toContainEqual({ type: 'toast', message: 'Slip read', tone: 'success' });
  });

  it('offline cloud-preferred blocks report Offline without picking a photo or calling AI', async () => {
    const h = harness({ online: false });
    const r = await runAIBlockFlow(h.env(), navigate(tailor, createRuntimeState(tailor), 'new')!, 'slip');
    expect(h.pickImage).not.toHaveBeenCalled();
    expect(h.runAIBlock).not.toHaveBeenCalled();
    expect(r.effects[0]).toMatchObject({ type: 'aiUnavailable', badge: 'offline' });
  });

  it('provider failures surface an honest badge and message', async () => {
    const h = harness({ ai: { success: false, provider: 'firebase', source: 'cloud', latencyMs: 9, fallbackUsed: true, errorCode: 'timeout' } });
    const r = await runAIBlockFlow(h.env(), navigate(tailor, createRuntimeState(tailor), 'new')!, 'slip');
    expect(r.effects[0]).toMatchObject({ type: 'aiUnavailable', badge: 'cloud', message: 'The AI took too long. Please try again.' });
  });
});

describe('navigation', () => {
  it('stack stays bounded when screens are revisited', () => {
    let s = createRuntimeState(tailor);
    for (let i = 0; i < 10; i++) s = navigate(tailor, navigate(tailor, s, 'new')!, 'home')!;
    expect(s.stack).toEqual(['home']);
    expect(navigate(tailor, s, 'nowhere')).toBeUndefined();
  });
});

describe('theme, access modes and contrast guard', () => {
  it('Simple Mode hides secondary components without touching the spec', () => {
    const before = JSON.stringify(tailor);
    const home = tailor.screens[0];
    expect(visibleChildren(home, NO_MODES).map((c) => c.id)).not.toContain('hidden');
    expect(visibleChildren(home, NO_MODES).map((c) => c.id)).toContain('tips');
    expect(visibleChildren(home, { ...NO_MODES, simple: true }).map((c) => c.id)).not.toContain('tips');
    // A list's `secondary` is its second-line field id, not the Simple Mode flag.
    expect(visibleChildren(home, { ...NO_MODES, simple: true }).map((c) => c.id)).toContain('orders_list');
    resolveAppTheme(tailor.theme, { large: true, highContrast: true, simple: true, readAloud: true, leftHanded: true });
    expect(JSON.stringify(tailor)).toBe(before);
  });

  it('Large Mode scales fonts ×1.5 and targets to 64px; left-handed mirrors', () => {
    const normal = resolveAppTheme(tailor.theme, NO_MODES);
    const large = resolveAppTheme(tailor.theme, { ...NO_MODES, large: true, leftHanded: true });
    expect(normal.target).toBe(48);
    expect(large.target).toBe(64);
    expect(large.fontScale).toBeCloseTo(normal.fontScale * 1.5);
    // 16 px body text becomes 24 px (docs/10 §4.1) when the app theme is at its default scale.
    expect(Math.round(16 * resolveAppTheme({ ...tailor.theme, fontScale: 1 }, { ...NO_MODES, large: true }).fontScale)).toBe(24);
    expect(large.mirror).toBe(true);
    expect(normal.mirror).toBe(false);
  });

  it('Large Mode never exceeds the font scale cap, even on a large app theme', () => {
    expect(resolveAppTheme({ ...tailor.theme, fontScale: 1.6 }, { ...NO_MODES, large: true }).fontScale).toBe(2.2);
  });

  it('Large Mode body text is at least 24 px, even when the app theme is set small (docs/10 §4.1)', () => {
    // The in-app editor offers "Small" at 0.9, and "make text smaller" by voice goes down to 0.8.
    for (const fontScale of [0.8, 0.9, 1, 1.2, 1.6]) {
      const t = resolveAppTheme({ ...tailor.theme, fontScale }, { ...NO_MODES, large: true });
      expect(Math.round(16 * t.fontScale)).toBeGreaterThanOrEqual(24);
      expect(t.fontScale).toBeLessThanOrEqual(2.2);
    }
    expect(resolveAppTheme({ ...tailor.theme, fontScale: 0.8 }, { ...NO_MODES, large: true }).fontScale).toBe(1.5);
    // Above the floor, a bigger app theme still gets bigger.
    expect(resolveAppTheme({ ...tailor.theme, fontScale: 1.2 }, { ...NO_MODES, large: true }).fontScale).toBeCloseTo(1.8);
  });

  it('without Large Mode the app theme font scale is used as it is', () => {
    expect(resolveAppTheme({ ...tailor.theme, fontScale: 0.8 }, NO_MODES).fontScale).toBe(0.8);
    expect(resolveAppTheme({ ...tailor.theme, fontScale: 1.6 }, NO_MODES).fontScale).toBe(1.6);
  });

  it('Large Mode and High Contrast combine without losing either', () => {
    const t = resolveAppTheme(tailor.theme, { ...NO_MODES, large: true, highContrast: true });
    expect(t.target).toBe(64);
    expect(t.highContrast).toBe(true);
  });

  it('High Contrast overrides a low-contrast app theme to AAA', () => {
    const t = resolveAppTheme({ primary: '#9FD3C7', text: '#B0B0B0', background: '#FFFFFF', radius: 8, fontScale: 1 }, { ...NO_MODES, highContrast: true });
    expect(t.colors.text).toBe('#000000');
    expect(contrastRatio(t.colors.onPrimary, t.colors.primary)).toBeGreaterThanOrEqual(7);
    expect(t.borderWidth).toBe(2);
  });

  it('contrast guard lifts text and button colours to ≥ 4.5:1', () => {
    const t = resolveAppTheme(
      { primary: '#FFE066', text: '#AAAAAA', background: '#FFFFFF', surface: '#F5F5F5', radius: 8, fontScale: 1 }, NO_MODES,
    );
    expect(contrastRatio(t.colors.text, t.colors.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(t.colors.text, t.colors.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(t.colors.onPrimary, t.colors.primary)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(t.colors.primaryText, t.colors.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(t.colors.textMuted, t.colors.surface)).toBeGreaterThanOrEqual(4.5);
    // Dark themes are guarded in the other direction.
    const dark = resolveAppTheme({ primary: '#315C4C', text: '#333333', background: '#111111', surface: '#1A1A1A', radius: 8, fontScale: 1 }, NO_MODES);
    expect(contrastRatio(dark.colors.text, dark.colors.background)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('input parsing', () => {
  it('parses numbers leniently but safely', () => {
    expect(parseNumber('12,5')).toBe(12.5);
    expect(parseNumber(' 1 200 ')).toBe(1200);
    expect(parseNumber('1e3')).toBe(1000);
    expect(parseNumber('12abc')).toBeUndefined();
    expect(parseNumber('')).toBeUndefined();
    expect(isoDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});
