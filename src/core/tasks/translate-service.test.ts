import { describe, expect, it } from 'vitest';
import { createFakeAI, type FakeAIOptions, type FakeReply } from '../../../tests/fixtures/compiler/fake-ai';
import { loadFixture } from '../../../tests/fixtures/specs/load';
import type { AIOrchestrator, KalamSettings, TranslationCacheEntry, TranslationCacheRepository } from '../contracts';
import { DEFAULT_SETTINGS } from '../contracts';
import { TEXT_IO } from '../../infrastructure/firebase/on-device.web';
import { collectTranslatableLabels, ON_DEVICE_TRANSLATION_LANGUAGES, translatedView, type TranslatableLabel } from '../i18n-labels';
import { validateSpec } from '../spec';
import type { KalamSpec } from '../spec/schema';
import { createTranslateService, ON_DEVICE_MAX_LABELS, readCachedTranslation } from './translate-service';

const load = (name: string): KalamSpec => {
  const r = validateSpec(loadFixture('valid', name));
  if (!r.ok || !r.spec) throw new Error(`fixture ${name} is invalid`);
  return r.spec;
};
const spec = load('expense-tracker'); // lang: en

function memoryCache(): TranslationCacheRepository & { rows: Map<string, TranslationCacheEntry> } {
  const rows = new Map<string, TranslationCacheEntry>();
  return {
    rows,
    async get(appId, lang) { return rows.get(`${appId}:${lang}`); },
    async put(entry) { rows.set(`${entry.appId}:${entry.lang}`, entry); },
    async listForApp(appId) { return [...rows.values()].filter((r) => r.appId === appId); },
    async removeForApp(appId) { for (const k of [...rows.keys()]) if (k.startsWith(`${appId}:`)) rows.delete(k); },
  };
}

/** A model that translates by prefixing every text with a Devanagari word. */
const prefixing = (s: KalamSpec = spec, edit?: (key: string, text: string) => string, prefix = 'अनुवाद') => {
  const texts = new Map(collectTranslatableLabels(s).map((l) => [l.key, l.text]));
  return (req: { jsonSchema: Record<string, unknown> }): FakeReply => {
    const keys = Object.keys((req.jsonSchema as { properties: Record<string, unknown> }).properties);
    return { raw: Object.fromEntries(keys.map((k) => [k, edit ? edit(k, texts.get(k) ?? '') : `${prefix} ${texts.get(k) ?? ''}`])) };
  };
};

const fakeAI = (opts: FakeAIOptions = {}) => createFakeAI({ respond: prefixing(), ...opts });
const settings = (patch: Partial<KalamSettings> = {}) => ({ get: async () => ({ ...DEFAULT_SETTINGS, ...patch }) });

describe('on-device language support', () => {
  it('mirrors what the Prompt API is asked for in TEXT_IO, so no pair is claimed that is not requested', () => {
    const asked = (list: typeof TEXT_IO.expectedInputs) => (list ?? []).flatMap((e) => e.languages ?? []).sort();
    expect(asked(TEXT_IO.expectedInputs)).toEqual([...ON_DEVICE_TRANSLATION_LANGUAGES].sort());
    expect(asked(TEXT_IO.expectedOutputs)).toEqual([...ON_DEVICE_TRANSLATION_LANGUAGES].sort());
  });
});

describe('translate service: routing rules from docs/10 §15.3', () => {
  const both = ['en', 'es'];

  it('passes the language pair to the on-device leg only', async () => {
    const ai = fakeAI({ onDevice: 'available' });
    await createTranslateService({ ai, cache: memoryCache(), onDeviceLanguages: both }).translateApp(spec, 'es');
    expect(ai.calls[0].req.mode).toBe('prefer_on_device');
    expect(ai.calls[0].req.languages).toEqual(['en', 'es']);
    const cloud = fakeAI({ onDevice: 'available' });
    await createTranslateService({ ai: cloud, cache: memoryCache() }).translateApp(spec, 'hi');
    expect(cloud.calls[0].req.languages).toBeUndefined();
  });

  it('skips the device when the person asks for the cloud', async () => {
    const ai = fakeAI({ onDevice: 'available' });
    const r = await createTranslateService({ ai, cache: memoryCache(), onDeviceLanguages: both }).translateApp(spec, 'es', { preferCloud: true });
    expect(ai.calls[0].req.mode).toBe('only_in_cloud');
    expect(r.source).toBe('cloud');
  });

  it('skips the device when the app has too many labels for it', async () => {
    const big: KalamSpec = JSON.parse(JSON.stringify(spec)) as KalamSpec;
    const screen = big.screens[0];
    for (let i = 0; i < ON_DEVICE_MAX_LABELS; i++) {
      screen.children.push({ id: `extra_${i}`, type: 'text', label: `Extra line ${i} here` });
    }
    const ai = createFakeAI({ onDevice: 'available', respond: prefixing(big, (_k, t) => `ñ${t}`) });
    await createTranslateService({ ai, cache: memoryCache(), onDeviceLanguages: both }).translateApp(big, 'es');
    expect(ai.calls[0].req.mode).toBe('only_in_cloud');
  });

  it('uses a device probe to add a language, and only that language', async () => {
    const probe = async (lang: string) => lang === 'es';
    const ai = fakeAI({ onDevice: 'available' });
    await createTranslateService({ ai, cache: memoryCache(), probeOnDeviceLanguage: probe }).translateApp(spec, 'es');
    expect(ai.calls[0].req.mode).toBe('prefer_on_device');
    const other = fakeAI({ onDevice: 'available' });
    await createTranslateService({ ai: other, cache: memoryCache(), probeOnDeviceLanguage: probe }).translateApp(spec, 'hi');
    expect(other.calls[0].req.mode).toBe('only_in_cloud');
  });

  it('tells the model not to guess unclear text', async () => {
    const ai = fakeAI();
    await createTranslateService({ ai }).translateApp(spec, 'hi');
    expect(ai.calls[0].req.system).toMatch(/do not guess/);
  });
});

describe('translate service: one call per app', () => {
  it('translates every label in a single structured call with the translation role', async () => {
    const ai = fakeAI();
    const cache = memoryCache();
    const r = await createTranslateService({ ai, cache }).translateApp(spec, 'hi');

    expect(ai.calls).toHaveLength(1);
    const { req, ctx } = ai.calls[0];
    expect(req).toMatchObject({ taskType: 'translate', role: 'translation', temperature: 0 });
    expect(ctx).toMatchObject({ taskType: 'translate', appId: spec.id });
    const labels = collectTranslatableLabels(spec);
    const schema = req.jsonSchema as { properties: Record<string, { type: string }>; required: string[]; additionalProperties: boolean };
    expect(Object.keys(schema.properties)).toEqual(labels.map((l) => l.key));
    expect(schema.required).toEqual(labels.map((l) => l.key));
    expect(schema.additionalProperties).toBe(false);
    expect(req.prompt).toContain(labels[0].text);
    expect(req.system).toContain('Hindi');

    expect(r.ok).toBe(true);
    expect(r.cached).toBe(false);
    expect(r.missing).toEqual([]);
    expect(r.source).toBe('cloud');
    expect(Object.keys(r.strings ?? {})).toEqual(labels.map((l) => l.key));
    expect(cache.rows.get(`${spec.id}:hi`)).toMatchObject({ lang: 'hi', source: 'cloud', reviewed: false, version: spec.version });
  });

  it('asks cloud only for a language the on-device model cannot write (decision 2: English-only Nano)', async () => {
    const ai = fakeAI({ onDevice: 'available' });
    await createTranslateService({ ai, cache: memoryCache() }).translateApp(spec, 'hi');
    expect(ai.calls[0].req.mode).toBe('only_in_cloud');
    expect(ai.calls[0].result.source).toBe('cloud');
  });

  it('prefers the device when it can read and write both languages', async () => {
    const ai = fakeAI({ onDevice: 'available' });
    const r = await createTranslateService({ ai, cache: memoryCache(), onDeviceLanguages: ['en', 'es'] }).translateApp(spec, 'es');
    expect(ai.calls[0].req.mode).toBe('prefer_on_device');
    expect(r.source).toBe('on_device');
  });

  it('splits only very large apps into more calls', async () => {
    const ai = fakeAI();
    const total = collectTranslatableLabels(spec).length;
    const r = await createTranslateService({ ai, cache: memoryCache(), maxLabelsPerCall: 10 }).translateApp(spec, 'hi');
    expect(ai.calls).toHaveLength(Math.ceil(total / 10));
    expect(r.ok).toBe(true);
    expect(Object.keys(r.strings ?? {})).toHaveLength(total);
  });
});

describe('translate service: cache', () => {
  it('serves a current translation from the cache with no model call', async () => {
    const ai = fakeAI();
    const cache = memoryCache();
    const svc = createTranslateService({ ai, cache });
    const first = await svc.translateApp(spec, 'hi');
    const second = await svc.translateApp(spec, 'hi-IN');
    expect(ai.calls).toHaveLength(1);
    expect(second).toMatchObject({ ok: true, cached: true, source: 'cloud', missing: [] });
    expect(second.strings).toEqual(first.strings);
  });

  it('keeps working offline when the translation is saved', async () => {
    const cache = memoryCache();
    await createTranslateService({ ai: fakeAI(), cache }).translateApp(spec, 'hi');
    const offline = fakeAI({ online: false });
    const r = await createTranslateService({ ai: offline, cache }).translateApp(spec, 'hi');
    expect(r).toMatchObject({ ok: true, cached: true });
    expect(offline.calls).toHaveLength(0);
  });

  it('throws the saved strings away when the labels change', async () => {
    const cache = memoryCache();
    const ai = fakeAI();
    await createTranslateService({ ai, cache }).translateApp(spec, 'hi');
    const edited: KalamSpec = JSON.parse(JSON.stringify(spec)) as KalamSpec;
    edited.screens[0].title = 'My spending';
    expect((await readCachedTranslation(edited, 'hi', cache)).status).toBe('stale');
    const ai2 = createFakeAI({ respond: prefixing(edited) });
    const r = await createTranslateService({ ai: ai2, cache }).translateApp(edited, 'hi');
    expect(ai2.calls).toHaveLength(1);
    expect(r.cached).toBe(false);
    expect(r.strings?.[`screen.${edited.screens[0].id}.title`]).toBe('अनुवाद My spending');
  });

  it('reuses the cache when only the theme changes', async () => {
    const cache = memoryCache();
    const ai = fakeAI();
    const svc = createTranslateService({ ai, cache });
    await svc.translateApp(spec, 'hi');
    const recoloured: KalamSpec = { ...spec, version: spec.version + 1, theme: { ...spec.theme, primary: '#123456' } };
    const r = await svc.translateApp(recoloured, 'hi');
    expect(r.cached).toBe(true);
    expect(ai.calls).toHaveLength(1);
  });

  it('force translates again and replaces the saved entry', async () => {
    const cache = memoryCache();
    const ai = fakeAI();
    const svc = createTranslateService({ ai, cache });
    await svc.translateApp(spec, 'hi');
    const again = await svc.translateApp(spec, 'hi', { force: true });
    expect(ai.calls).toHaveLength(2);
    expect(again.cached).toBe(false);
  });

  it('keeps one entry per app and language', async () => {
    const cache = memoryCache();
    // A prefix with both scripts so the same fake answers pass the script check for Hindi and Tamil.
    const svc = createTranslateService({ ai: createFakeAI({ respond: prefixing(spec, undefined, 'अनुवाद தமிழ்') }), cache });
    await svc.translateApp(spec, 'hi');
    await svc.translateApp(spec, 'ta');
    expect((await cache.listForApp(spec.id)).map((e) => e.lang).sort()).toEqual(['hi', 'ta']);
  });

  it('keeps the old entry when a forced retry fails', async () => {
    const cache = memoryCache();
    await createTranslateService({ ai: fakeAI(), cache }).translateApp(spec, 'hi');
    const before = cache.rows.get(`${spec.id}:hi`);
    const failing = createFakeAI({ respond: () => ({ error: 'quota' }) });
    const r = await createTranslateService({ ai: failing, cache }).translateApp(spec, 'hi', { force: true });
    expect(r.ok).toBe(false);
    expect(cache.rows.get(`${spec.id}:hi`)).toBe(before);
  });

  it('works without a cache and survives a cache that throws', async () => {
    const r1 = await createTranslateService({ ai: fakeAI() }).translateApp(spec, 'hi');
    expect(r1.ok).toBe(true);
    const broken: TranslationCacheRepository = {
      get: async () => { throw new Error('disk'); },
      put: async () => { throw new Error('disk'); },
      listForApp: async () => [],
      removeForApp: async () => undefined,
    };
    const r2 = await createTranslateService({ ai: fakeAI(), cache: broken }).translateApp(spec, 'hi');
    expect(r2.ok).toBe(true);
  });
});

describe('translate service: validation of the model reply', () => {
  it('rejects a reply that adds a key', async () => {
    const ai = createFakeAI({ respond: (req) => {
      const base = prefixing()(req) as { raw: Record<string, string> };
      return { raw: { ...base.raw, 'bigButton.invented.label': 'अतिरिक्त' } };
    } });
    const cache = memoryCache();
    const r = await createTranslateService({ ai, cache }).translateApp(spec, 'hi');
    expect(r.ok).toBe(false);
    expect(ai.calls[0].result.errorCode).toBe('invalid_output');
    expect(cache.rows.size).toBe(0);
    expect(r.message).toMatch(/original labels stay/i);
  });

  it('rejects a reply that drops a key', async () => {
    const ai = createFakeAI({ respond: (req) => {
      const base = prefixing()(req) as { raw: Record<string, string> };
      const [first] = Object.keys(base.raw);
      delete base.raw[first];
      return base;
    } });
    const r = await createTranslateService({ ai, cache: memoryCache() }).translateApp(spec, 'hi');
    expect(r.ok).toBe(false);
    expect(ai.calls[0].result.errorCode).toBe('invalid_output');
  });

  it('marks only the labels that broke a rule as missing and keeps the rest', async () => {
    const labels = collectTranslatableLabels(spec);
    const victim = labels.find((l) => l.kind === 'label') as TranslatableLabel;
    const ai = createFakeAI({ respond: prefixing(spec, (k, t) => (k === victim.key ? '' : `अनुवाद ${t}`)) });
    const cache = memoryCache();
    const r = await createTranslateService({ ai, cache }).translateApp(spec, 'hi');
    expect(r.ok).toBe(true);
    expect(r.missing).toEqual([victim.key]);
    expect(r.strings).not.toHaveProperty(victim.key);
    expect(r.message).toMatch(/1 label stayed in English/);
    // Served again from cache, still reporting the same gap.
    const again = await createTranslateService({ ai, cache }).translateApp(spec, 'hi');
    expect(again).toMatchObject({ cached: true, missing: [victim.key] });
    expect(ai.calls).toHaveLength(1);
  });

  it('rejects a reply that is all Latin letters for a language with its own script', async () => {
    const ai = createFakeAI({ respond: prefixing(spec, (_k, t) => `${t} karo`) });
    const r = await createTranslateService({ ai, cache: memoryCache() }).translateApp(spec, 'hi');
    expect(r.ok).toBe(false);
  });

  it('rejects a reply that hands the English text back unchanged', async () => {
    const ai = createFakeAI({ respond: prefixing(spec, (_k, t) => t) });
    const r = await createTranslateService({ ai, cache: memoryCache() }).translateApp(spec, 'hi');
    expect(r.ok).toBe(false);
  });

  it('keeps numbers and placeholders: a label that loses one stays in the original', async () => {
    const withPlaceholder: KalamSpec = JSON.parse(JSON.stringify(spec)) as KalamSpec;
    withPlaceholder.actions.save_expense = { type: 'insert', collection: Object.keys(spec.collections)[0], then: { feedback: 'Saved {name} for 250', navigate: spec.initialScreen } };
    const key = 'action.save_expense.then.feedback';
    const ai = createFakeAI({ respond: prefixing(withPlaceholder, (k, t) => (k === key ? 'सेव हुआ {naam} 300' : `अनुवाद ${t}`)) });
    const r = await createTranslateService({ ai, cache: memoryCache() }).translateApp(withPlaceholder, 'hi');
    expect(r.ok).toBe(true);
    expect(r.missing).toEqual([key]);
  });
});

describe('translate service: offline, consent and fallbacks', () => {
  it('says so and makes no call when offline with nothing saved', async () => {
    const ai = fakeAI({ online: false });
    const r = await createTranslateService({ ai, cache: memoryCache() }).translateApp(spec, 'hi');
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/offline/i);
    expect(r.message).toMatch(/Hindi/);
    expect(r.message).toMatch(/Translations you saved still work/);
    expect(ai.calls).toHaveLength(0);
    expect(r.source).toBe('deterministic');
  });

  it('does not use the English-only on-device model for another language when cloud is off', async () => {
    const ai = fakeAI({ onDevice: 'available' });
    const r = await createTranslateService({ ai, cache: memoryCache(), settings: settings({ allowCloud: false }) }).translateApp(spec, 'hi');
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Cloud AI is turned off/);
    expect(ai.calls).toHaveLength(0);
  });

  it('respects offline-only mode', async () => {
    const ai = fakeAI();
    const r = await createTranslateService({ ai, cache: memoryCache(), settings: settings({ aiMode: 'offline_only' }) }).translateApp(spec, 'hi');
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Offline-only mode/);
    expect(ai.calls).toHaveLength(0);
  });

  it('refuses an on-device answer for a language the device cannot write', async () => {
    // Orchestrator clamping can turn an `only_in_cloud` request into an on-device run when consent is missing.
    const device = createFakeAI({ onDevice: 'available', respond: prefixing() });
    const ai: AIOrchestrator = { ...device, run: (req, ctx) => device.run({ ...req, mode: 'prefer_on_device' }, ctx) };
    const cache = memoryCache();
    const r = await createTranslateService({ ai, cache }).translateApp(spec, 'hi');
    expect(r.ok).toBe(false);
    expect(cache.rows.size).toBe(0);
  });

  it('falls back to cloud exactly once when the on-device attempt fails', async () => {
    const ai = createFakeAI({
      onDevice: 'available',
      respond: (req, ctx, i) => (i === 0 ? { raw: { wrong: 'shape' } } : prefixing(load('expense-tracker'), (_k, t) => `ñ${t}`)(req)),
    });
    const svc = createTranslateService({ ai, cache: memoryCache(), onDeviceLanguages: ['en', 'es'] });
    const r = await svc.translateApp(spec, 'es');
    expect(ai.calls.map((c) => c.req.mode)).toEqual(['prefer_on_device', 'only_in_cloud']);
    expect(ai.calls[0].result.errorCode).toBe('invalid_output');
    expect(r).toMatchObject({ ok: true, source: 'cloud' });
  });

  it('does not retry in the cloud when the person is offline', async () => {
    const ai = createFakeAI({ onDevice: 'available', online: false, respond: () => ({ raw: { wrong: 'shape' } }) });
    const r = await createTranslateService({ ai, cache: memoryCache(), onDeviceLanguages: ['en', 'es'] }).translateApp(spec, 'es');
    expect(ai.calls).toHaveLength(1);
    expect(r.ok).toBe(false);
  });

  it('does not cascade after a cloud failure', async () => {
    const ai = createFakeAI({ respond: () => ({ error: 'provider_error' }) });
    const r = await createTranslateService({ ai, cache: memoryCache() }).translateApp(spec, 'hi');
    expect(ai.calls).toHaveLength(1);
    expect(r.ok).toBe(false);
  });

  it('explains quota and timeout in plain words', async () => {
    const quota = await createTranslateService({ ai: createFakeAI({ respond: () => ({ error: 'quota' }) }) }).translateApp(spec, 'hi');
    expect(quota.message).toMatch(/usage limit/);
    const slow = await createTranslateService({ ai: createFakeAI({ respond: () => ({ error: 'timeout' }) }) }).translateApp(spec, 'hi');
    expect(slow.message).toMatch(/too long/);
  });

  it('stops before calling a model when already cancelled', async () => {
    const ai = fakeAI();
    const controller = new AbortController();
    controller.abort();
    const r = await createTranslateService({ ai }).translateApp(spec, 'hi', { signal: controller.signal });
    expect(r).toMatchObject({ ok: false, message: 'Translation cancelled.' });
    expect(ai.calls).toHaveLength(0);
  });
});

describe('translate service: simple cases', () => {
  it('does nothing for the language the app is already in', async () => {
    const ai = fakeAI();
    const r = await createTranslateService({ ai }).translateApp(spec, 'en-IN');
    expect(r).toMatchObject({ ok: true, strings: {}, source: 'deterministic' });
    expect(ai.calls).toHaveLength(0);
  });

  it('rejects an unusable language tag', async () => {
    const r = await createTranslateService({ ai: fakeAI() }).translateApp(spec, '??');
    expect(r.ok).toBe(false);
  });

  it('translates a Hindi app into English', async () => {
    const hindi = load('kirana-credit-book');
    const ai = createFakeAI({ respond: prefixing(hindi, (_k, t) => `${t} (Credit)`) });
    const r = await createTranslateService({ ai, cache: memoryCache() }).translateApp(hindi, 'en');
    expect(r.ok).toBe(true);
    expect(ai.calls[0].req.system).toContain('from Hindi into English');
  });

  it('puts the app name and labels inside untrusted wrappers', async () => {
    const ai = fakeAI();
    await createTranslateService({ ai }).translateApp(spec, 'hi');
    expect(ai.calls[0].req.prompt).toContain('<untrusted_app_name>');
    expect(ai.calls[0].req.prompt).toContain('<untrusted_labels>');
    expect(ai.calls[0].req.system).toMatch(/not instructions/);
  });
});

describe('translate service: corrections', () => {
  it('stores a correction, marks the entry reviewed and shows it in the view', async () => {
    const cache = memoryCache();
    const svc = createTranslateService({ ai: fakeAI(), cache });
    await svc.translateApp(spec, 'hi');
    const key = `screen.${spec.screens[0].id}.title`;
    await svc.correct(spec.id, 'hi', key, '  मेरे   खर्चे ');
    const entry = cache.rows.get(`${spec.id}:hi`);
    expect(entry).toMatchObject({ reviewed: true });
    expect(entry?.strings[key]).toBe('मेरे खर्चे');
    // A later open still serves the correction without a model call.
    const again = await svc.translateApp(spec, 'hi');
    expect(again.cached).toBe(true);
    expect(translatedView(spec, again.strings ?? {}, 'hi').spec.screens[0].title).toBe('मेरे खर्चे');
  });

  it('refuses empty text, unknown shapes and a missing translation', async () => {
    const cache = memoryCache();
    const svc = createTranslateService({ ai: fakeAI(), cache });
    await expect(svc.correct(spec.id, 'hi', 'screen.home.title', 'x')).rejects.toThrow(/no saved translation/i);
    await svc.translateApp(spec, 'hi');
    await expect(svc.correct(spec.id, 'hi', 'screen.home.title', '   ')).rejects.toThrow(/empty/);
    await expect(svc.correct(spec.id, 'hi', '__proto__', 'x')).rejects.toThrow(/cannot be corrected/);
    await expect(svc.correct(spec.id, 'hi', 'a b', 'x')).rejects.toThrow(/cannot be corrected/);
    await expect(svc.correct(spec.id, 'hi', 'screen.home.title', 'x'.repeat(401))).rejects.toThrow(/too long/);
  });
});
