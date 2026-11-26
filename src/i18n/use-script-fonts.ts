/**
 * Loads the Noto font for the script of the current language, on web and on Android, and nothing else.
 * English loads nothing here (Inter is loaded by the root layout). Switching language loads the new
 * script in the background while the previous fonts stay in use, so the screen never goes blank.
 */
import * as Font from 'expo-font';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { useSettingsStore } from '@/state/settings-store';

import { scriptFontAssets } from './font-assets';
import { createScriptFontLoader } from './font-loader';
import { runtimeFont, type RuntimeFont } from './runtime-font';
import { detectScripts, fontScriptsForLanguages, scriptForLanguage, type Script } from './scripts';
import { shellFontAssets } from './shell-font-assets';
import { shellFontFamilies } from './shell-fonts';

const loader = createScriptFontLoader({ loadAsync: Font.loadAsync, isLoaded: Font.isLoaded }, scriptFontAssets);

/**
 * Loads fonts for scripts outside React, for example before showing an app written in Tamil.
 * Resolves when every font is registered; rejects if the font engine fails.
 */
export function loadScriptFonts(scripts: readonly Script[]): Promise<void> {
  return loader.loadAll(scripts);
}

/** Loads the fonts for every script found in some text, for example user data in a script the app is not labelled in. */
export function loadFontsForText(text: string): Promise<void> {
  return loader.loadAll(detectScripts(text));
}

export function isScriptLoaded(script: Script): boolean {
  return loader.isLoaded(script);
}

export interface ScriptFontsState {
  /** True once the fonts for the requested languages are registered, or loading failed (use the fallback). */
  ready: boolean;
  /**
   * Script whose fonts are loaded and should style UI text right now. Pass it to `scriptFontFamily()`.
   * It is the requested script once loaded, and the previous one until then.
   */
  script: Script;
  error: Error | null;
}

/**
 * @param languages Language tags to load fonts for. Defaults to the language in Settings.
 *                  Pass an app's own language to load its script too.
 */
export function useScriptFonts(languages?: string | readonly string[]): ScriptFontsState {
  const settingsLanguage = useSettingsStore((s) => s.settings.language);
  const tags: readonly string[] = languages === undefined ? [settingsLanguage] : typeof languages === 'string' ? [languages] : languages;
  const wanted = fontScriptsForLanguages(tags);
  const key = wanted.join(',');

  useSyncExternalStore(loader.subscribe, loader.getVersion, loader.getVersion);
  const [failure, setFailure] = useState<{ key: string; error: Error } | null>(null);

  useEffect(() => {
    let alive = true;
    loader.loadAll(wanted).catch((e: unknown) => {
      if (alive) setFailure({ key, error: e instanceof Error ? e : new Error(String(e)) });
    });
    return () => {
      alive = false;
    };
    // `wanted` is derived from `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const error = failure?.key === key ? failure.error : null;
  const primary = scriptForLanguage(tags[0]);
  const lastGood = useRef<Script>('latin');
  if (error) lastGood.current = 'latin';
  else if (loader.isLoaded(primary)) lastGood.current = primary;

  return { ready: error !== null || wanted.every((s) => loader.isLoaded(s)), script: lastGood.current, error };
}

const shellLoader = createScriptFontLoader({ loadAsync: Font.loadAsync, isLoaded: Font.isLoaded }, shellFontAssets, shellFontFamilies);

/**
 * Anek and Tiro for the script of the language Kalam's screens are shown in (Settings), and nothing else.
 * The root loads Latin and Devanagari display. `script` stays on the last loaded script while a new one
 * downloads, so the screen never goes blank; it falls back to Latin if loading fails.
 */
export function useShellFonts(): ScriptFontsState {
  const language = useSettingsStore((s) => s.settings.language);
  const script = scriptForLanguage(language);
  useSyncExternalStore(shellLoader.subscribe, shellLoader.getVersion, shellLoader.getVersion);
  const [failure, setFailure] = useState<{ script: Script; error: Error } | null>(null);

  useEffect(() => {
    let alive = true;
    shellLoader.load(script).catch((e: unknown) => {
      if (alive) setFailure({ script, error: e instanceof Error ? e : new Error(String(e)) });
    });
    return () => {
      alive = false;
    };
  }, [script]);

  const error = failure?.script === script ? failure.error : null;
  const lastGood = useRef<Script>('latin');
  if (error) lastGood.current = 'latin';
  else if (shellLoader.isLoaded(script)) lastGood.current = script;
  return { ready: error !== null || shellLoader.isLoaded(script), script: lastGood.current, error };
}

/**
 * Font for a generated app, picked from its own language (`spec.lang`), not from Settings. Loads the script
 * font in the background and returns Latin (keep Inter) until it is ready, then re-renders.
 */
export function useRuntimeFont(lang: string | null | undefined): RuntimeFont {
  const tag = lang && lang.trim() ? lang : 'en';
  const fonts = useScriptFonts(tag);
  return useMemo(() => runtimeFont(tag, fonts.script), [tag, fonts.script]);
}
