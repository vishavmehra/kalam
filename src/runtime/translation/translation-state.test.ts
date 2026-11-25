import { describe, expect, it } from 'vitest';
import { createFakeAI, type FakeReply } from '../../../tests/fixtures/compiler/fake-ai';
import { loadFixture } from '../../../tests/fixtures/specs/load';
import type { TranslationCacheEntry, TranslationCacheRepository } from '@/core/contracts';
import { collectTranslatableLabels, translatedView } from '@/core/i18n-labels';
import { validateSpec } from '@/core/spec';
import type { KalamSpec } from '@/core/spec/schema';
import { createTranslateService } from '@/core/tasks/translate-service';
import { originalState, resolveSavedTranslation, runTranslation } from './translation-state';

const parsed = validateSpec(loadFixture('valid', 'expense-tracker'));
if (!parsed.ok || !parsed.spec) throw new Error('fixture invalid');
const spec: KalamSpec = parsed.spec;

function memoryCache(): TranslationCacheRepository {
  const rows = new Map<string, TranslationCacheEntry>();
  return {
    async get(appId, lang) { return rows.get(`${appId}:${lang}`); },
    async put(entry) { rows.set(`${entry.appId}:${entry.lang}`, entry); },
    async listForApp(appId) { return [...rows.values()].filter((r) => r.appId === appId); },
    async removeForApp(appId) { for (const k of [...rows.keys()]) if (k.startsWith(`${appId}:`)) rows.delete(k); },
  };
}

const texts = new Map(collectTranslatableLabels(spec).map((l) => [l.key, l.text]));
const respond = (req: { jsonSchema: Record<string, unknown> }): FakeReply => ({
  raw: Object.fromEntries(Object.keys((req.jsonSchema as { properties: object }).properties).map((k) => [k, `अनुवाद ${texts.get(k)}`])),
});

describe('translation view state', () => {
  it('starts in the original language', () => {
    expect(originalState('en')).toMatchObject({ lang: 'en', status: 'original', strings: {}, missing: [] });
  });

  it('reports needs_translation without calling a model when nothing is saved', async () => {
    const ai = createFakeAI({ respond });
    const state = await resolveSavedTranslation(spec, 'hi', memoryCache());
    expect(state).toMatchObject({ status: 'needs_translation', strings: {} });
    expect(state.message).toMatch(/not been translated into Hindi/);
    expect(ai.calls).toHaveLength(0);
  });

  it('runs a translation, then serves it as ready from the saved copy', async () => {
    const cache = memoryCache();
    const ai = createFakeAI({ respond });
    const service = createTranslateService({ ai, cache });
    const fresh = await runTranslation(spec, 'hi', service);
    expect(fresh).toMatchObject({ status: 'ready', cached: false, source: 'cloud', missing: [] });
    expect(Object.keys(fresh.strings)).toHaveLength(texts.size);

    const saved = await resolveSavedTranslation(spec, 'hi', cache);
    expect(saved).toMatchObject({ status: 'ready', cached: true, source: 'cloud', reviewed: false });
    expect(saved.strings).toEqual(fresh.strings);
    expect(ai.calls).toHaveLength(1);
  });

  it('shows a saved translation as stale when the labels changed', async () => {
    const cache = memoryCache();
    await runTranslation(spec, 'hi', createTranslateService({ ai: createFakeAI({ respond }), cache }));
    const edited: KalamSpec = { ...spec, screens: spec.screens.map((s, i) => (i === 0 ? { ...s, title: 'My spending' } : s)) };
    const state = await resolveSavedTranslation(edited, 'hi', cache);
    expect(state.status).toBe('needs_translation');
    expect(state.message).toMatch(/changed after it was translated/);
    expect(state.strings).toEqual({});
  });

  it('keeps the original on screen and says why when offline', async () => {
    const service = createTranslateService({ ai: createFakeAI({ online: false, respond }), cache: memoryCache() });
    const state = await runTranslation(spec, 'hi', service);
    expect(state.status).toBe('failed');
    expect(state.strings).toEqual({});
    expect(state.message).toMatch(/offline/i);
    // No translated copy is produced from empty strings.
    expect(translatedView(spec, state.strings, 'hi').spec.screens[0].title).toBe(spec.screens[0].title);
  });

  it('keeps earlier strings when a retry fails', async () => {
    const cache = memoryCache();
    const first = await runTranslation(spec, 'hi', createTranslateService({ ai: createFakeAI({ respond }), cache }));
    const failing = createTranslateService({ ai: createFakeAI({ respond: () => ({ error: 'quota' }) }), cache });
    const retry = await runTranslation(spec, 'hi', failing, { force: true, previous: first });
    expect(retry.status).toBe('failed');
    expect(retry.strings).toEqual(first.strings);
    expect(retry.message).toMatch(/usage limit/);
  });

  it('reports a partial translation with the labels that stayed in the original', async () => {
    const victim = [...texts.keys()][1];
    const ai = createFakeAI({
      respond: (req) => {
        const base = respond(req) as { raw: Record<string, string> };
        base.raw[victim] = '';
        return base;
      },
    });
    const state = await runTranslation(spec, 'hi', createTranslateService({ ai, cache: memoryCache() }));
    expect(state).toMatchObject({ status: 'partial', missing: [victim] });
    expect(state.message).toMatch(/stayed in English/);
  });

  it('reads the reviewed flag after a correction', async () => {
    const cache = memoryCache();
    const service = createTranslateService({ ai: createFakeAI({ respond }), cache });
    await runTranslation(spec, 'hi', service);
    await service.correct(spec.id, 'hi', `screen.${spec.screens[0].id}.title`, 'मेरे खर्चे');
    const saved = await resolveSavedTranslation(spec, 'hi', cache);
    expect(saved.reviewed).toBe(true);
    expect(saved.strings[`screen.${spec.screens[0].id}.title`]).toBe('मेरे खर्चे');
  });

  it('turns a thrown service error into a failed state', async () => {
    const throwing = { translateApp: async () => { throw new Error('boom'); }, correct: async () => undefined };
    const state = await runTranslation(spec, 'hi', throwing);
    expect(state).toMatchObject({ status: 'failed', message: 'boom' });
  });
});
