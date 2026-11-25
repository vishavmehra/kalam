/**
 * Checks every shipped locale file against the English source: same keys, same placeholders, plural
 * forms present, written in the right script, and obeying the copy rule (no dashes, no hype).
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { getCatalogue, loadCatalogue, parseCatalogue, registerCatalogue, resetCatalogues, setCatalogueLoaders } from './catalogue';
import { placeholdersOf } from './interpolate';
import type { TranslationKey } from './keys';
import { LANGUAGES, LANGUAGE_CODES } from './languages';
import { detectScripts } from './scripts';
import type { Message, ParsedCatalogue } from './types';

const forms = (m: Message): string[] => (typeof m === 'string' ? [m] : Object.values(m).filter((s): s is string => typeof s === 'string'));
const placeholders = (m: Message): string[] => [...new Set(forms(m).flatMap(placeholdersOf))].sort();

let english: ParsedCatalogue;
const loaded = new Map<string, ParsedCatalogue>();

beforeAll(async () => {
  english = (await loadCatalogue('en'))!;
  for (const code of LANGUAGE_CODES) loaded.set(code, (await loadCatalogue(code))!);
});

describe('English source catalogue', () => {
  it('parses without problems and is not a draft', () => {
    expect(english.problems).toEqual([]);
    expect(english.meta.draft).toBe(false);
    expect(english.messages.size).toBeGreaterThan(200);
  });

  it('has the keys the typed API promises', () => {
    const sample: TranslationKey[] = ['shelf.empty.title', 'time.minutesAgo', 'settings.language.studio', 'create.error.cloudBody'];
    for (const key of sample) expect(english.messages.has(key), key).toBe(true);
  });

  it('every plural message needs {count} in every form', () => {
    for (const [key, message] of english.messages) {
      if (typeof message !== 'string') for (const f of forms(message)) expect(f, key).toContain('{count}');
    }
  });
});

describe.each(LANGUAGES.filter((l) => l.code !== 'en'))('$english catalogue ($code)', ({ code, script }) => {
  const get = () => loaded.get(code)!;

  it('loads, parses cleanly and is marked as a draft for native review', () => {
    expect(get()).toBeDefined();
    expect(get().problems).toEqual([]);
    expect(get().meta.draft).toBe(true);
    expect(get().meta.note ?? '').toMatch(/review/i);
  });

  it('has exactly the English keys: nothing missing, nothing extra', () => {
    const keys = new Set(get().messages.keys());
    const source = new Set(english.messages.keys());
    expect([...source].filter((k) => !keys.has(k))).toEqual([]);
    expect([...keys].filter((k) => !source.has(k))).toEqual([]);
  });

  it('keeps the same message shape and the same placeholders as English', () => {
    for (const [key, source] of english.messages) {
      const translated = get().messages.get(key)!;
      expect(typeof translated === 'string', `${key} shape`).toBe(typeof source === 'string');
      expect(placeholders(translated), `${key} placeholders`).toEqual(placeholders(source));
    }
  });

  it('has every plural form the language needs', () => {
    const needed = new Intl.PluralRules(code).resolvedOptions().pluralCategories;
    for (const [key, message] of get().messages) {
      if (typeof message === 'string') continue;
      for (const category of needed) expect(message[category], `${key} ${category}`).toBeTypeOf('string');
    }
  });

  it('is written in its own script, not left in English', () => {
    for (const [key, message] of get().messages) {
      for (const text of forms(message)) {
        if (key === 'app.name') continue;
        expect(detectScripts(text), `${key}: ${text}`).toContain(script);
      }
    }
  });

  it('is never empty', () => {
    for (const [key, message] of get().messages) for (const text of forms(message)) expect(text.trim(), key).not.toBe('');
  });
});

describe('copy rule', () => {
  const all = (): Array<[string, string, string]> =>
    LANGUAGE_CODES.flatMap((code) => [...(loaded.get(code) ?? english).messages].flatMap(([key, m]) => forms(m).map((text): [string, string, string] => [code, key, text])));

  it('uses no em dashes or en dashes in any language', () => {
    for (const [code, key, text] of all()) expect(text, `${code} ${key}`).not.toMatch(/[–—]/);
  });

  it('has no exclamation marks', () => {
    for (const [code, key, text] of all()) expect(text, `${code} ${key}`).not.toContain('!');
  });

  it('English has none of the banned hype words', () => {
    const banned = /seamless|effortless|unlock|empower|elevate|harness|delve|robust|cutting-edge|revolution|magic|✨|let's|whether you/i;
    for (const [code, key, text] of all()) if (code === 'en') expect(text, key).not.toMatch(banned);
  });
});

describe('registry', () => {
  it('parseCatalogue reports bad entries without dropping good ones', () => {
    const parsed = parseCatalogue({ ok: 'fine', bad: { one: 'x' }, empty: '', dotted: { 'a.b': 'x' }, n: 4 });
    expect(parsed.messages.get('ok')).toBe('fine');
    expect(parsed.problems.length).toBeGreaterThanOrEqual(3);
  });

  it('a failed load leaves English in place and can be retried', async () => {
    resetCatalogues();
    setCatalogueLoaders({ ta: () => Promise.reject(new Error('offline')) });
    expect(await loadCatalogue('ta')).toBeUndefined();
    expect(getCatalogue('ta')).toBeUndefined();
    expect(getCatalogue('en')).toBeDefined();
    setCatalogueLoaders({ ta: () => Promise.resolve({ default: { $meta: { draft: true }, x: 'y' } }) });
    expect((await loadCatalogue('ta'))?.messages.get('x')).toBe('y');
    resetCatalogues();
  });

  it('concurrent loads share one request', async () => {
    resetCatalogues();
    let calls = 0;
    setCatalogueLoaders({ gu: () => { calls += 1; return Promise.resolve({ default: { x: 'y' } }); } });
    await Promise.all([loadCatalogue('gu'), loadCatalogue('gu-IN'), loadCatalogue('gu')]);
    expect(calls).toBe(1);
    resetCatalogues();
  });

  it('registerCatalogue replaces a catalogue', () => {
    registerCatalogue('te', { z: 'one' });
    expect(getCatalogue('te')?.messages.get('z')).toBe('one');
    resetCatalogues();
  });
});
