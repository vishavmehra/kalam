/**
 * The five independent languages (docs/10 §11, §11.2) and the settings patches that change each one.
 *
 *   studio  = language of Kalam's own screens        settings.language
 *   newApp  = default language of NEW apps           settings.newAppLanguage
 *   app     = language of one generated app          spec.lang (set per app, never changed by the others)
 *   stt     = speech recognition language            settings.speech.sttLanguage
 *   tts     = read-aloud language                    settings.speech.ttsLanguage
 *
 * Changing one never rewrites the others, except through `onboardingPatch`, which sets all of them once
 * at first run. Pure TypeScript.
 */
import { DEFAULT_SPEECH, type KalamSettings, type SpeechPreferences } from '@/core/contracts';

import { LANGUAGES, htmlLang, localeFor, resolveLanguage, type LanguageCode } from './languages';

export type LanguageRole = 'studio' | 'newApp' | 'stt' | 'tts';

export interface LanguageSelection {
  studio: LanguageCode;
  /** BCP-47 tag. May be a language Kalam has no screens for. */
  newApp: string;
  /** BCP-47 speech tags, for example `hi-IN`. */
  stt: string;
  tts: string;
}

type LanguageSettings = Pick<KalamSettings, 'language' | 'newAppLanguage' | 'speech'>;

/** The effective value of each role. Matches what the voice code reads: `settings.speech ?? DEFAULT_SPEECH`. */
export function resolveLanguages(settings: LanguageSettings): LanguageSelection {
  const studio = resolveLanguage(settings.language);
  const speech = settings.speech ?? DEFAULT_SPEECH;
  return {
    studio,
    newApp: settings.newAppLanguage ? htmlLang(settings.newAppLanguage) : studio,
    stt: speech.sttLanguage,
    tts: speech.ttsLanguage,
  };
}

/** What the picker for each role offers: one entry per supported language, shown in its own script. */
export interface LanguageOption {
  /** Value to store: a language code for studio and newApp, a regional tag for speech. */
  value: string;
  native: string;
  english: string;
  /** Language code for the `lang` attribute on the label. */
  lang: LanguageCode;
}

export function languageOptions(role: LanguageRole): LanguageOption[] {
  const speech = role === 'stt' || role === 'tts';
  return LANGUAGES.map((l) => ({ value: speech ? l.locale : l.code, native: l.native, english: l.english, lang: l.code }));
}

/** Settings patch for changing one role. Leaves every other role alone. */
export function languagePatch(role: LanguageRole, value: string, settings: LanguageSettings): Partial<KalamSettings> {
  if (role === 'studio') return { language: resolveLanguage(value) };
  if (role === 'newApp') return { newAppLanguage: htmlLang(value) };
  const speech: SpeechPreferences = { ...DEFAULT_SPEECH, ...settings.speech };
  return { speech: role === 'stt' ? { ...speech, sttLanguage: value } : { ...speech, ttsLanguage: value } };
}

/**
 * Patch for the first-run language question ("Used for new apps, voice and read-aloud"): sets the
 * Studio, new-app, speech and read-aloud languages together. The person can split them later in Settings.
 */
export function onboardingPatch(code: string, settings: LanguageSettings): Partial<KalamSettings> {
  const language = resolveLanguage(code);
  const locale = localeFor(language);
  const speech: SpeechPreferences = { ...DEFAULT_SPEECH, ...settings.speech, sttLanguage: locale, ttsLanguage: locale };
  return { language, newAppLanguage: language, speech };
}
