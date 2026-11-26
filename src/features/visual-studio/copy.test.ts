import { describe, expect, it } from 'vitest';
import { loadFixture } from '../../../tests/fixtures/specs/load';
import { moveComponentTo } from '@/core/edit/direct';
import { validateSpec } from '@/core/spec';
import en from '@/i18n/locales/en.json';
import type { TFunction } from '@/i18n/translator';
import { FAIL_KEY, FIELD_KEY, NOUN_KEY, SIZE_KEY, SUMMARY_KEY, summaryOf } from './copy';

const has = (key: string) => key.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown> | undefined)?.[k], en) !== undefined;
const t: TFunction = (key, params) => `${key}|${JSON.stringify(params ?? {})}`;

describe('studio copy', () => {
  it('every key it names is in the English catalogue', () => {
    for (const map of [NOUN_KEY, SIZE_KEY, FIELD_KEY, FAIL_KEY, SUMMARY_KEY]) {
      for (const key of Object.values(map)) expect(has(key), key).toBe(true);
    }
  });

  it('names the part and the screen in the history sentence', () => {
    const spec = validateSpec(loadFixture('valid', 'tailor-measurement-book')).spec!;
    const r = moveComponentTo(spec, 'orders_count', { screen: 'new', before: null });
    if (!r.ok) throw new Error(r.reason);
    const s = summaryOf(t, r);
    expect(s).toContain('visualStudio.summary.movedToScreen');
    expect(s).toContain(`"screen":"${r.spec.screens[1]?.title}"`);
  });
});
