import type { SpeechCapability } from '@/infrastructure/platform/speech.shared';

/** Initial language set (docs/10 §11.1). One list for the whole app; it lives in src/i18n. */
export { LANGUAGES, type LanguageCode } from '@/i18n/languages';

/**
 * What the active speech provider can do for one language (docs/06 §8.6): listen on this device, listen after a
 * download, listen only through the platform's online speech service (which needs consent), or not at all.
 */
export type Recogniser = 'on_device' | 'downloadable' | 'service' | 'service_off' | 'unsupported';

/** Undefined until the language has been checked. */
export function recogniserFor(cap: SpeechCapability | undefined, cloudAllowed: boolean): Recogniser | undefined {
  if (!cap) return undefined;
  if (!cap.supported) return 'unsupported';
  if (cap.onDevice === 'available') return 'on_device';
  if (cap.onDevice === 'downloadable' || cap.onDevice === 'downloading') return 'downloadable';
  // 'unavailable' or 'unknown' on this device: only the online service is left, and it may be switched off.
  return cloudAllowed ? 'service' : 'service_off';
}

/**
 * A language is offered for listening unless it has been checked and cannot be recognised. An unchecked one is
 * not called supported either: the screen says nothing about it until it has been checked.
 */
export const canListenIn = (r: Recogniser | undefined): boolean => r === undefined || r === 'on_device' || r === 'downloadable' || r === 'service';
