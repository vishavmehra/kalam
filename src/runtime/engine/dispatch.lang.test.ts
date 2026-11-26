import { describe, expect, it, vi } from 'vitest';
import type { AIExecutionResult, RecordValue, RuntimeServices } from '@/core/contracts';
import { kalamSpecSchema, type KalamSpec } from '@/core/spec/schema';
import { engineText } from '@/i18n/engine-messages';
import {
  acceptProposal, createMemoryStores, createRuntimeState, dispatchAction, navigate, runAIBlockFlow, setFieldValue,
  type AIProposal, type DataSnapshot, type EngineEnv, type RuntimeState,
} from './index';

const NOW = new Date(2026, 10, 25, 10, 0);

/** A Hindi app: the engine's own toasts and validation lines follow `spec.lang`, not Kalam's language. */
const ledger: KalamSpec = kalamSpecSchema.parse({
  id: 'app_khata', schemaVersion: '1.0.0', version: 1, name: 'Khata', lang: 'hi',
  theme: { primary: '#315C4C', radius: 12, fontScale: 1 },
  collections: {
    entries: {
      label: 'Entries',
      fields: {
        customer: { type: 'text', label: 'ग्राहक', required: true },
        amount: { type: 'number', label: 'रकम', min: 0 },
      },
    },
  },
  screens: [
    {
      id: 'home', title: 'Khata', form: 'entries', children: [
        { id: 'customer_in', type: 'textInput', label: 'ग्राहक', field: 'customer', required: true },
        { id: 'amount_in', type: 'number', label: 'रकम', field: 'amount' },
        { id: 'save_btn', type: 'bigButton', label: 'Save', action: 'save' },
        { id: 'list', type: 'list', source: 'entries', primary: 'customer', allowDelete: true, detailScreen: 'edit' },
      ],
    },
    {
      id: 'edit', title: 'Edit', form: 'entries', children: [
        { id: 'customer_ed', type: 'textInput', label: 'ग्राहक', field: 'customer', required: true },
        { id: 'update_btn', type: 'bigButton', label: 'Update', action: 'update' },
        { id: 'delete_btn', type: 'bigButton', label: 'Delete', action: 'remove' },
      ],
    },
  ],
  initialScreen: 'home',
  actions: {
    save: { type: 'insert', collection: 'entries' },
    update: { type: 'update', collection: 'entries', record: 'selected' },
    remove: { type: 'delete', collection: 'entries', record: 'selected', confirm: 'Delete this entry?' },
  },
  aiBlocks: {
    slip: { kind: 'extractFromPhoto', prompt: 'पर्ची पढ़ें', verified: 'cloudPreferred', target: 'entries', fields: ['customer', 'amount'] },
  },
  intents: {},
  meta: { createdAt: 0 },
});

function harness(opts: { online?: boolean; ai?: AIExecutionResult<Record<string, RecordValue>>; insert?: Error } = {}) {
  const stores = createMemoryStores(ledger.id);
  const failed = (): AIExecutionResult<Record<string, RecordValue>> =>
    ({ success: false, provider: 'firebase', source: 'cloud', latencyMs: 1, fallbackUsed: false, errorCode: 'timeout' });
  const services: RuntimeServices = {
    ...stores,
    ...(opts.insert ? { records: { ...stores.records, insert: async () => { throw opts.insert; }, batch: async () => { throw opts.insert; } } } : {}),
    runAIBlock: vi.fn(async () => opts.ai ?? failed()), pickImage: vi.fn(async () => ({ mimeType: 'image/jpeg' as const, base64: 'AAAA' })),
    confirm: vi.fn(async () => true), speak: vi.fn(), online: () => opts.online ?? true,
  };
  const data: DataSnapshot = { records: {}, state: {} };
  const env = (): EngineEnv => ({ spec: ledger, appId: ledger.id, services, data, now: NOW });
  const reload = async () => {
    data.records = await stores.records.listAll(ledger.id);
  };
  return { env, reload, data };
}

const fill = (state: RuntimeState, screen: string, values: Record<string, RecordValue>) =>
  Object.entries(values).reduce((s, [k, v]) => setFieldValue(ledger, s, screen, k, v, NOW), state);
const toastOf = (effects: { type: string; message?: string }[]) => effects.find((e) => e.type === 'toast')?.message;

describe('engine messages in the app language', () => {
  it('validates, saves, updates and deletes with Hindi messages', async () => {
    const h = harness();
    const start = createRuntimeState(ledger);

    const bad = await dispatchAction(h.env(), fill(start, 'home', { amount: '-5' }), 'save');
    expect(bad.ok).toBe(false);
    expect(bad.state.errors).toMatchObject({
      customer: engineText('hi', 'required', { label: 'ग्राहक' }),
      amount: engineText('hi', 'min', { label: 'रकम', min: 0 }),
    });
    // Two problems: the first one plus the count, said in Hindi.
    expect(toastOf(bad.effects)).toBe(engineText('hi', 'andMore', { first: engineText('hi', 'required', { label: 'ग्राहक' }), count: 1 }));
    expect(toastOf(bad.effects)).not.toMatch(/more/);

    const saved = await dispatchAction(h.env(), fill(start, 'home', { customer: 'आशा', amount: '20' }), 'save');
    expect(toastOf(saved.effects)).toBe(engineText('hi', 'saved'));
    expect(engineText('hi', 'saved')).not.toBe('Saved');
    await h.reload();
    const record = h.data.records.entries![0]!;

    let s: RuntimeState = { ...saved.state, selection: { collection: 'entries', recordId: record.id }, stack: ['home', 'edit'] };
    s = fill(s, 'edit', { customer: 'आशा बेन' });
    const updated = await dispatchAction(h.env(), s, 'update');
    expect(toastOf(updated.effects)).toBe(engineText('hi', 'updated'));

    const removed = await dispatchAction(h.env(), { ...updated.state, selection: { collection: 'entries', recordId: record.id }, stack: ['home', 'edit'] }, 'remove');
    expect(toastOf(removed.effects)).toBe(engineText('hi', 'deleted'));
  });

  it('says the failures in the app language too', async () => {
    const h = harness();
    const start = createRuntimeState(ledger);
    // Nothing chosen from the list yet.
    const none = await dispatchAction(h.env(), { ...start, stack: ['home', 'edit'] }, 'update');
    expect(toastOf(none.effects)).toBe(engineText('hi', 'noSelection'));
    expect(engineText('hi', 'noSelection')).not.toBe(engineText('en', 'noSelection'));
    // A chosen entry that is gone.
    const gone = await dispatchAction(
      h.env(), { ...start, selection: { collection: 'entries', recordId: 'rec_missing' }, stack: ['home', 'edit'] }, 'remove',
    );
    expect(toastOf(gone.effects)).toBe(engineText('hi', 'recordGone'));
  });
});

describe('the AI, counter and storage lines in the app language', () => {
  const messageOf = (r: { effects: Array<{ type: string; message?: string }> }) => r.effects.find((e) => e.message)?.message;
  const slipState = () => navigate(ledger, createRuntimeState(ledger), 'home')!;
  const withBlock = (onError?: 'manual_entry') => ({ ...ledger, aiBlocks: { slip: { ...ledger.aiBlocks.slip!, ...(onError ? { onError } : {}) } } }) as KalamSpec;

  it('says an AI failure in Hindi, and the manual hint is part of the same translated sentence', async () => {
    const h = harness();
    const r = await runAIBlockFlow(h.env(), slipState(), 'slip');
    expect(messageOf(r)).toBe(engineText('hi', 'aiTimeout'));
    expect(messageOf(r)).not.toMatch(/AI took/);

    const spec = withBlock('manual_entry');
    const m = await runAIBlockFlow({ ...h.env(), spec }, navigate(spec, createRuntimeState(spec), 'home')!, 'slip');
    expect(messageOf(m)).toBe(engineText('hi', 'manualEntry', { message: engineText('hi', 'aiTimeout') }));
    expect(messageOf(m)).not.toMatch(/Type it in yourself/);
  });

  it('says being offline in Hindi, before and after the AI is tried', async () => {
    const h = harness({ online: false });
    const before = await runAIBlockFlow(h.env(), slipState(), 'slip');
    expect(messageOf(before)).toBe(engineText('hi', 'aiOffline'));
    expect(h.env().services.runAIBlock).not.toHaveBeenCalled();
    expect(engineText('hi', 'aiOffline')).not.toBe(engineText('en', 'aiOffline'));
  });

  it('says a missing block, an empty result, an unknown button and a filled form in Hindi', async () => {
    const h = harness();
    expect(messageOf(await runAIBlockFlow(h.env(), slipState(), 'nope'))).toBe(engineText('hi', 'aiMissing'));
    expect(messageOf(await dispatchAction(h.env(), slipState(), 'nope'))).toBe(engineText('hi', 'unknownAction'));

    const empty = harness({ ai: { success: true, output: { evil: 'x' }, provider: 'firebase', source: 'cloud', latencyMs: 1, fallbackUsed: false } });
    expect(messageOf(await runAIBlockFlow(empty.env(), slipState(), 'slip'))).toBe(engineText('hi', 'aiNothingFound'));

    const proposal = (n: number): AIProposal => ({
      blockId: 'slip', screenId: 'home', source: 'cloud', provider: 'firebase', latencyMs: 1, rejected: [],
      values: n === 1 ? { customer: 'आशा' } : { customer: 'आशा', amount: 20 },
    });
    expect(messageOf(acceptProposal(h.env(), slipState(), proposal(1)))).toBe(engineText('hi', 'filledOne'));
    expect(messageOf(acceptProposal(h.env(), slipState(), proposal(2)))).toBe(engineText('hi', 'filledMany', { count: 2 }));
    expect(engineText('hi', 'filledMany', { count: 2 })).toContain('2');
  });

  it('says the two storage problems in Hindi instead of showing the store English text', async () => {
    const full = Object.assign(new Error('This list is full. It can hold 1,000 entries.'), { name: 'RecordLimitError', limit: 1000 });
    const a = harness({ insert: full });
    const r = await dispatchAction(a.env(), fill(createRuntimeState(ledger), 'home', { customer: 'आशा' }), 'save');
    expect(r.error).toBe('storage_failed');
    expect(toastOf(r.effects)).toBe(engineText('hi', 'recordLimit', { limit: 1000 }));
    expect(toastOf(r.effects)).not.toMatch(/list is full/);

    const shared = Object.assign(new Error('This entry comes from another app. Change it there.'), { name: 'SharedRecordReadOnlyError' });
    const b = harness({ insert: shared });
    const s = await dispatchAction(b.env(), fill(createRuntimeState(ledger), 'home', { customer: 'आशा' }), 'save');
    expect(toastOf(s.effects)).toBe(engineText('hi', 'sharedReadOnly'));

    const other = harness({ insert: new Error('disk exploded') });
    const o = await dispatchAction(other.env(), fill(createRuntimeState(ledger), 'home', { customer: 'आशा' }), 'save');
    expect(toastOf(o.effects)).toBe(engineText('hi', 'saveFailed'));
  });
});
