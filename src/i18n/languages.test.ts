import { describe, expect, it } from 'vitest';

import { DEFAULT_SPEECH, DEFAULT_SETTINGS } from '@/core/contracts';

import { LOGICAL_STYLE_KEYS, startSide, toLogicalStyle } from './direction';
import { languageOptions, languagePatch, onboardingPatch, resolveLanguages } from './language-prefs';
import {
  LANGUAGES, LANGUAGE_CODES, htmlLang, isLanguageCode, languageInfo, localeFor, pickSupportedLanguage,
  resolveLanguage, textDirection,
} from './languages';

describe('language list', () => {
  it('has the ten docs/10 §11.1 languages with unique codes, names and locales', () => {
    expect(LANGUAGE_CODES).toEqual(['en', 'hi', 'gu', 'mr', 'bn', 'ta', 'te', 'kn', 'ml', 'pa']);
    expect(new Set(LANGUAGES.map((l) => l.native)).size).toBe(10);
    expect(new Set(LANGUAGES.map((l) => l.locale)).size).toBe(10);
    for (const l of LANGUAGES) expect(l.locale).toBe(`${l.code}-IN`);
  });
});

describe('language tags', () => {
  it('resolves region, case and separator variants', () => {
    expect(resolveLanguage('hi-IN')).toBe('hi');
    expect(resolveLanguage('HI_in')).toBe('hi');
    expect(resolveLanguage('pa-Guru-IN')).toBe('pa');
    expect(resolveLanguage('mr')).toBe('mr');
  });

  it('falls back to English for anything unsupported or unusable', () => {
    for (const tag of ['fr', 'zh-Hans', '', '   ', undefined, null, '123', 'x']) expect(resolveLanguage(tag)).toBe('en');
    expect(isLanguageCode('hi')).toBe(true);
    expect(isLanguageCode('hi-IN')).toBe(false);
  });

  it('picks the first supported device language', () => {
    expect(pickSupportedLanguage(['fr-FR', 'mr-IN', 'en-US'])).toBe('mr');
    expect(pickSupportedLanguage(['fr', 'de'])).toBe('en');
    expect(pickSupportedLanguage([])).toBe('en');
  });

  it('returns a valid lang attribute, keeping languages Kalam has no screens for', () => {
    expect(htmlLang('hi')).toBe('hi');
    expect(htmlLang('hi-in')).toBe('hi-IN');
    expect(htmlLang('pa_guru_in')).toBe('pa-Guru-IN');
    expect(htmlLang('fr')).toBe('fr');
    expect(htmlLang('')).toBe('en');
    expect(htmlLang(undefined)).toBe('en');
    expect(htmlLang('???')).toBe('en');
    expect(htmlLang('x')).toBe('en');
  });

  it('gives the regional locale used for formatting and speech', () => {
    expect(localeFor('hi')).toBe('hi-IN');
    expect(localeFor('fr')).toBe('en-IN');
    expect(languageInfo('ta-IN').english).toBe('Tamil');
  });
});

describe('direction (RTL prepared, not enabled)', () => {
  it('every shipped language is left to right', () => {
    for (const code of LANGUAGE_CODES) expect(textDirection(code)).toBe('ltr');
  });

  it('knows right-to-left languages and scripts', () => {
    expect(textDirection('ar')).toBe('rtl');
    expect(textDirection('ur-PK')).toBe('rtl');
    expect(textDirection('pa-Arab')).toBe('rtl');
  });

  it('rewrites physical left and right styles to start and end', () => {
    expect(
      toLogicalStyle({ marginLeft: 8, paddingRight: 4, left: 0, borderTopLeftRadius: 6, textAlign: 'left', color: 'red', flexDirection: 'row' }),
    ).toEqual({ marginStart: 8, paddingEnd: 4, start: 0, borderTopStartRadius: 6, textAlign: 'auto', color: 'red', flexDirection: 'row' });
    expect(toLogicalStyle({ textAlign: 'center' })).toEqual({ textAlign: 'center' });
    expect(Object.keys(LOGICAL_STYLE_KEYS).every((k) => /Left|Right|^left$|^right$/.test(k))).toBe(true);
    expect(startSide('ltr')).toBe('left');
    expect(startSide('rtl')).toBe('right');
  });
});

describe('separate languages for Studio, new apps, speech and read-aloud', () => {
  it('defaults every role from the settings the voice code already reads', () => {
    expect(resolveLanguages(DEFAULT_SETTINGS)).toEqual({ studio: 'en', newApp: 'en', stt: DEFAULT_SPEECH.sttLanguage, tts: DEFAULT_SPEECH.ttsLanguage });
  });

  it('changing one role leaves the others alone', () => {
    const base = { ...DEFAULT_SETTINGS, language: 'hi', newAppLanguage: 'gu', speech: { ...DEFAULT_SPEECH, sttLanguage: 'ta-IN', ttsLanguage: 'ta-IN' } };
    expect(languagePatch('studio', 'bn', base)).toEqual({ language: 'bn' });
    expect(languagePatch('newApp', 'ml', base)).toEqual({ newAppLanguage: 'ml' });
    const stt = languagePatch('stt', 'te-IN', base).speech!;
    expect(stt).toMatchObject({ sttLanguage: 'te-IN', ttsLanguage: 'ta-IN', rate: 1, keepRecordings: false });
    expect(languagePatch('tts', 'kn-IN', base).speech).toMatchObject({ sttLanguage: 'ta-IN', ttsLanguage: 'kn-IN' });
    expect(resolveLanguages({ ...base, ...languagePatch('studio', 'bn', base) })).toMatchObject({ studio: 'bn', newApp: 'gu', stt: 'ta-IN', tts: 'ta-IN' });
  });

  it('studio patch normalises the tag and never stores an unsupported language', () => {
    expect(languagePatch('studio', 'hi-IN', DEFAULT_SETTINGS)).toEqual({ language: 'hi' });
    expect(languagePatch('studio', 'fr', DEFAULT_SETTINGS)).toEqual({ language: 'en' });
  });

  it('a new-app language may be any valid tag, because an app can be written in a language Kalam has no screens for', () => {
    expect(languagePatch('newApp', 'fr-FR', DEFAULT_SETTINGS)).toEqual({ newAppLanguage: 'fr-FR' });
    expect(resolveLanguages({ ...DEFAULT_SETTINGS, newAppLanguage: 'fr-FR' }).newApp).toBe('fr-FR');
  });

  it('the first-run question sets all four together, and keeps other speech options', () => {
    const patch = onboardingPatch('pa', { ...DEFAULT_SETTINGS, speech: { ...DEFAULT_SPEECH, rate: 1.5, keepRecordings: true } });
    expect(patch.language).toBe('pa');
    expect(patch.newAppLanguage).toBe('pa');
    expect(patch.speech).toMatchObject({ sttLanguage: 'pa-IN', ttsLanguage: 'pa-IN', rate: 1.5, keepRecordings: true });
  });

  it('offers language codes for screens and regional tags for speech', () => {
    expect(languageOptions('studio').map((o) => o.value)).toEqual(LANGUAGE_CODES);
    expect(languageOptions('newApp')[1]).toMatchObject({ value: 'hi', native: 'हिन्दी', lang: 'hi' });
    expect(languageOptions('stt').map((o) => o.value)).toEqual(LANGUAGES.map((l) => l.locale));
    expect(languageOptions('tts')[0]?.value).toBe('en-IN');
  });
});
