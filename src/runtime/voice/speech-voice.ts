/**
 * Which language, voice and rate to speak with (docs/10 §16.2). Pure TypeScript.
 *
 * The speech settings name a language ("hi-IN") and maybe a voice chosen for it. An app's own text
 * is written in the app's language, so a Hindi app is read with a Hindi voice even when the saved
 * language is English. The saved voice is used only for the language it was chosen for.
 */
import type { SpeechPreferences } from '@/core/contracts';
import { clampRate, languageBase, normalizeLanguageTag } from '@/infrastructure/platform/tts.shared';

export interface SpokenVoice {
  language: string;
  voiceId?: string;
  rate: number;
}

export function speechVoiceFor(prefs: SpeechPreferences, appLang: string): SpokenVoice {
  const rate = clampRate(prefs.rate);
  if (!appLang || languageBase(appLang) === languageBase(prefs.ttsLanguage)) {
    return { language: normalizeLanguageTag(prefs.ttsLanguage), voiceId: prefs.voiceId, rate };
  }
  return { language: normalizeLanguageTag(appLang), rate };
}
