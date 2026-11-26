import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** N9's loader is replaced with a small fake, so this runs in Node without expo-font. */
function setup() {
  const loaded = new Set<string>();
  const loads: string[] = [];
  let fail = false;
  vi.doMock('@/i18n/use-script-fonts', () => ({
    isScriptLoaded: (s: string) => s === 'latin' || loaded.has(s),
    loadFontsForText: async (text: string) => {
      loads.push(text);
      await Promise.resolve(); // a real load takes time, so a second caller arrives while it runs
      if (fail) throw new Error('font engine failed');
      // The fake loads the script of each letter it is given.
      if (/[अ]/.test(text)) loaded.add('devanagari');
      if (/[அ]/.test(text)) loaded.add('tamil');
    },
  }));
  return { loaded, loads, setFail: (v: boolean) => { fail = v; } };
}

describe('loading Noto fonts for drawing text', () => {
  beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.doUnmock('@/i18n/use-script-fonts'); });

  it('does nothing for English text, and returns nothing to wait for', async () => {
    const f = setup();
    const { ensureTextFonts, textFontsVersion } = await import('./text-fonts');
    expect(ensureTextFonts('Total 120')).toBeUndefined();
    expect(f.loads).toEqual([]);
    expect(textFontsVersion()).toBe(0);
  });

  it('loads a script once, shares the work between callers, and tells listeners when it is done', async () => {
    const f = setup();
    const { ensureTextFonts, subscribeTextFonts, textFontsVersion } = await import('./text-fonts');
    const seen = vi.fn();
    const off = subscribeTextFonts(seen);
    const a = ensureTextFonts('कुल रकम');
    const b = ensureTextFonts('कुल');
    expect(a).toBe(b);
    await a;
    expect(f.loads).toHaveLength(1);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(textFontsVersion()).toBe(1);
    // Once loaded, asking again is free.
    expect(ensureTextFonts('कुल रकम')).toBeUndefined();
    off();
  });

  it('loads only the scripts that are missing', async () => {
    const f = setup();
    const { ensureTextFonts } = await import('./text-fonts');
    await ensureTextFonts('कुल');
    await ensureTextFonts('कुल மொத்தம்');
    expect(f.loads).toHaveLength(2);
    expect(f.loads[1]).not.toContain('अ');
    expect(f.loads[1]).toContain('அ');
  });

  it('also waits for extra targets such as Skia, and keeps asking until they have the font', async () => {
    const f = setup();
    const { ensureTextFonts, registerFontTarget } = await import('./text-fonts');
    const have = new Set<string>();
    const target = { has: (s: string) => have.has(s), load: vi.fn(async (scripts: readonly string[]) => { scripts.forEach((s) => have.add(s)); }) };
    registerFontTarget(target as never);
    f.loaded.add('devanagari'); // expo-font already has it, Skia does not
    await ensureTextFonts('कुल');
    expect(target.load).toHaveBeenCalledWith(['devanagari']);
    expect(ensureTextFonts('कुल')).toBeUndefined();
  });

  it('survives a failed load, does not loop, and tries again after a pause', async () => {
    const f = setup();
    f.setFail(true);
    const { ensureTextFonts, textFontsVersion } = await import('./text-fonts');
    await ensureTextFonts('कुल');
    expect(textFontsVersion()).toBe(1);
    expect(ensureTextFonts('कुल')).toBeUndefined();
    expect(f.loads).toHaveLength(1);
    vi.advanceTimersByTime(31_000);
    f.setFail(false);
    await ensureTextFonts('कुल');
    expect(f.loads).toHaveLength(2);
    expect(ensureTextFonts('कुल')).toBeUndefined();
  });

  it('waits for every page of a drawing before an export', async () => {
    const f = setup();
    const { textFontsReady } = await import('./text-fonts');
    const page = (text: string) => ({ id: 'p', title: 't', width: 400, height: 800, elements: [{ id: 'x', kind: 'text' as const, x: 0, y: 0, text, color: '#000000', fontSize: 16 }] });
    await textFontsReady([page('Hello'), page('कुल'), page('மொத்தம்')]);
    expect(f.loaded.has('devanagari') && f.loaded.has('tamil')).toBe(true);
  });
});
