/**
 * Kalam UI internationalisation (docs/10 §11-14).
 *
 * UI code:      `import { useT, useI18n, useFormat } from '@/i18n'`
 * Non-React:    `import { t } from '@/i18n'` (uses the language set by `useI18nBoot`)
 * Engine/core:  import from the specific files (`@/i18n/engine-messages`, `@/i18n/format`), never from this
 *               barrel, so pure modules do not pull in React or the settings store.
 */
export { getTranslator, getActiveLanguage, setActiveLanguage, t, td } from './active';
export {
  getCatalogue, isCatalogueLoaded, isCatalogueSettled, loadCatalogue, parseCatalogue, registerCatalogue,
} from './catalogue';
export { ENGINE_KEYS, ENGINE_MESSAGES, engineText, type EngineKey } from './engine-messages';
export { createFormatter, type DateInput, type DateStyle, type Formatter, type FormatterOptions } from './format';
export type { TranslationKey } from './keys';
export {
  languageOptions, languagePatch, onboardingPatch, resolveLanguages,
  type LanguageOption, type LanguageRole, type LanguageSelection,
} from './language-prefs';
export {
  DEFAULT_LANGUAGE, LANGUAGE_CODES, LANGUAGES, htmlLang, isLanguageCode, languageInfo, localeFor,
  pickSupportedLanguage, resolveLanguage, textDirection, type LanguageCode, type LanguageInfo,
} from './languages';
export { graphemeCount, graphemes, truncateGraphemes } from './graphemes';
export { pluralCategory } from './plural';
export { toLogicalStyle, startSide } from './direction';
export { LanguageSettings } from './LanguageSettings';
export { useFormat, useI18n, useI18nBoot, useLanguage, useT } from './react';
export { runtimeFont, type RuntimeFont } from './runtime-font';
export {
  NON_LATIN_SCRIPTS, SCRIPTS, detectScript, detectScripts, fontScriptsForLanguages, scriptFontCssStack,
  scriptFontFamilies, scriptFontFamily, scriptForLanguage,
  type NonLatinScript, type Script, type ScriptFontWeight,
} from './scripts';
export { createTranslator, type DynamicTFunction, type TFunction, type Translator } from './translator';
export type { MissingEvent, TranslateOptions, TranslateParams } from './types';
export { isScriptLoaded, loadFontsForText, loadScriptFonts, useRuntimeFont, useScriptFonts, type ScriptFontsState } from './use-script-fonts';
