/**
 * Shared speech-to-text types and helpers (docs/06 §2.3). Platform implementations live in
 * `speech.web.ts` (Web Speech API) and `speech.native.ts` (expo-speech-recognition).
 *
 * Privacy: on-device recognition is used whenever available. Otherwise recognition runs on the
 * platform's speech service (cloud) and callers must obtain explicit consent first.
 * Kalam never uploads the raw recording itself, and does not keep it unless `keepRecording` is set.
 */
export type OnDeviceSpeech = 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'unknown';

export interface SpeechCapability {
  /** Any speech recognition exists on this platform. */
  supported: boolean;
  onDevice: OnDeviceSpeech;
  locale: string;
}

export interface DictationCallbacks {
  /** Full transcript so far (all segments), plus whether the latest segment is final. */
  onText(text: string, isFinal: boolean): void;
  onError(message: string): void;
  /** Recognition ended; `audioUri` is a local recording when the platform kept one. */
  onEnd(result: { audioUri?: string }): void;
}

/** Options for `startDictation` on every platform. */
export interface StartDictationOptions extends DictationCallbacks {
  /** BCP-47 tag ("hi-IN") or an app language code ("hi"). */
  lang: string;
  onDevice: boolean;
  /**
   * Keep a copy of the recording on this device. Default false: raw audio is deleted as soon as it has
   * been turned into text (docs/11 §7.3). Audio is never uploaded by Kalam either way.
   */
  keepRecording?: boolean;
  /** Words the recogniser should expect, such as field labels and options (Android uses them). */
  hints?: string[];
}

export interface DictationSession {
  readonly location: 'on_device' | 'cloud_service';
  stop(): void;
  abort(): void;
}

/** App language code → BCP-47 recognition locale. */
export function speechLocale(lang: string): string {
  if (lang.includes('-')) return lang;
  return lang === 'en' ? 'en-US' : `${lang}-IN`;
}

/** Plain-language messages for recognition error codes shared by both platforms. */
export function speechErrorMessage(code: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone or speech access is off. Allow it in settings, or type your idea instead.';
    case 'network':
      return 'The speech service could not be reached. Check your connection, or type your idea instead.';
    case 'no-speech':
    case 'speech-timeout':
    case 'nomatch':
      return 'Kalam did not hear anything. Try again a little closer to the microphone.';
    case 'language-not-supported':
      return 'Speech recognition does not support this language here. Try English or type instead.';
    case 'audio-capture':
      return 'No microphone was found.';
    case 'aborted':
      return '';
    default:
      return 'Speech recognition stopped unexpectedly. Your transcript so far is kept.';
  }
}
