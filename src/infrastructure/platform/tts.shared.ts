/**
 * Shared text-to-speech types and pure helpers (docs/10 §4.4, §16.2). Platform adapters live in
 * `tts.web.ts` (speechSynthesis) and `tts.native.ts` (expo-speech). The queue in `tts-queue.ts`
 * sits on top of an adapter so that read-aloud and the voice agent never talk over each other.
 *
 * No React, no react-native, no expo imports: this file runs under Vitest in Node.
 */
export interface SpeechVoice {
  /** Platform voice identifier (web voiceURI, Android voice name). */
  id: string;
  name: string;
  /** BCP-47 tag, normalised to hyphens ("hi-IN"). */
  language: string;
  /** True when the voice runs on this device without a network call. */
  local: boolean;
  isDefault?: boolean;
}

export interface SpeakOptions {
  language?: string;
  voiceId?: string;
  /** 0.5 to 2.0. */
  rate?: number;
  interrupt?: boolean;
}

/** Platform abstraction from docs/10 §4.4. */
export interface TextToSpeechAdapter {
  isAvailable(): Promise<boolean>;
  getVoices(): Promise<SpeechVoice[]>;
  /** Resolves when the text has been spoken, stopped, or could not be spoken. */
  speak(text: string, options?: SpeakOptions): Promise<void>;
  stop(): Promise<void>;
}

export const MIN_RATE = 0.5;
export const MAX_RATE = 2;

export function clampRate(rate: number | undefined): number {
  if (rate === undefined || !Number.isFinite(rate)) return 1;
  return Math.min(MAX_RATE, Math.max(MIN_RATE, rate));
}

/** Android reports some voices with three-letter ISO 639-2 codes. */
const ISO3: Record<string, string> = {
  eng: 'en', hin: 'hi', guj: 'gu', mar: 'mr', ben: 'bn', tam: 'ta', tel: 'te', kan: 'kn', mal: 'ml', pan: 'pa',
};

/** "hi_IN" and "hin-IND" both become tags this module can compare. */
export function normalizeLanguageTag(tag: string | undefined): string {
  if (!tag) return '';
  const [lang = '', region] = tag.replace(/_/g, '-').split('-');
  const base = ISO3[lang.toLowerCase()] ?? lang.toLowerCase();
  if (!region) return base;
  const reg = region.length === 3 && region.toUpperCase() === 'IND' ? 'IN' : region.toUpperCase();
  return `${base}-${reg}`;
}

/** "hi-IN" → "hi". */
export function languageBase(tag: string | undefined): string {
  return normalizeLanguageTag(tag).split('-')[0] ?? '';
}

export type VoiceMatch = 'voice' | 'language' | 'language_base' | 'none';

export interface VoiceChoice {
  voice?: SpeechVoice;
  /**
   * voice: the person's chosen voice. language: same language and region. language_base: same language,
   * another region. none: nothing suitable is installed, so the platform default will be used.
   */
  match: VoiceMatch;
}

function rank(v: SpeechVoice): number {
  return (v.local ? 2 : 0) + (v.isDefault ? 1 : 0);
}

/**
 * Picks a voice for the settings. Never picks a voice for a different language silently: when only
 * a related voice exists the result says so, and when none exists `voice` is undefined.
 */
export function chooseVoice(
  voices: readonly SpeechVoice[], want: { voiceId?: string; language?: string },
): VoiceChoice {
  if (want.voiceId) {
    const chosen = voices.find((v) => v.id === want.voiceId);
    if (chosen) return { voice: chosen, match: 'voice' };
  }
  const lang = normalizeLanguageTag(want.language);
  if (!lang) return { match: 'none' };
  const best = (list: SpeechVoice[]) => [...list].sort((a, b) => rank(b) - rank(a))[0];
  const exact = best(voices.filter((v) => normalizeLanguageTag(v.language) === lang));
  if (exact) return { voice: exact, match: 'language' };
  const base = languageBase(lang);
  const related = best(voices.filter((v) => languageBase(v.language) === base));
  if (related) return { voice: related, match: 'language_base' };
  return { match: 'none' };
}

/** Voices installed for the language (same base), best first. */
export function voicesForLanguage(voices: readonly SpeechVoice[], language: string): SpeechVoice[] {
  const base = languageBase(language);
  return voices.filter((v) => languageBase(v.language) === base).sort((a, b) => rank(b) - rank(a) || a.name.localeCompare(b.name));
}

const MAX_SPOKEN_CHARS = 600;

/** One tidy line: no markup, no stray whitespace, bounded length. */
export function normalizeSpeechText(text: string): string {
  const cleaned = text
    .replace(/[*_`#>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length <= MAX_SPOKEN_CHARS) return cleaned;
  const cut = cleaned.slice(0, MAX_SPOKEN_CHARS);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
  return stop > MAX_SPOKEN_CHARS * 0.5 ? cut.slice(0, stop + 1) : cut.trimEnd();
}

/**
 * Splits text at sentence ends so long announcements stay under the length where Chrome's
 * speechSynthesis stops mid-sentence.
 */
export function chunkForSpeech(text: string, maxChars = 180): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];
  const sentences = clean.match(/[^.!?।]+[.!?।]*\s*/gu) ?? [clean];
  const out: string[] = [];
  let current = '';
  const flush = () => {
    if (current.trim()) out.push(current.trim());
    current = '';
  };
  for (const raw of sentences) {
    let sentence = raw;
    while (sentence.length > maxChars) {
      const at = sentence.lastIndexOf(' ', maxChars);
      const cut = at > maxChars * 0.4 ? at : maxChars;
      flush();
      out.push(sentence.slice(0, cut).trim());
      sentence = sentence.slice(cut);
    }
    if ((current + sentence).length > maxChars) flush();
    current += sentence;
  }
  flush();
  return out;
}
