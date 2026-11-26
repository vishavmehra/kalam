import { describe, expect, it } from 'vitest';
import { fixtureSpec, PNG_BASE64 } from '@/core/backup/test-fixtures';
import type { AIExecutionResult, CreationResult, NetworkMonitor, NormalizedImage, RecordValue, StoredApp, StoredBlob } from '@/core/contracts';
import { createMemoryOperationStore, createOperationQueue, QueueError, type PendingOperation } from '@/core/queue';
import type { CreationDraft } from '@/features/input/normalize';
import { aiOffer } from './ai-offer';
import { createQueueActions, requestSends } from './actions';
import { describeOperation, pillMessage, summarize } from './describe';
import { createQueueHandlers, type HandlerDeps } from './handlers';
import { buildSends, prepareBuild, readAiStepResult, readBuildResult, readTranslateResult, restoreBuild } from './snapshot';

const SECRET = 'SENTINEL-QUEUE-731';
const img = (id: string, source: NormalizedImage['source'] = 'photo'): NormalizedImage => ({
  id, mimeType: 'image/png', base64: `${PNG_BASE64}${id}`.slice(0, 80), width: 10, height: 10, source,
});
const draft = (patch: Partial<CreationDraft> = {}): CreationDraft => ({
  text: `A tailoring app ${SECRET}`, photos: [img('p1'), img('p2')], preferences: { language: 'en', currency: 'INR' },
  voice: { transcript: 'add customers', recognizedBy: 'on_device', durationSec: 3 },
  video: { name: 'clip', durationSec: 5, droppedFrames: 1, frames: [img('f1', 'video_frame')] },
  drawing: {
    title: 'Sketch',
    summary: { drawingId: 'drw_1', pageCount: 1, elements: [{ kind: 'box', page: 0, bbox: [0, 0, 1, 1], label: 'Name' }], texts: ['Name'], images: [img('d1', 'drawing')] },
  },
  ...patch,
});

/** A blob store in memory with the two calls the actions use, plus the reads the handlers use. */
function blobStore() {
  const rows = new Map<string, StoredBlob>();
  return {
    rows,
    put: async (b: Omit<StoredBlob, 'createdAt' | 'bytes'>) => {
      const row = { ...b, createdAt: 1, bytes: b.base64.length };
      rows.set(b.id, row);
      return row;
    },
    get: async (id: string) => rows.get(id),
    removeByOwner: async (owner: string) => {
      let n = 0;
      for (const [id, b] of [...rows]) {
        if (b.ownerId !== owner) continue;
        rows.delete(id);
        n++;
      }
      return n;
    },
  };
}

describe('build snapshot', () => {
  it('round-trips the whole draft; pictures live in files, not in the row', async () => {
    const blobs = blobStore();
    const built = prepareBuild(draft(), 'op_a');
    expect(built.files.map((f) => f.blobId)).toEqual(['op_a.0', 'op_a.1', 'op_a.2', 'op_a.3']);
    expect(built.snapshot).not.toContain(PNG_BASE64.slice(0, 30));
    for (const f of built.files) await blobs.put({ id: f.blobId, kind: f.kind, mimeType: f.mimeType, base64: f.base64, ownerId: 'op_a' });
    const back = await restoreBuild(built.snapshot, blobs.get);
    expect(back?.text).toContain(SECRET);
    expect(back?.photos.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(back?.video?.frames.map((p) => p.id)).toEqual(['f1']);
    expect(back?.drawing?.summary.images.map((p) => p.id)).toEqual(['d1']);
    expect(back?.drawing?.summary.elements[0]?.label).toBe('Name');
    expect(back?.voice?.transcript).toBe('add customers');
    expect(back?.preferences).toEqual({ language: 'en', currency: 'INR' });
  });

  it('keeps what the person said about the video steps', async () => {
    const blobs = blobStore();
    const d = draft({ video: { ...draft().video!, summary: 'Step 1: open the drawer. Step 2: count the cash.' } });
    const built = prepareBuild(d, 'op_v');
    for (const f of built.files) await blobs.put({ id: f.blobId, kind: f.kind, mimeType: f.mimeType, base64: f.base64, ownerId: 'op_v' });
    const back = await restoreBuild(built.snapshot, blobs.get);
    expect(back?.video?.summary).toBe('Step 1: open the drawer. Step 2: count the cash.');
  });

  it('the same draft gives the same key whatever the operation id; a different one does not', () => {
    expect(prepareBuild(draft(), 'op_a').dedupeKey).toBe(prepareBuild(draft(), 'op_b').dedupeKey);
    expect(prepareBuild(draft({ text: 'other' }), 'op_a').dedupeKey).not.toBe(prepareBuild(draft(), 'op_a').dedupeKey);
    expect(prepareBuild(draft(), 'op_a').dedupeKey.length).toBeLessThanOrEqual(80);
  });

  it('says what it sends, in categories', () => {
    expect(buildSends(draft())).toEqual(['text', 'photos', 'voice_text', 'video_frames', 'drawing']);
    expect(buildSends(draft({ photos: [], voice: undefined, video: undefined, drawing: undefined }))).toEqual(['text']);
  });

  it('refuses an empty draft, and a snapshot whose picture is gone or not a picture', async () => {
    expect(() => prepareBuild(draft({ text: '', photos: [], voice: undefined, video: undefined, drawing: undefined }), 'op_a')).toThrow();
    const built = prepareBuild(draft(), 'op_a');
    expect(await restoreBuild(built.snapshot, async () => undefined)).toBeUndefined();
    expect(await restoreBuild(built.snapshot, async () => ({ mimeType: 'text/html', base64: 'x' }))).toBeUndefined();
    expect(await restoreBuild('{"v":1}', async () => undefined)).toBeUndefined();
    expect(await restoreBuild('not json', async () => undefined)).toBeUndefined();
    expect(await restoreBuild(undefined, async () => undefined)).toBeUndefined();
  });
});

describe('actions', () => {
  function setup(online = false) {
    const store = createMemoryOperationStore();
    const blobs = blobStore();
    let isOnline = online;
    const network: NetworkMonitor = { online: () => isOnline, subscribe: () => () => undefined };
    let n = 0;
    const queue = createOperationQueue({ store, network, handlers: {}, newId: () => `op_${++n}` });
    let ids = 0;
    const actions = createQueueActions({ queue, blobs, newId: () => `op_files${++ids}` });
    return { store, blobs, queue, actions };
  }

  it('compile: stores the pictures under the operation id and the row without them', async () => {
    const t = setup();
    const op = await t.actions.compile(draft());
    expect(op.id).toBe('op_files1');
    expect(op.status).toBe('waiting_for_network');
    expect(op.sends).toEqual(['text', 'photos', 'voice_text', 'video_frames', 'drawing']);
    expect([...t.blobs.rows.values()].every((b) => b.ownerId === op.id)).toBe(true);
    expect(t.blobs.rows.size).toBe(4);
  });

  it('compile twice with the same draft: one operation, and the second set of files is removed', async () => {
    const t = setup();
    const a = await t.actions.compile(draft());
    const b = await t.actions.compile(draft());
    expect(b.id).toBe(a.id);
    expect([...t.blobs.rows.values()].every((x) => x.ownerId === a.id)).toBe(true);
    expect(t.blobs.rows.size).toBe(4);
  });

  it('compile: a file that cannot be stored stops it and leaves no files behind', async () => {
    const t = setup();
    let puts = 0;
    const flaky = { ...t.blobs, put: async (b: Parameters<typeof t.blobs.put>[0]) => (++puts === 3 ? Promise.reject(new Error('too large')) : t.blobs.put(b)) };
    const actions = createQueueActions({ queue: t.queue, blobs: flaky, newId: () => 'op_x' });
    await expect(actions.compile(draft())).rejects.toThrow('too large');
    expect(t.blobs.rows.size).toBe(0);
    expect(await t.queue.list()).toEqual([]);
  });

  it('compile: an empty draft is refused', async () => {
    const t = setup();
    await expect(t.actions.compile(draft({ text: '', photos: [], voice: undefined, video: undefined, drawing: undefined }))).rejects.toBeInstanceOf(QueueError);
  });

  it('translate: queued once per app and language; a bad language is refused', async () => {
    const t = setup();
    const a = await t.actions.translate('app_1', 'hi');
    const b = await t.actions.translate('app_1', 'hi');
    const c = await t.actions.translate('app_1', 'ta');
    expect(b.id).toBe(a.id);
    expect(c.id).not.toBe(a.id);
    expect(a.params).toEqual({ lang: 'hi' });
    await expect(t.actions.translate('app_1', 'hi; drop')).rejects.toMatchObject({ code: 'invalid_operation' });
  });

  it('ai step: keeps the typed text in the row and a picture in a file; nothing without input', async () => {
    const t = setup();
    const text = await t.actions.aiStep({ appId: 'app_1', blockId: 'summarize', input: `note ${SECRET}` });
    expect(text.sends).toEqual(['ai_input']);
    expect(text.params).toEqual({ blockId: 'summarize' });
    expect(text.snapshot).toContain(SECRET);
    const photo = await t.actions.aiStep({ appId: 'app_1', blockId: 'scan', image: { mimeType: 'image/png', base64: PNG_BASE64 } });
    expect(photo.sends).toEqual(['ai_photo']);
    expect(t.blobs.rows.get(`${photo.id}.image`)?.ownerId).toBe(photo.id);
    await expect(t.actions.aiStep({ appId: 'app_1', blockId: 'x' })).rejects.toBeInstanceOf(QueueError);
  });

  it('the row never holds more than references and small settings', async () => {
    const t = setup();
    const op = await t.actions.translate('app_1', 'hi');
    expect(Object.keys(op).sort()).toEqual(['appId', 'createdAt', 'dedupeKey', 'id', 'kind', 'params', 'payloadRef', 'retryCount', 'sends', 'status', 'updatedAt']);
  });
});

// ─── Handlers, driven through the real queue ─────────────────────────────────
const app = (spec = fixtureSpec()): StoredApp => ({ id: spec.id, spec, createdAt: 1, updatedAt: 1, origin: { route: 'manual' } });

function world(opts: { create?: HandlerDeps['createApplication']; translate?: HandlerDeps['translate']; run?: HandlerDeps['aiBlocks']['run']; apps?: StoredApp[] } = {}) {
  let online = false;
  const listeners = new Set<(o: boolean) => void>();
  const network: NetworkMonitor = { online: () => online, subscribe: (l) => (listeners.add(l), () => void listeners.delete(l)) };
  const store = createMemoryOperationStore();
  const blobs = blobStore();
  const apps = new Map((opts.apps ?? [app()]).map((a) => [a.id, a]));
  const handlers = createQueueHandlers({
    apps: { get: async (id) => apps.get(id) },
    blobs,
    network,
    createApplication: opts.create ?? (async () => ({ ok: false } as CreationResult)),
    translate: opts.translate,
    aiBlocks: { run: opts.run ?? (async () => ({ success: false } as AIExecutionResult<Record<string, RecordValue>>)) },
  });
  const queue = createOperationQueue({ store, network, handlers, cleanup: async (o) => void (await blobs.removeByOwner(o.id)) });
  const actions = createQueueActions({ queue, blobs });
  return {
    store, blobs, queue, actions,
    go(next: boolean) {
      online = next;
      for (const l of [...listeners]) l(next);
    },
  };
}

const built = (): CreationResult => ({
  ok: true, spec: fixtureSpec(), route: 'cloud', provider: 'firebase', warnings: [], errors: [], latencyMs: 5,
  classification: { taskType: 'create_app', complexity: 'complex', estimatedScreens: 2, estimatedCollections: 1, estimatedActions: 1, requiresMultimodalReasoning: false, requiresCloudReasoning: true, confidence: 1, method: 'deterministic', reasons: [] },
});

describe('queued build, end to end', () => {
  it('offline it waits; online it builds from the frozen draft; the result is read back checked; removing it frees the files', async () => {
    let seen: { text: string; images: number } | undefined;
    const w = world({ create: async (input) => ((seen = { text: input.text, images: input.images.length }), built()) });
    await w.queue.start();
    const op = await w.actions.compile(draft());
    expect(op.status).toBe('waiting_for_network');
    w.go(true);
    await w.queue.pump();
    const done = (await w.store.get(op.id))!;
    expect(done.status).toBe('completed');
    expect(seen).toEqual({ text: expect.stringContaining(SECRET), images: 2 });
    expect(done.snapshot).toBeDefined(); // kept until the person opens or removes it
    expect(readBuildResult(done)?.spec?.name).toBe(fixtureSpec().name);
    const restored = await restoreBuild(done.snapshot, w.blobs.get);
    expect(restored?.photos).toHaveLength(2);
    await w.queue.dismiss(op.id);
    expect(w.blobs.rows.size).toBe(0);
  });

  it('a build that failed because the connection dropped goes back to waiting; one the model could not do stops', async () => {
    let calls = 0;
    const w = world({
      create: async () => (++calls === 1
        ? ({ ...built(), ok: false, spec: undefined, provider: 'none', compileAttempts: [{ pass: 'first', stage: 'model', category: 'NETWORK_UNAVAILABLE', issues: [], repairs: [] }] } as CreationResult)
        : ({ ...built(), ok: false, spec: undefined, provider: 'firebase' } as CreationResult)),
    });
    await w.queue.start();
    w.go(true);
    const op = await w.actions.compile(draft());
    await w.queue.pump();
    expect((await w.store.get(op.id))?.status).toBe('waiting_for_network');
    expect((await w.store.get(op.id))?.lastError).toBe('offline');
    w.go(false);
    w.go(true);
    await w.queue.pump();
    const row = (await w.store.get(op.id))!;
    expect(row.status).toBe('failed');
    expect(row.lastError).toBe('failed');
    expect(row.snapshot).toBeDefined(); // kept so Try again works
  });

  it('a result that is not a valid app is never handed on', () => {
    const op = (result: string): Pick<PendingOperation, 'kind' | 'status' | 'result'> => ({ kind: 'compile', status: 'completed', result });
    expect(readBuildResult(op(JSON.stringify({ ...built(), spec: { nonsense: true } })))).toBeUndefined();
    expect(readBuildResult(op('not json'))).toBeUndefined();
    expect(readBuildResult(op(JSON.stringify({ ...built(), ok: false })))).toBeUndefined();
    expect(readBuildResult({ kind: 'compile', status: 'failed', result: JSON.stringify(built()) })).toBeUndefined();
  });

  it('a build whose picture is gone fails with source_missing instead of building something else', async () => {
    let called = false;
    const w = world({ create: async () => ((called = true), built()) });
    await w.queue.start();
    const op = await w.actions.compile(draft());
    await w.blobs.removeByOwner(op.id);
    w.go(true);
    await w.queue.pump();
    expect((await w.store.get(op.id))?.lastError).toBe('source_missing');
    expect(called).toBe(false);
  });
});

describe('queued translation and AI step, end to end', () => {
  it('translate runs the translate service for that app and language, then reports a summary', async () => {
    const asked: Array<[string, string, boolean | undefined]> = [];
    const w = world({
      translate: { translateApp: async (spec, lang, o) => (asked.push([spec.id, lang, o?.preferCloud]), { ok: true, lang, source: 'cloud', cached: false, missing: ['a', 'b'] }) },
    });
    await w.queue.start();
    const op = await w.actions.translate(fixtureSpec().id, 'hi', { preferCloud: true });
    w.go(true);
    await w.queue.pump();
    const row = (await w.store.get(op.id))!;
    expect(row.status).toBe('completed');
    expect(asked).toEqual([[fixtureSpec().id, 'hi', true]]);
    expect(readTranslateResult(row)).toEqual({ lang: 'hi', missing: 2 });
    expect(describeOperation(row, true).detail).toEqual({ key: 'queue.detail.translateMissing', params: { count: 2 } });
  });

  it('translate for an app that was deleted fails with source_missing', async () => {
    const w = world({ apps: [], translate: { translateApp: async () => ({ ok: true, lang: 'hi', source: 'cloud', cached: false, missing: [] }) } });
    await w.queue.start();
    const op = await w.actions.translate('app_gone', 'hi');
    w.go(true);
    await w.queue.pump();
    expect((await w.store.get(op.id))?.lastError).toBe('source_missing');
  });

  it('an AI step reads the typed text for its step, wipes the text when done, and keeps the found values', async () => {
    const spec = fixtureSpec();
    const stepApp = app({ ...spec, aiBlocks: { summarize: { kind: 'summarize', inputField: 'notes', targetField: 'title', prompt: 'Short title', verified: 'cloudPreferred', onError: 'manual_entry' } } } as never);
    let got: { form: Record<string, RecordValue>; block: string } | undefined;
    const w = world({
      apps: [stepApp],
      run: async (i) => ((got = { form: i.formValues, block: i.blockId }), { success: true, output: { title: 'Tea' }, provider: 'firebase', source: 'cloud', latencyMs: 1, fallbackUsed: false }),
    });
    await w.queue.start();
    const op = await w.actions.aiStep({ appId: spec.id, blockId: 'summarize', input: `tea ${SECRET}` });
    w.go(true);
    await w.queue.pump();
    const row = (await w.store.get(op.id))!;
    expect(row.status).toBe('completed');
    expect(got).toEqual({ form: { notes: `tea ${SECRET}` }, block: 'summarize' });
    expect(row.snapshot).toBeUndefined(); // the typed text is gone
    expect(readAiStepResult(row)).toEqual({ blockId: 'summarize', output: { title: 'Tea' } });
  });

  it('an AI step that is offline when it runs waits again', async () => {
    const spec = fixtureSpec();
    const stepApp = app({ ...spec, aiBlocks: { summarize: { kind: 'summarize', inputField: 'notes', targetField: 'title', prompt: 'x', verified: 'cloudPreferred', onError: 'manual_entry' } } } as never);
    const w = world({ apps: [stepApp], run: async () => ({ success: false, errorCode: 'offline', provider: 'none', source: 'cloud', latencyMs: 0, fallbackUsed: false }) });
    await w.queue.start();
    const op = await w.actions.aiStep({ appId: spec.id, blockId: 'summarize', input: 'x' });
    w.go(true);
    await w.queue.pump();
    expect((await w.store.get(op.id))?.status).toBe('waiting_for_network');
  });
});

describe('words for the screen', () => {
  const row = (patch: Partial<PendingOperation>): PendingOperation => ({
    id: 'op_1', kind: 'translate', status: 'waiting_for_network', payloadRef: 'a', appId: 'a', dedupeKey: 'k', sends: ['labels'],
    params: { lang: 'hi' }, createdAt: 1, updatedAt: 1, retryCount: 0, ...patch,
  });

  it('offline and waiting: says so, can be cancelled, shows what it will send', () => {
    const v = describeOperation(row({}), false);
    expect(v.status).toBe('queue.status.waiting_for_network');
    expect(v.detail.key).toBe('queue.detail.waitingOffline');
    expect(v.canCancel).toBe(true);
    expect(v.canRetry).toBe(false);
    expect(v.sends).toEqual(['queue.sends.labels']);
  });

  it('online and waiting after a failed attempt: says it will try again', () => {
    expect(describeOperation(row({ retryCount: 2 }), true).detail).toEqual({ key: 'queue.detail.retrySoon', params: { count: 2 } });
  });

  it('failed: says why, offers Try again and Remove, no longer lists what it would send', () => {
    const v = describeOperation(row({ status: 'failed', lastError: 'cloud_off', retryCount: 1 }), true);
    expect(v.problem).toBe('queue.error.cloud_off');
    expect(v.canRetry && v.canRemove && !v.canCancel).toBe(true);
    expect(v.sends).toEqual([]);
  });

  it('completed: a build opens review, others open the app', () => {
    expect(describeOperation(row({ kind: 'compile', status: 'completed' }), true).open).toBe('review');
    expect(describeOperation(row({ kind: 'ai_step', status: 'completed' }), true).open).toBe('app');
    expect(describeOperation(row({ status: 'processing' }), true).open).toBeUndefined();
  });

  it('the pill shows waiting work first, then stopped, then finished, and nothing for an empty queue', () => {
    const rows = [row({ id: 'a', status: 'completed' }), row({ id: 'b', status: 'failed' }), row({ id: 'c' }), row({ id: 'd', status: 'ready' })];
    expect(pillMessage(summarize(rows))).toEqual({ key: 'queue.pill.active', count: 2, tone: 'info' });
    expect(pillMessage(summarize(rows.slice(0, 2)))).toEqual({ key: 'queue.pill.failed', count: 1, tone: 'warning' });
    expect(pillMessage(summarize(rows.slice(0, 1)))).toEqual({ key: 'queue.pill.done', count: 1, tone: 'success' });
    expect(pillMessage(summarize([]))).toBeUndefined();
  });
});

describe('aiOffer: what an offline AI step queues', () => {
  const base = { appId: 'app_a', blockId: 'b1' };
  const picture = { mimeType: 'image/png' as const, base64: PNG_BASE64 };

  it('a text step sends the typed text from its inputField, trimmed', () => {
    expect(aiOffer({ ...base, block: { kind: 'summarise', inputField: 'notes' }, form: { notes: '  long note  ' } }))
      .toEqual({ state: 'ready', request: { kind: 'ai_step', appId: 'app_a', blockId: 'b1', input: 'long note' } });
  });

  it('a text step with nothing typed offers nothing', () => {
    expect(aiOffer({ ...base, block: { kind: 'classify', inputField: 'notes' }, form: { notes: '   ' } })).toEqual({ state: 'none' });
    expect(aiOffer({ ...base, block: { kind: 'classify', inputField: 'notes' }, form: {} })).toEqual({ state: 'none' });
  });

  it('a photo step has no inputField: it sends the picture, or asks for one first', () => {
    const block = { kind: 'extractFromPhoto' };
    expect(aiOffer({ ...base, block, form: { notes: 'ignored' } })).toEqual({ state: 'needsPicture' });
    const offer = aiOffer({ ...base, block, form: {}, image: picture });
    expect(offer).toEqual({ state: 'ready', request: { kind: 'ai_step', appId: 'app_a', blockId: 'b1', image: picture } });
    expect(offer.state === 'ready' && requestSends(offer.request)).toEqual(['ai_photo']);
  });

  it('a missing block offers nothing', () => {
    expect(aiOffer({ ...base, block: undefined, form: {} })).toEqual({ state: 'none' });
  });
});
