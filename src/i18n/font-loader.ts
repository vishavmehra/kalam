/**
 * Loads script fonts on demand and only for the scripts in use. The font engine is injected, so this file
 * is pure TypeScript and is tested in Node; `use-script-fonts.ts` wires it to `expo-font`.
 */
import { scriptFontFamilies, type NonLatinScript, type Script } from './scripts';

/** Family name to font file, as `expo-font`'s `loadAsync` takes it. */
export type FontMap = Record<string, number | string>;

export interface FontDeps {
  loadAsync(map: FontMap): Promise<void>;
  isLoaded(family: string): boolean;
}

export interface ScriptFontLoader {
  /** True when every weight of the script is registered. Latin is always true (Inter loads at the root). */
  isLoaded(script: Script): boolean;
  /** Loads one script. Concurrent calls share one request. Rejects if the font engine fails; call again to retry. */
  load(script: Script): Promise<void>;
  loadAll(scripts: readonly Script[]): Promise<void>;
  subscribe(listener: () => void): () => void;
  /** Changes whenever a load finishes, for `useSyncExternalStore`. */
  getVersion(): number;
}

export function createScriptFontLoader(deps: FontDeps, assets: Record<NonLatinScript, FontMap>): ScriptFontLoader {
  const pending = new Map<Script, Promise<void>>();
  const listeners = new Set<() => void>();
  let version = 0;

  const notify = (): void => {
    version += 1;
    for (const listener of [...listeners]) listener();
  };

  const isLoaded: ScriptFontLoader['isLoaded'] = (script) => script === 'latin' || scriptFontFamilies(script).every((family) => deps.isLoaded(family));

  const load: ScriptFontLoader['load'] = (script) => {
    if (script === 'latin' || isLoaded(script)) return Promise.resolve();
    const existing = pending.get(script);
    if (existing) return existing;
    const request = deps
      .loadAsync(assets[script])
      .finally(() => {
        pending.delete(script);
        notify();
      });
    pending.set(script, request);
    return request;
  };

  return {
    isLoaded,
    load,
    loadAll: async (scripts) => {
      await Promise.all([...new Set(scripts)].map(load));
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getVersion: () => version,
  };
}
