import { describe, expect, it } from 'vitest';
import type { AICacheRepository, StructuredRequest } from '../contracts';
import {
  CACHE_MAX_ENTRIES, CACHE_TTL_MS, CACHEABLE_TASKS, createResultCache, requestKey, stableStringify, type CachedAnswer, type KeyContext,
} from './cache';

const base: StructuredRequest<unknown> = {
  taskType: 'summarize', system: 'Summarise the notes.', prompt: 'Milk 2, bread 1', jsonSchema: { type: 'object', properties: { s: { type: 'string' } } },
  mode: 'prefer_on_device', parse: (raw) => ({ success: true, data: raw }),
};
const ctx: KeyContext = { taskType: 'summarize', role: 'ai_block', mode: 'prefer_on_device', appId: 'app-1', promptVersion: 'block-v1', model: 'gemini-3.5-flash-lite' };
const answer = (output: unknown): CachedAnswer => ({ output, provider: 'firebase', source: 'cloud', model: 'gemini-3.5-flash-lite' });

describe('stableStringify', () => {
  it('ignores key order and undefined members', () => {
    expect(stableStringify({ b: 1, a: [2, { d: 1, c: undefined, e: null }] })).toBe(stableStringify({ a: [2, { e: null, d: 1 }], b: 1 }));
    expect(stableStringify(undefined)).toBe('null');
  });
});

describe('requestKey', () => {
  it('is the same for the same request, whatever the key order of its schema', () => {
    const reordered = { ...base, jsonSchema: { properties: { s: { type: 'string' } }, type: 'object' } };
    expect(requestKey(base, ctx)).toBe(requestKey(reordered, ctx));
  });

  it('changes with the app, task, role, mode, prompt version, model, prompt, image or languages', () => {
    const key = requestKey(base, ctx);
    const variants: Array<[StructuredRequest<unknown>, KeyContext]> = [
      [base, { ...ctx, appId: 'app-2' }],
      [base, { ...ctx, appId: undefined }],
      [base, { ...ctx, taskType: 'classify' }],
      [base, { ...ctx, role: 'judge' }],
      [base, { ...ctx, mode: 'only_in_cloud' }],
      [base, { ...ctx, promptVersion: 'block-v2' }],
      [base, { ...ctx, model: 'gemini-3.8-flash' }],
      [base, { ...ctx, escalationReason: 'complex' }],
      [{ ...base, prompt: 'Milk 3' }, ctx],
      [{ ...base, images: [{ mimeType: 'image/png', base64: 'AAAA' }] }, ctx],
      [{ ...base, languages: ['es'] }, ctx],
      [{ ...base, temperature: 0.7 }, ctx],
    ];
    const keys = variants.map(([r, k]) => requestKey(r, k));
    for (const k of keys) expect(k).not.toBe(key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('holds only a hash: no prompt text, record values or image bytes', () => {
    const image = 'iVBORw0KGgoSECRETBYTES';
    const key = requestKey({ ...base, prompt: 'Salary 52000 for Asha', images: [{ mimeType: 'image/png', base64: image }] }, ctx);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain('Asha');
    expect(requestKey({ ...base, images: [{ mimeType: 'image/png', base64: image }] }, ctx))
      .not.toBe(requestKey({ ...base, images: [{ mimeType: 'image/png', base64: `${image}X` }] }, ctx));
  });

  it('reuses only tasks whose answer depends on the request alone', () => {
    expect([...CACHEABLE_TASKS].sort()).toEqual(['classify', 'extract_data', 'extract_template_params', 'summarize', 'translate']);
  });
});

/** In-memory stand-in for db.aiCache that can be made to fail. */
function store(opts: { fail?: boolean } = {}) {
  const data = new Map<string, unknown>();
  const sets: Array<{ key: string; meta: unknown }> = [];
  const repo: AICacheRepository = {
    get: async <T>(key: string) => {
      if (opts.fail) throw new Error('db closed');
      return data.get(key) as T | undefined;
    },
    set: async (key, value, meta) => {
      if (opts.fail) throw new Error('quota exceeded');
      data.set(key, value);
      sets.push({ key, meta });
    },
    clear: async () => data.clear(),
    size: async () => data.size,
  };
  return { repo, data, sets };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('result cache: LRU with a TTL', () => {
  it('keeps at most 500 entries and evicts the least recently used', async () => {
    const c = createResultCache({ now: () => 0 });
    expect(CACHE_MAX_ENTRIES).toBe(500);
    for (let i = 0; i < 500; i++) c.set(`k${i}`, answer(i), 'classify');
    expect(await c.get('k0')).toBeDefined(); // k0 is now the most recent
    c.set('k500', answer(500), 'classify');
    expect(c.size()).toBe(500);
    expect(await c.get('k1')).toBeUndefined(); // the oldest untouched entry went
    expect(await c.get('k0')).toEqual(answer(0));
    expect(await c.get('k500')).toEqual(answer(500));
  });

  it('forgets an answer after its TTL (a day by default)', async () => {
    let t = 0;
    const c = createResultCache({ now: () => t });
    c.set('k', answer('x'), 'summarize');
    t = CACHE_TTL_MS - 1;
    expect(await c.get('k')).toEqual(answer('x'));
    t = CACHE_TTL_MS;
    expect(await c.get('k')).toBeUndefined();
    expect(c.size()).toBe(0);
    expect(CACHE_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });

  it('writes through to db.aiCache with the task and source, and reads back in a new session', async () => {
    const s = store();
    createResultCache({ now: () => 0, store: s.repo }).set('k', answer({ s: 'ok' }), 'translate');
    await settle();
    expect(s.sets).toEqual([{ key: 'k', meta: { taskType: 'translate', source: 'cloud' } }]);
    const later = createResultCache({ now: () => 1000, store: s.repo });
    expect(await later.get('k')).toEqual(answer({ s: 'ok' }));
    expect(later.size()).toBe(1);
  });

  it('treats a stored value that is expired or malformed as a miss', async () => {
    const s = store();
    s.data.set('old', { v: 1, expiresAt: 10, output: 1, provider: 'firebase', source: 'cloud' });
    s.data.set('bad', { v: 1, expiresAt: 1e15, output: 1, provider: 'evil', source: 'cloud' });
    s.data.set('legacy', 'just a string');
    const c = createResultCache({ now: () => 100, store: s.repo });
    expect(await c.get('old')).toBeUndefined();
    expect(await c.get('bad')).toBeUndefined();
    expect(await c.get('legacy')).toBeUndefined();
  });

  it('never fails because the store fails', async () => {
    const s = store({ fail: true });
    const c = createResultCache({ now: () => 0, store: s.repo });
    c.set('k', answer(1), 'classify');
    await settle();
    expect(await c.get('k')).toEqual(answer(1)); // memory still works
    expect(await c.get('missing')).toBeUndefined();
  });
});
