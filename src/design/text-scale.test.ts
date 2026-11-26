import { beforeEach, describe, expect, it, vi } from 'vitest';

import { effectiveFontScale, getTextScale, loadTextScale, MAX_FONT_SCALE, parseTextScale, resetTextScaleForTests, setTextScale, TEXT_SCALE_KEY, TEXT_SCALES } from './text-scale';

const store = vi.hoisted(() => new Map<string, string>());
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => store.get(k) ?? null,
    setItem: async (k: string, v: string) => { store.set(k, v); },
  },
}));

describe('text size (D10-025)', () => {
  beforeEach(() => { store.clear(); resetTextScaleForTests(); });

  it('knows four steps and falls back to the default for anything else', () => {
    expect(TEXT_SCALES).toEqual([0.9, 1, 1.15, 1.3]);
    expect(parseTextScale('1.15')).toBe(1.15);
    expect(parseTextScale(1.3)).toBe(1.3);
    for (const bad of ['2', '0', 'abc', null, undefined, NaN, '1.16']) expect(parseTextScale(bad), String(bad)).toBe(1);
  });

  it('multiplies Large mode by the step and stays inside the ceiling', () => {
    expect(effectiveFontScale(false, 1)).toBe(1);
    expect(effectiveFontScale(false, 1.3)).toBe(1.3);
    expect(effectiveFontScale(false, 0.9)).toBe(0.9);
    expect(effectiveFontScale(true, 1)).toBe(1.5);
    expect(effectiveFontScale(true, 1.15)).toBe(1.73);
    expect(effectiveFontScale(true, 1.3)).toBe(MAX_FONT_SCALE);
  });

  it('saves a step on this device and reads it back after a restart', async () => {
    await setTextScale(1.15);
    expect(store.get(TEXT_SCALE_KEY)).toBe('1.15');
    resetTextScaleForTests();
    expect(getTextScale()).toBe(1);
    expect(await loadTextScale()).toBe(1.15);
  });

  it('ignores a damaged saved value', async () => {
    store.set(TEXT_SCALE_KEY, 'huge');
    expect(await loadTextScale()).toBe(1);
  });
});
