/**
 * Languages offered for speech recognition and speech output (docs/10 §11.1, §16). Recognition and
 * speech output are separate choices: a device can hear Gujarati and still have no Gujarati voice.
 * Pure TypeScript.
 */
import { speechServiceName } from '@/infrastructure/platform/speech.shared';
import { clampRate } from '@/infrastructure/platform/tts.shared';

export { speechServiceName };

export interface SpeechLanguage {
  /** BCP-47 tag handed to the speech platform. */
  tag: string;
  /** Name in its own script. Never translated. */
  native: string;
  english: string;
  /** A short sentence for "Test voice", in the language itself. */
  sample: string;
}

export const SPEECH_LANGUAGES: readonly SpeechLanguage[] = [
  { tag: 'en-IN', native: 'English (India)', english: 'English (India)', sample: 'This is how Kalam will sound.' },
  { tag: 'en-US', native: 'English (US)', english: 'English (US)', sample: 'This is how Kalam will sound.' },
  { tag: 'en-GB', native: 'English (UK)', english: 'English (UK)', sample: 'This is how Kalam will sound.' },
  { tag: 'hi-IN', native: 'हिन्दी', english: 'Hindi', sample: 'Kalam की आवाज़ ऐसी सुनाई देगी।' },
  { tag: 'gu-IN', native: 'ગુજરાતી', english: 'Gujarati', sample: 'Kalam નો અવાજ આવો સંભળાશે.' },
  { tag: 'mr-IN', native: 'मराठी', english: 'Marathi', sample: 'Kalam चा आवाज असा ऐकू येईल.' },
  { tag: 'bn-IN', native: 'বাংলা', english: 'Bengali', sample: 'Kalam-এর কণ্ঠস্বর এমন শোনাবে।' },
  { tag: 'ta-IN', native: 'தமிழ்', english: 'Tamil', sample: 'Kalam குரல் இப்படி ஒலிக்கும்.' },
  { tag: 'te-IN', native: 'తెలుగు', english: 'Telugu', sample: 'Kalam గొంతు ఇలా వినిపిస్తుంది.' },
  { tag: 'kn-IN', native: 'ಕನ್ನಡ', english: 'Kannada', sample: 'Kalam ಧ್ವನಿ ಹೀಗೆ ಕೇಳಿಸುತ್ತದೆ.' },
  { tag: 'ml-IN', native: 'മലയാളം', english: 'Malayalam', sample: 'Kalam-ന്റെ ശബ്ദം ഇങ്ങനെയായിരിക്കും.' },
  { tag: 'pa-IN', native: 'ਪੰਜਾਬੀ', english: 'Punjabi', sample: 'Kalam ਦੀ ਆਵਾਜ਼ ਇਸ ਤਰ੍ਹਾਂ ਸੁਣਾਈ ਦੇਵੇਗੀ।' },
];

export function findSpeechLanguage(tag: string): SpeechLanguage | undefined {
  return SPEECH_LANGUAGES.find((l) => l.tag.toLowerCase() === tag.replace('_', '-').toLowerCase());
}

export const RATE_STEP = 0.25;

/** One step slower (-1) or faster (+1), kept inside 0.5 to 2 and free of float noise. */
export function stepRate(rate: number, direction: 1 | -1): number {
  const next = Math.round((clampRate(rate) + direction * RATE_STEP) / RATE_STEP) * RATE_STEP;
  return clampRate(Number(next.toFixed(2)));
}

/** "1x", "1.25x", "0.75x". */
export function formatRate(rate: number): string {
  return `${Number(clampRate(rate).toFixed(2))}x`;
}
