/**
 * Translators bound to the shared catalogue registry, plus an "active language" for code that runs
 * outside React (services, toasts raised from stores). React code should use `useT()` instead.
 * Pure TypeScript.
 */
import { getCatalogueVersion } from './catalogue';
import { DEFAULT_LANGUAGE, resolveLanguage, type LanguageCode } from './languages';
import { createTranslator, type DynamicTFunction, type TFunction, type Translator } from './translator';

const cache = new Map<LanguageCode, Translator>();
let cachedVersion = -1;

/**
 * Translator for a language. The same object is returned until a catalogue loads, so it is safe to
 * use as a dependency in memo hooks. A loaded catalogue produces a new object.
 */
export function getTranslator(language: string): Translator {
  const version = getCatalogueVersion();
  if (version !== cachedVersion) {
    cache.clear();
    cachedVersion = version;
  }
  const code = resolveLanguage(language);
  let translator = cache.get(code);
  if (!translator) {
    translator = createTranslator(code);
    cache.set(code, translator);
  }
  return translator;
}

let activeLanguage: LanguageCode = DEFAULT_LANGUAGE;

/** Sets the language used by the global `t`. `useI18nBoot()` keeps this in step with Settings. */
export function setActiveLanguage(language: string): void {
  activeLanguage = resolveLanguage(language);
}

export function getActiveLanguage(): LanguageCode {
  return activeLanguage;
}

/** Translate with the active language. For non-React code. */
export const t: TFunction = (key, params, options) => getTranslator(activeLanguage).t(key, params, options);

/** Like `t`, for keys built at run time. */
export const td: DynamicTFunction = (key, params, options) => getTranslator(activeLanguage).td(key, params, options);
