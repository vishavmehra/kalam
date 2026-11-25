/**
 * React bindings. The language comes from Settings (`settings.language`), which is read only here.
 * Changing the language in Settings re-renders every component that uses these hooks.
 */
import { useEffect, useRef, useSyncExternalStore } from 'react';

import { useSettingsStore } from '@/state/settings-store';

import { getTranslator, setActiveLanguage } from './active';
import { getCatalogueVersion, isCatalogueSettled, loadCatalogue, subscribeCatalogues } from './catalogue';
import type { Formatter } from './format';
import { resolveLanguage, type LanguageCode } from './languages';
import type { TFunction, Translator } from './translator';
import { useScriptFonts } from './use-script-fonts';

/** The UI language from Settings, normalised to a supported code. */
export function useLanguage(): LanguageCode {
  return resolveLanguage(useSettingsStore((s) => s.settings.language));
}

/**
 * Translator for the UI language, or for `language` when given. Pass an app's own language to render
 * that app's chrome in it: the Studio language and an app's language are independent (docs/10 §11).
 * Starts loading the catalogue if it is not loaded yet; English shows until it arrives.
 */
export function useI18n(language?: string): Translator {
  const settingsLanguage = useSettingsStore((s) => s.settings.language);
  const code = resolveLanguage(language ?? settingsLanguage);
  // Re-render when any catalogue finishes loading.
  useSyncExternalStore(subscribeCatalogues, getCatalogueVersion, getCatalogueVersion);
  useEffect(() => {
    void loadCatalogue(code);
  }, [code]);
  return getTranslator(code);
}

/** `t` for the UI language. The function identity changes only when the language or its catalogue changes. */
export function useT(language?: string): TFunction {
  return useI18n(language).t;
}

/** Number, date, currency and relative-time formatting for the UI language. */
export function useFormat(language?: string): Formatter {
  return useI18n(language).format;
}

/**
 * Call once in the root layout. Loads the catalogue and the script fonts for the language in Settings,
 * points the global `t` at it, and reports when the first screen can be shown.
 *
 * `ready` becomes true once and stays true, so a later language switch never unmounts the app.
 * Pass `settingsReady` as `hydrated || loadFailed` from the root layout.
 */
export function useI18nBoot(settingsReady: boolean): { ready: boolean } {
  const language = useLanguage();
  const fonts = useScriptFonts();
  useSyncExternalStore(subscribeCatalogues, getCatalogueVersion, getCatalogueVersion);
  setActiveLanguage(language);
  useEffect(() => {
    void loadCatalogue(language);
  }, [language]);

  const latched = useRef(false);
  if (settingsReady && isCatalogueSettled(language) && fonts.ready) latched.current = true;
  return { ready: latched.current };
}
