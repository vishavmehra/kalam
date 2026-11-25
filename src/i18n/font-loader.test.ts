import { describe, expect, it, vi } from 'vitest';

import { createScriptFontLoader, type FontMap } from './font-loader';
import { NON_LATIN_SCRIPTS, scriptFontFamilies, type NonLatinScript } from './scripts';

function fakeEngine() {
  const registered = new Set<string>();
  const requests: string[][] = [];
  let fail = false;
  const engine = {
    loadAsync: vi.fn(async (map: FontMap) => {
      requests.push(Object.keys(map));
      await Promise.resolve();
      if (fail) throw new Error('network');
      for (const family of Object.keys(map)) registered.add(family);
    }),
    isLoaded: (family: string) => registered.has(family),
  };
  return { engine, requests, registered, setFail: (value: boolean) => { fail = value; } };
}

const assets = Object.fromEntries(
  NON_LATIN_SCRIPTS.map((s) => [s, Object.fromEntries(scriptFontFamilies(s).map((f, i) => [f, i + 1]))]),
) as Record<NonLatinScript, FontMap>;

describe('script font loader', () => {
  it('loads only the requested script, four weights, once', async () => {
    const { engine, requests } = fakeEngine();
    const loader = createScriptFontLoader(engine, assets);
    await loader.load('devanagari');
    await loader.load('devanagari');
    expect(requests).toEqual([scriptFontFamilies('devanagari')]);
    expect(loader.isLoaded('devanagari')).toBe(true);
    expect(loader.isLoaded('tamil')).toBe(false);
  });

  it('never loads Latin: Inter is loaded by the root layout', async () => {
    const { engine } = fakeEngine();
    const loader = createScriptFontLoader(engine, assets);
    await loader.loadAll(['latin']);
    expect(engine.loadAsync).not.toHaveBeenCalled();
    expect(loader.isLoaded('latin')).toBe(true);
  });

  it('shares one request between concurrent callers and de-duplicates loadAll', async () => {
    const { engine, requests } = fakeEngine();
    const loader = createScriptFontLoader(engine, assets);
    await Promise.all([loader.load('tamil'), loader.load('tamil'), loader.loadAll(['tamil', 'tamil', 'telugu'])]);
    expect(requests.map((r) => r[0]).sort()).toEqual(['NotoSansTamil_400Regular', 'NotoSansTelugu_400Regular']);
  });

  it('rejects when the font engine fails, and a later call retries', async () => {
    const { engine, requests, setFail } = fakeEngine();
    const loader = createScriptFontLoader(engine, assets);
    setFail(true);
    await expect(loader.load('kannada')).rejects.toThrow('network');
    expect(loader.isLoaded('kannada')).toBe(false);
    setFail(false);
    await loader.load('kannada');
    expect(requests).toHaveLength(2);
    expect(loader.isLoaded('kannada')).toBe(true);
  });

  it('tells subscribers when a load finishes', async () => {
    const { engine } = fakeEngine();
    const loader = createScriptFontLoader(engine, assets);
    const seen: number[] = [];
    const stop = loader.subscribe(() => seen.push(loader.getVersion()));
    await loader.load('malayalam');
    stop();
    await loader.load('gujarati');
    expect(seen).toEqual([1]);
    expect(loader.getVersion()).toBe(2);
  });

  it('treats a script as loaded only when all four weights are registered', async () => {
    const { engine, registered } = fakeEngine();
    const loader = createScriptFontLoader(engine, assets);
    registered.add('NotoSansBengali_400Regular');
    expect(loader.isLoaded('bengali')).toBe(false);
  });
});
