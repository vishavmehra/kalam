/**
 * An action's record writes run as ONE transaction (docs/09 §7.3, docs/05 §7.8): all of them or none, and the follow-up
 * (`then`: feedback, speak, navigate) only after the writes went through. Checked on a repository with `batch` (the local
 * database) and on one without it (the fallback that undoes what it did).
 */
import { describe, expect, it, vi } from 'vitest';
import type { RecordOp, RecordRepository, RuntimeServices } from '@/core/contracts';
import { kalamSpecSchema, type KalamSpec } from '@/core/spec/schema';
import { engineText } from '@/i18n/engine-messages';
import {
  commitWrites, createMemoryStores, createRuntimeState, currentScreen, dispatchAction, navigate, setFieldValue, toggleRecordField,
  type DataSnapshot, type EngineEnv, type RuntimeState,
} from './index';
import { v11Words } from './v11/copy';

const NOW = new Date(2026, 10, 25, 10, 0);

const spec: KalamSpec = kalamSpecSchema.parse({
  id: 'app_tasks', schemaVersion: '1.1.0', version: 1, name: 'Tasks', lang: 'en',
  theme: { primary: '#315C4C', radius: 12, fontScale: 1 },
  collections: { tasks: { label: 'Tasks', fields: { title: { type: 'text', label: 'Title', required: true }, done: { type: 'boolean', label: 'Done' } } } },
  screens: [
    {
      id: 'home', title: 'Tasks', form: 'tasks', children: [
        { id: 'title_in', type: 'textInput', label: 'Title', field: 'title' },
        { id: 'save_btn', type: 'bigButton', label: 'Save', action: 'save' },
        { id: 'list', type: 'list', source: 'tasks', primary: 'title', toggleField: 'done', allowDelete: true, detailScreen: 'edit' },
      ],
    },
    {
      id: 'edit', title: 'Edit', form: 'tasks', children: [
        { id: 'title_ed', type: 'textInput', label: 'Title', field: 'title' },
        { id: 'update_btn', type: 'bigButton', label: 'Update', action: 'update' },
        { id: 'delete_btn', type: 'bigButton', label: 'Delete', action: 'remove' },
      ],
    },
    { id: 'thanks', title: 'Thanks', children: [{ id: 'thanks_text', type: 'text', label: 'Saved.' }] },
  ],
  initialScreen: 'home',
  actions: {
    save: { type: 'insert', collection: 'tasks', then: { feedback: 'Task saved', navigate: 'thanks' } },
    update: { type: 'update', collection: 'tasks', record: 'selected', then: { feedback: 'Task changed' } },
    remove: { type: 'delete', collection: 'tasks', record: 'selected', confirm: 'Delete this task?' },
  },
  aiBlocks: {}, intents: {}, meta: { createdAt: 0 },
});

type Mode = 'with batch' | 'without batch';

function harness(mode: Mode, opts: { failWith?: Error } = {}) {
  const stores = createMemoryStores(spec.id);
  const base = stores.records;
  const calls = { batch: vi.fn<(appId: string, ops: RecordOp[]) => Promise<void>>(), insert: vi.fn(), update: vi.fn(), remove: vi.fn() };
  const fail = opts.failWith;
  const records: RecordRepository = {
    ...base,
    async insert(a, c, v) {
      calls.insert(a, c, v);
      if (fail) throw fail;
      return base.insert(a, c, v);
    },
    async update(a, c, id, v) {
      calls.update(a, c, id, v);
      if (fail) throw fail;
      return base.update(a, c, id, v);
    },
    async remove(a, c, id) {
      calls.remove(a, c, id);
      if (fail) throw fail;
      return base.remove(a, c, id);
    },
    batch: mode === 'with batch'
      ? async (a, ops) => {
        calls.batch(a, ops);
        if (fail) throw fail;
        return base.batch!(a, ops);
      }
      : undefined,
  };
  const services = {
    ...stores, records, confirm: vi.fn(async () => true), speak: vi.fn(), online: () => true, pickImage: vi.fn(), runAIBlock: vi.fn(),
  } as unknown as RuntimeServices;
  const data: DataSnapshot = { records: {}, state: {} };
  const env = (): EngineEnv => ({ spec, appId: spec.id, services, data, now: NOW });
  const reload = async () => {
    data.records = await base.listAll(spec.id);
  };
  const titles = async () => (await base.list(spec.id, 'tasks')).map((r) => r.values.title);
  return { env, reload, data, calls, base, titles };
}

const fill = (state: RuntimeState, screen: string, values: Record<string, string>) =>
  Object.entries(values).reduce((s, [k, v]) => setFieldValue(spec, s, screen, k, v, NOW), state);
const toasts = (effects: { type: string; message?: string }[]) => effects.filter((e) => e.type === 'toast').map((e) => e.message);

describe.each<Mode>(['with batch', 'without batch'])('an action that writes, on a repository %s', (mode) => {
  it('saves the entry, then runs its follow-up: feedback and the screen change', async () => {
    const h = harness(mode);
    const res = await dispatchAction(h.env(), fill(createRuntimeState(spec), 'home', { title: 'Pay rent' }), 'save');
    expect(res.ok).toBe(true);
    expect(await h.titles()).toEqual(['Pay rent']);
    expect(toasts(res.effects)).toEqual(['Task saved']);
    expect(currentScreen(spec, res.state).id).toBe('thanks');
  });

  it('writes nothing and runs no follow-up when the write is refused', async () => {
    const h = harness(mode, { failWith: new Error('disk full') });
    const start = fill(createRuntimeState(spec), 'home', { title: 'Pay rent' });
    const res = await dispatchAction(h.env(), start, 'save');
    expect(res.ok).toBe(false);
    expect(res.error).toBe('storage_failed');
    expect(await h.titles()).toEqual([]);
    // No "Task saved" and no move to the thanks screen for a save that did not happen; what was typed stays.
    expect(toasts(res.effects)).toEqual([engineText('en', 'saveFailed')]);
    expect(currentScreen(spec, res.state).id).toBe('home');
    expect(res.state).toBe(start);
  });

  it('updates the opened entry and keeps what was not edited', async () => {
    const h = harness(mode);
    const row = await h.base.insert(spec.id, 'tasks', { title: 'Old', done: true });
    await h.reload();
    let st = navigate(spec, createRuntimeState(spec), 'edit') as RuntimeState;
    st = { ...st, selection: { collection: 'tasks', recordId: row.id } };
    const res = await dispatchAction(h.env(), fill(st, 'edit', { title: 'New' }), 'update');
    expect(res.ok).toBe(true);
    expect((await h.base.list(spec.id, 'tasks'))[0].values).toEqual({ title: 'New', done: true });
    expect(toasts(res.effects)).toEqual(['Task changed']);
  });

  it('deletes the opened entry only after the person said yes, and keeps it when the delete is refused', async () => {
    const h = harness(mode);
    const row = await h.base.insert(spec.id, 'tasks', { title: 'Keep me' });
    await h.reload();
    let st = navigate(spec, createRuntimeState(spec), 'edit') as RuntimeState;
    st = { ...st, selection: { collection: 'tasks', recordId: row.id } };
    const refusing = harness(mode, { failWith: new Error('locked') });
    await refusing.base.insert(spec.id, 'tasks', { title: 'Keep me' });
    await refusing.reload();
    const stuck = await dispatchAction(refusing.env(), { ...st, selection: { collection: 'tasks', recordId: (await refusing.base.list(spec.id, 'tasks'))[0].id } }, 'remove');
    expect(stuck.ok).toBe(false);
    expect(toasts(stuck.effects)).toEqual([engineText('en', 'deleteFailed')]);
    expect(await refusing.titles()).toEqual(['Keep me']);

    const res = await dispatchAction(h.env(), st, 'remove');
    expect(res.ok).toBe(true);
    expect(await h.titles()).toEqual([]);
  });

  it('flips a checklist box as one write, or leaves it as it was', async () => {
    const h = harness(mode);
    const row = await h.base.insert(spec.id, 'tasks', { title: 'Tick', done: false });
    await h.reload();
    const res = await toggleRecordField(h.env(), createRuntimeState(spec), 'tasks', row.id, 'done');
    expect(res.ok).toBe(true);
    expect((await h.base.list(spec.id, 'tasks'))[0].values.done).toBe(true);

    const failing = harness(mode, { failWith: new Error('locked') });
    const kept = await failing.base.insert(spec.id, 'tasks', { title: 'Tick', done: false });
    await failing.reload();
    const bad = await toggleRecordField(failing.env(), createRuntimeState(spec), 'tasks', kept.id, 'done');
    expect(bad.ok).toBe(false);
    expect((await failing.base.list(spec.id, 'tasks'))[0].values.done).toBe(false);
  });
});

describe('the one transaction itself', () => {
  it('hands a repository that has batch exactly one batch for an action, and tells listeners once', async () => {
    const h = harness('with batch');
    let heard = 0;
    h.base.subscribe(spec.id, () => heard++);
    await dispatchAction(h.env(), fill(createRuntimeState(spec), 'home', { title: 'One' }), 'save');
    expect(h.calls.batch).toHaveBeenCalledTimes(1);
    expect(h.calls.batch.mock.calls[0][1]).toEqual([{ op: 'insert', collection: 'tasks', values: { title: 'One', done: false } }]);
    expect(h.calls.insert).not.toHaveBeenCalled();
    expect(heard).toBe(1);
  });

  it('uses the plain write on a repository without batch', async () => {
    const h = harness('without batch');
    await dispatchAction(h.env(), fill(createRuntimeState(spec), 'home', { title: 'One' }), 'save');
    expect(h.calls.insert).toHaveBeenCalledTimes(1);
    expect(h.calls.batch).not.toHaveBeenCalled();
  });

  it('writes a sequence of steps all or none: the first step is taken back when the second is refused', async () => {
    for (const mode of ['with batch', 'without batch'] as const) {
      const h = harness(mode);
      const row = await h.base.insert(spec.id, 'tasks', { title: 'Before', done: false });
      const steps: RecordOp[] = [
        { op: 'insert', collection: 'tasks', values: { title: 'Second' } },
        { op: 'update', collection: 'tasks', id: row.id, values: { title: 'Changed' } },
        { op: 'update', collection: 'tasks', id: 'missing', values: { title: 'Nope' } },
      ];
      const refused = await commitWrites(h.env(), createRuntimeState(spec), steps, 'saveFailed');
      expect(refused?.ok, mode).toBe(false);
      expect(refused?.error, mode).toBe('storage_failed');
      expect(await h.titles(), mode).toEqual(['Before']);
    }
  });

  it('says so plainly when something stayed because a delete cannot be taken back', async () => {
    const h = harness('without batch');
    const row = await h.base.insert(spec.id, 'tasks', { title: 'Gone soon' });
    const refused = await commitWrites(h.env(), createRuntimeState(spec), [
      { op: 'remove', collection: 'tasks', id: row.id },
      { op: 'update', collection: 'tasks', id: 'missing', values: { title: 'Nope' } },
    ], 'saveFailed');
    expect(refused?.ok).toBe(false);
    expect(refused?.effects).toEqual([{ type: 'toast', message: v11Words('en').deletePartly, tone: 'error' }]);
  });

  it('gives back undefined when every step went through', async () => {
    const h = harness('with batch');
    expect(await commitWrites(h.env(), createRuntimeState(spec), [{ op: 'insert', collection: 'tasks', values: { title: 'A' } }], 'saveFailed')).toBeUndefined();
    expect(await commitWrites(h.env(), createRuntimeState(spec), [], 'saveFailed')).toBeUndefined();
    expect(await h.titles()).toEqual(['A']);
  });
});
