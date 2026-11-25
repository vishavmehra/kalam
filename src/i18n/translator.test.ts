import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTranslator } from './active';
import { parseCatalogue } from './catalogue';
import { resetMissingKeyWarnings, createTranslator } from './translator';
import type { MissingEvent, ParsedCatalogue } from './types';

const en = parseCatalogue({
  $meta: { draft: false },
  a: {
    hello: 'Hello {name}',
    price: 'Total {amount}',
    only: 'Only in English',
    count: { one: '{count} item', other: '{count} items' },
    zero: { zero: 'No items', one: '{count} item', other: '{count} items' },
    braces: 'Write {{name}} to get {name}',
  },
});
const hi = parseCatalogue({
  $meta: { draft: true },
  a: {
    hello: 'नमस्ते {name}',
    price: 'कुल {amount}',
    count: { one: '{count} चीज़', other: '{count} चीज़ें' },
  },
});
const catalogues: Record<string, ParsedCatalogue> = { en, hi };
const lookup = (language: string) => catalogues[language];

function make(language: string, extra: { onMissing?: (e: MissingEvent) => void } = {}) {
  return createTranslator(language, { getCatalogue: lookup, warn: false, ...extra });
}

describe('interpolation', () => {
  it('fills {placeholders}', () => {
    expect(make('en').td('a.hello', { name: 'Asha' })).toBe('Hello Asha');
    expect(make('hi').td('a.hello', { name: 'आशा' })).toBe('नमस्ते आशा');
  });

  it('formats number params for the language (Indian grouping)', () => {
    expect(make('en').td('a.price', { amount: 1234567 })).toBe('Total 12,34,567');
    expect(make('hi').td('a.price', { amount: 1234567 })).toBe('कुल 12,34,567');
  });

  it('keeps strings as typed and writes {{ and }} as literal braces', () => {
    expect(make('en').td('a.price', { amount: '1234567' })).toBe('Total 1234567');
    expect(make('en').td('a.braces', { name: 'Asha' })).toBe('Write {name} to get Asha');
  });

  it('renders a missing placeholder as empty and reports it once', () => {
    const events: MissingEvent[] = [];
    const tr = make('en', { onMissing: (e) => events.push(e) });
    expect(tr.td('a.hello')).toBe('Hello ');
    expect(tr.td('a.hello')).toBe('Hello ');
    expect(events).toEqual([{ kind: 'param', key: 'a.hello', language: 'en', param: 'name' }]);
  });
});

describe('plurals', () => {
  it('English picks one or other from count', () => {
    const tr = make('en');
    expect(tr.td('a.count', { count: 1 })).toBe('1 item');
    expect(tr.td('a.count', { count: 0 })).toBe('0 items');
    expect(tr.td('a.count', { count: 3 })).toBe('3 items');
    expect(tr.td('a.count', { count: 1200 })).toBe('1,200 items');
  });

  it('uses the selected language rules: Hindi treats 0 as singular', () => {
    const tr = make('hi');
    expect(tr.td('a.count', { count: 0 })).toBe('0 चीज़');
    expect(tr.td('a.count', { count: 1 })).toBe('1 चीज़');
    expect(tr.td('a.count', { count: 2 })).toBe('2 चीज़ें');
  });

  it('an explicit zero form wins for 0', () => {
    expect(make('en').td('a.zero', { count: 0 })).toBe('No items');
    expect(make('en').td('a.zero', { count: 1 })).toBe('1 item');
  });

  it('a count that is a numeric string still selects a form', () => {
    expect(make('en').td('a.count', { count: '1' })).toBe('1 item');
  });

  it('a plural message with no count reports it and uses "other"', () => {
    const events: MissingEvent[] = [];
    expect(make('en', { onMissing: (e) => events.push(e) }).td('a.count')).toBe(' items');
    expect(events.some((e) => e.kind === 'param' && e.param === 'count')).toBe(true);
  });
});

describe('fallback to English', () => {
  it('uses English when the selected language lacks the key, and says so once', () => {
    const events: MissingEvent[] = [];
    const tr = make('hi', { onMissing: (e) => events.push(e) });
    expect(tr.td('a.only')).toBe('Only in English');
    expect(tr.td('a.only')).toBe('Only in English');
    expect(events).toEqual([{ kind: 'fallback', key: 'a.only', language: 'hi' }]);
  });

  it('uses English silently while the language is still loading', () => {
    const events: MissingEvent[] = [];
    const tr = createTranslator('ta', { getCatalogue: lookup, warn: false, onMissing: (e) => events.push(e) });
    expect(tr.td('a.hello', { name: 'X' })).toBe('Hello X');
    expect(events).toEqual([]);
  });

  it('plural fallback uses the English rules for the English message', () => {
    // 0 is "one" in Hindi but "other" in English, and the message here is English.
    expect(make('hi').td('a.zero', { count: 0 })).toBe('No items');
    expect(createTranslator('hi', { getCatalogue: (l) => (l === 'en' ? catalogues.en : undefined), warn: false }).td('a.count', { count: 0 })).toBe('0 items');
  });
});

describe('missing keys', () => {
  beforeEach(resetMissingKeyWarnings);
  afterEach(() => vi.restoreAllMocks());

  it('never returns the raw key', () => {
    const tr = make('en');
    expect(tr.td('no.such.key')).toBe('');
    expect(tr.td('no.such.key', { n: 3 }, { defaultValue: 'Fallback {n}' })).toBe('Fallback 3');
  });

  it('warns once in development, and not at all when warn is false', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const loud = createTranslator('en', { getCatalogue: lookup });
    loud.td('no.such.key');
    loud.td('no.such.key');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('no.such.key');

    warn.mockClear();
    make('en').td('another.missing');
    expect(warn).not.toHaveBeenCalled();
  });

  it('does not warn outside development', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
    try {
      createTranslator('en', { getCatalogue: lookup }).td('missing.in.production');
      expect(warn).not.toHaveBeenCalled();
    } finally {
      delete (globalThis as { __DEV__?: boolean }).__DEV__;
    }
  });
});

describe('translator facts', () => {
  it('exposes language, locale, lang attribute, direction, script and draft state', () => {
    const tr = make('hi');
    expect(tr).toMatchObject({ language: 'hi', locale: 'hi-IN', htmlLang: 'hi', direction: 'ltr', script: 'devanagari', isDraft: true });
    expect(make('en').isDraft).toBe(false);
  });

  it('normalises odd language tags', () => {
    expect(make('HI_in').language).toBe('hi');
    expect(make('fr').language).toBe('en');
  });

  it('has() looks in the language and then English', () => {
    const tr = make('hi');
    expect(tr.has('a.only')).toBe(true);
    expect(tr.has('nope')).toBe(false);
  });

  it('the shared translator is stable until a catalogue loads', () => {
    expect(getTranslator('en')).toBe(getTranslator('en'));
    expect(getTranslator('fr').language).toBe('en');
  });

  it('typed keys reject typos at compile time', () => {
    const tr = make('en');
    // @ts-expect-error not a key in the English catalogue
    tr.t('shelf.nope');
    expect(tr.t('shelf.title')).toBe('');
  });
});
