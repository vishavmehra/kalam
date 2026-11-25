/**
 * Language helpers for translating the labels of a generated app (docs/10 §14-15, docs/17 §7.6).
 * Pure TypeScript. The ten planned languages come from the shared i18n module.
 */
import { LANGUAGES } from '../../i18n/languages';
import { scriptForLanguage } from '../../i18n/scripts';

export interface TranslationLanguage {
  /** Primary language subtag, lower case: `hi`. */
  code: string;
  /** Name in English: `Hindi`. */
  english: string;
  /** Name in its own script: `हिन्दी`. */
  native: string;
}

/** The ten planned languages (docs/17 §7.6): the targets people can pick for any app. */
export const TRANSLATION_LANGUAGES: readonly TranslationLanguage[] = LANGUAGES.map((l) => ({
  code: l.code,
  english: l.english,
  native: l.native,
}));

/** `hi-IN` and `HI_in` both give `hi`. Empty string when the tag is not a language code. */
export function baseLang(tag: string | null | undefined): string {
  const first = (tag ?? '').trim().split(/[-_]/)[0] ?? '';
  return /^[A-Za-z]{2,3}$/.test(first) ? first.toLowerCase() : '';
}

/** English name of a language for messages. Falls back to Intl, then to the code. */
export function languageLabel(tag: string | null | undefined): string {
  const code = baseLang(tag);
  const known = TRANSLATION_LANGUAGES.find((l) => l.code === code);
  if (known) return known.english;
  try {
    if (typeof Intl !== 'undefined' && 'DisplayNames' in Intl) {
      const name = new Intl.DisplayNames(['en'], { type: 'language' }).of(code);
      if (name && name !== code) return name;
    }
  } catch {
    /* an unknown tag: use the code */
  }
  return code || String(tag ?? '');
}

/** Name of a language in its own script when Kalam knows it, otherwise the English name. */
export function nativeLanguageName(tag: string | null | undefined): string {
  const code = baseLang(tag);
  return TRANSLATION_LANGUAGES.find((l) => l.code === code)?.native ?? languageLabel(tag);
}

/**
 * Languages the on-device model can read AND write in this build.
 *
 * Gemini Nano through the Prompt API is asked for English only today (`TEXT_IO` in
 * `src/infrastructure/firebase/on-device.web.ts` declares `languages: ['en']`), and docs/17 §7.6 says not
 * to claim Nano supports the ten Indian languages until that is tested. So no real translation runs on the
 * device yet: every pair routes to Firebase cloud. When `TEXT_IO` grows (Chrome documents en, es and ja),
 * extend this list in the same change, or pass `onDeviceLanguages` to `createTranslateService`.
 */
export const ON_DEVICE_TRANSLATION_LANGUAGES: readonly string[] = ['en'];

/** True when both languages are supported on-device and they differ. */
export function onDeviceCanTranslate(
  source: string,
  target: string,
  supported: readonly string[] = ON_DEVICE_TRANSLATION_LANGUAGES,
): boolean {
  const s = baseLang(source);
  const t = baseLang(target);
  return !!s && !!t && s !== t && supported.includes(s) && supported.includes(t);
}

/** True for languages written in an Indian script (the prompt then asks for native script, not Latin letters). */
export function usesNativeScript(tag: string | null | undefined): boolean {
  return scriptForLanguage(tag) !== 'latin';
}
