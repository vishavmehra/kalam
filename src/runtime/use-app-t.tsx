/**
 * React side of the words a running app shows (engine/words.ts). KalamRuntime wraps what it draws in
 * `<AppLanguageProvider value={spec.lang}>`; a block calls `useAppT()` or `useV11Words()` and gets
 * its words in the app's language, and again once that language's catalogue has loaded. A block
 * can also be given a `lang` directly (a gallery preview, a test).
 */
import { createContext, useContext, useEffect, useSyncExternalStore } from 'react';
import { getCatalogueVersion, loadCatalogue, subscribeCatalogues } from '@/i18n/catalogue';
import { resolveLanguage } from '@/i18n/languages';
import type { TFunction } from '@/i18n/translator';
import { v11Words, type V11Words } from './engine/v11/copy';
import { appT } from './engine/words';

const AppLanguage = createContext<string>('en');

export const AppLanguageProvider = AppLanguage.Provider;

/** The language this part of the app is shown in: `lang` when given, else the running app's own. */
export function useAppLanguage(lang?: string): string {
  const inherited = useContext(AppLanguage);
  const language = lang ?? inherited;
  // Re-render when a catalogue arrives, so English gives way to the app's language.
  useSyncExternalStore(subscribeCatalogues, getCatalogueVersion, getCatalogueVersion);
  const code = resolveLanguage(language);
  useEffect(() => {
    void loadCatalogue(code);
  }, [code]);
  return language;
}

/** `t` for the app's language (keys under `runtime.*`). */
export function useAppT(lang?: string): TFunction {
  return appT(useAppLanguage(lang));
}

/** The 1.1 words (timer, reminder, signature, links, suggested modes) in the app's language. */
export function useV11Words(lang?: string): V11Words {
  return v11Words(useAppLanguage(lang));
}
