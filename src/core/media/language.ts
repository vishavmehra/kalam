/**
 * Transcript language identification (docs/06 §8.6, docs/15 §8.4). Deterministic first: the Unicode
 * script of the transcript names the language for nine of the ten target languages. A speech
 * service's own detection (Android 14+) wins when it is confident and in the supported list.
 */

export const SPEECH_LANGUAGES = ['en', 'hi', 'gu', 'mr', 'bn', 'ta', 'te', 'kn', 'ml', 'pa'] as const;
export type SpeechLanguage = (typeof SPEECH_LANGUAGES)[number];

export interface DetectedLanguage {
  code: SpeechLanguage;
  /** Share of letters in that script (script) or the service's own confidence. */
  confidence: number;
  source: 'speech_service' | 'script';
}

const SCRIPTS: Array<[number, number, SpeechLanguage]> = [
  [0x0900, 0x097f, 'hi'], // Devanagari: Hindi or Marathi
  [0x0980, 0x09ff, 'bn'],
  [0x0a00, 0x0a7f, 'pa'], // Gurmukhi
  [0x0a80, 0x0aff, 'gu'],
  [0x0b80, 0x0bff, 'ta'],
  [0x0c00, 0x0c7f, 'te'],
  [0x0c80, 0x0cff, 'kn'],
  [0x0d00, 0x0d7f, 'ml'],
];

const base = (tag: string) => tag.split('-')[0]!.toLowerCase();
const isSupported = (code: string): code is SpeechLanguage => (SPEECH_LANGUAGES as readonly string[]).includes(code);

/**
 * Language from the script of `text`. Devanagari is Hindi unless the person's speech language is
 * Marathi. Latin letters read as English (romanised Hindi cannot be told apart by script).
 */
export function scriptLanguage(text: string, preferred?: string): DetectedLanguage | undefined {
  const counts = new Map<SpeechLanguage, number>();
  let letters = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    let lang: SpeechLanguage | undefined;
    if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)) lang = 'en';
    else lang = SCRIPTS.find(([lo, hi]) => c >= lo && c <= hi)?.[2];
    if (!lang) continue;
    letters++;
    counts.set(lang, (counts.get(lang) ?? 0) + 1);
  }
  if (letters < 3) return undefined;
  let best: SpeechLanguage = 'en';
  let n = -1;
  for (const [lang, k] of counts) if (k > n) { best = lang; n = k; }
  if (best === 'hi' && preferred && base(preferred) === 'mr') best = 'mr';
  return { code: best, confidence: Math.round((n / letters) * 100) / 100, source: 'script' };
}

/** A speech service's report, accepted when supported and at least "not confident" (0.5). */
export function serviceLanguage(detected: string | undefined, confidence: number | undefined): DetectedLanguage | undefined {
  if (!detected) return undefined;
  const code = base(detected);
  if (!isSupported(code) || !(typeof confidence === 'number' && confidence >= 0.5)) return undefined;
  return { code, confidence, source: 'speech_service' };
}

/** The service result when present, else the script reading. */
export function identifyLanguage(text: string, opts: { preferred?: string; service?: DetectedLanguage } = {}): DetectedLanguage | undefined {
  return opts.service ?? scriptLanguage(text, opts.preferred);
}

/** True when the detected language differs from the app's language. */
export function differsFrom(detected: DetectedLanguage | undefined, appLanguage: string): boolean {
  return !!detected && detected.confidence >= 0.6 && detected.code !== base(appLanguage);
}
