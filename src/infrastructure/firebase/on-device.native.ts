/**
 * Android on-device AI (docs/07 §6, docs/17 §5 and §12.2). Gemini Nano runs in the kalam-nano native module
 * through Firebase AI Logic's Android on-device SDK (firebase-ai-ondevice 16.0.0-beta08: the ML Kit Prompt
 * API on AICore). Sources, read 2026-11-18: https://firebase.google.com/docs/ai-logic/hybrid/android/get-started
 * and the supported phones at https://developers.google.com/ml-kit/genai#prompt-device (Pixel 9 and newer,
 * Galaxy S25 and newer, and others). Emulators have no AICore, so they report 'unavailable'.
 *
 * Choosing device or cloud stays in Firebase AI Logic's JS SDK, as on the web. getLanguageModel() returns the
 * Prompt-API-shaped adapter from prompt-api.native.ts (shared with iOS) and installs it as
 * globalThis.LanguageModel, so firebase/ai's hybrid router picks the phone or the cloud and
 * response.inferenceSource says which one ran. iOS uses on-device.ios.ts instead of this file.
 */
import type { OnDeviceStatus } from '@/core/contracts';
import { loadKalamNano, type KalamNanoModule } from '../../../modules/kalam-nano';
import type { LanguageModelStatic } from './on-device.web';
import { createPromptLanguageModel, errorMessage as message, promptError, type PromptLanguageModel } from './prompt-api.native';

export { TEXT_IO, type LanguageModelStatic } from './on-device.web';

/** Model name reported for answers from this phone (firebase-provider uses ON_DEVICE_MODEL today). */
export const ON_DEVICE_MODEL_NAME = 'gemini-nano';

const KNOWN = new Set<string>(['unavailable', 'downloadable', 'downloading', 'available']);
/** Firebase and ML Kit have validated on-device output in English and Korean only (get-started, 2026-11-18). */
const VALIDATED_LANGUAGES = new Set(['en', 'ko']);

let adapter: PromptLanguageModel | undefined;
let progress: number | undefined;
let warm = false;
let warming: Promise<OnDeviceStatus> | undefined;

/**
 * Kalam's adapter, or undefined without the native module. Never another global LanguageModel, so an
 * only_on_device request cannot run on something that is not Gemini Nano on this phone.
 */
export function getLanguageModel(): LanguageModelStatic | undefined {
  if (!adapter) {
    const nano = loadKalamNano();
    if (!nano.module) return undefined;
    adapter = createPromptLanguageModel(nanoEngine(nano.module), 'nano');
    (globalThis as { LanguageModel?: LanguageModelStatic }).LanguageModel = adapter;
  }
  return adapter;
}

// firebase/ai looks for globalThis.LanguageModel each time a GenerativeModel is made, in every mode, so the
// adapter goes in when this module loads rather than on the provider's first on-device check.
getLanguageModel();

export async function onDeviceStatus(): Promise<OnDeviceStatus> {
  const nano = loadKalamNano();
  if (!nano.module) return { platform: 'android', apiExposed: false, availability: 'unavailable', detail: nano.reason };
  try {
    const s = await nano.module.availability();
    const availability = KNOWN.has(s.availability) ? s.availability : 'unknown';
    const ready = availability === 'available';
    return {
      platform: 'android', apiExposed: true, availability,
      progress: availability === 'downloading' ? progress : undefined,
      detail: s.detail ?? (ready && s.model ? `Model on this phone: ${s.model}` : undefined),
      ...(ready ? { warm } : {}),
    };
  } catch (e) {
    return { platform: 'android', apiExposed: true, availability: 'unknown', detail: message(e) };
  }
}

/** Downloads Gemini Nano through AICore when needed (a user action in Settings), then loads it. */
export async function prepareOnDevice(onProgress?: (p: number) => void): Promise<OnDeviceStatus> {
  const nano = loadKalamNano();
  if (!nano.module) return onDeviceStatus();
  const sub = nano.module.addListener('onDownloadProgress', (e) => {
    if (!e.bytesToDownload) return;
    progress = Math.min(1, e.bytesDownloaded / e.bytesToDownload);
    onProgress?.(progress);
  });
  try {
    warm = (await nano.module.prepare()).availability === 'available';
  } catch (e) {
    return { ...(await onDeviceStatus()), detail: message(e) };
  } finally {
    sub.remove();
  }
  return onDeviceStatus();
}

/** Loads an already downloaded model into memory. Never downloads. Concurrent calls share one load. */
export function warmUpOnDevice(): Promise<OnDeviceStatus> {
  warming ??= (async () => {
    const status = await onDeviceStatus();
    const nano = loadKalamNano();
    if (!nano.module || status.availability !== 'available' || warm) return status;
    try {
      warm = await nano.module.warmUp();
    } catch (e) {
      return { ...status, warm: false, detail: message(e) };
    }
    return { ...status, warm };
  })().finally(() => {
    warming = undefined;
  });
  return warming;
}

function nanoEngine(native: KalamNanoModule) {
  return {
    // Only 'available' counts: on a phone the download is the user's choice, made in Settings through
    // prepareOnDevice(). Languages: only the validated ones.
    ready: async (languages: string[]) => languages.every((l) => VALIDATED_LANGUAGES.has(l))
      && (await native.availability()).availability === 'available',
    generate: (id: string, options: { prompt: string }) => native.generate(id, options),
    cancel: (id: string) => native.cancel(id),
    toPromptError,
  };
}

/** AICore failure messages are unverified until a device run; anything unrecognised stays UnknownError. */
function toPromptError(e: unknown): Error {
  const msg = message(e);
  if (/BACKGROUND/i.test(msg)) return promptError('NotAllowedError', 'Android runs on-device AI only while Kalam is on screen.');
  if (/token|too large|too long/i.test(msg)) return promptError('QuotaExceededError', msg);
  return promptError('UnknownError', msg);
}
