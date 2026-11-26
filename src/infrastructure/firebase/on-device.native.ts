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
import type { OnDeviceReason, OnDeviceStatus } from '@/core/contracts';
import { loadKalamNano, type KalamNanoModule, type NativeStatus } from '../../../modules/kalam-nano';
import type { LanguageModelStatic } from './on-device.web';
import {
  createPromptLanguageModel, errorMessage as message, promptError, type NativePrompt, type PromptLanguageModel,
} from './prompt-api.native';

export { TEXT_IO, type LanguageModelStatic } from './on-device.web';

/** Model name reported for answers from this phone (firebase-provider reads it from './on-device'). */
export const ON_DEVICE_MODEL_NAME = 'gemini-nano';

const KNOWN = new Set<string>(['unavailable', 'downloadable', 'downloading', 'available']);

/**
 * Plain English for each reason KalamNanoModule.kt reports, shown in Settings and on the self-check. Advice from
 * https://developers.google.com/ml-kit/genai/prompt/android/get-started ("Common setup issues", read 2026-11-25).
 * Google publishes no download size for Gemini Nano, only that it is gigabytes, so the text says "a few GB".
 */
export const REASON_TEXT: Readonly<Record<OnDeviceReason, string>> = {
  aicore_missing: 'This phone does not have Android AICore, the system app that runs Gemini Nano, or its copy is too old. Update Android AICore from Google Play if it is listed there.',
  binding_failure: 'Kalam could not connect to Android AICore. This can happen right after a phone is set up, or after AICore was updated or removed. Update Android AICore from Google Play, then reinstall Kalam.',
  aicore_not_ready: 'Android AICore has not finished setting up Gemini Nano on this phone. That usually takes a few minutes to a few hours while the phone is online, and restarting the phone can speed it up. Phones with an unlocked bootloader never get it.',
  needs_system_update: 'Gemini Nano needs a newer version of Android on this phone. Install the latest system update, then try again.',
  device_not_supported: 'Gemini Nano is not offered on this phone, or Android AICore has not received its setup for it yet.',
  model_downloadable: 'Gemini Nano can be downloaded to this phone. It takes a few GB, so Wi-Fi is recommended.',
  model_downloading: 'Gemini Nano is downloading to this phone.',
  low_storage: 'There is not enough free storage on this phone for Gemini Nano. Free up a few GB, then try again.',
  battery_or_network_conditions: 'Android is holding back on-device AI for now, to save battery or because the model download needs a working internet connection. Try again later.',
  unknown: 'On-device AI is not available on this phone right now.',
};

/** The plain-English detail for a reason: its text, the error code, and for 'unknown' what Android said. */
export function reasonText(reason: OnDeviceReason, code?: number | null, raw?: string | null): string {
  const said = reason === 'unknown' && raw ? ` Android said: ${raw}` : '';
  return `${REASON_TEXT[reason]}${code == null ? '' : ` (error code ${code})`}${said}`;
}

/** The native answer as Kalam's status. A reason this build does not know reads as 'unknown'. */
function toStatus(s: NativeStatus): OnDeviceStatus {
  const availability = KNOWN.has(s.availability) ? s.availability : 'unknown';
  const ready = availability === 'available';
  const reason = ready || !s.reason ? undefined
    : Object.hasOwn(REASON_TEXT, s.reason) ? s.reason as OnDeviceReason : 'unknown';
  return {
    platform: 'android', apiExposed: true, availability,
    progress: availability === 'downloading' ? progress : undefined,
    detail: reason ? reasonText(reason, s.code, s.detail) : s.detail ?? (ready && s.model ? `Model on this phone: ${s.model}` : undefined),
    ...(reason ? { reason, ...(s.code == null ? {} : { reasonCode: s.code }) } : {}),
    ...(ready ? { warm } : {}),
  };
}

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
    return toStatus(await nano.module.availability());
  } catch (e) {
    return { platform: 'android', apiExposed: true, availability: 'unknown', detail: message(e) };
  }
}

/**
 * Downloads Gemini Nano through AICore when needed, then loads it. Only after the person chose to (Settings, or the
 * self-check's download step). A failed download comes back as the status with its reason, for example low_storage.
 */
export async function prepareOnDevice(onProgress?: (p: number) => void): Promise<OnDeviceStatus> {
  const nano = loadKalamNano();
  if (!nano.module) return onDeviceStatus();
  const sub = nano.module.addListener('onDownloadProgress', (e) => {
    if (!e.bytesToDownload) return;
    progress = Math.min(1, e.bytesDownloaded / e.bytesToDownload);
    onProgress?.(progress);
  });
  try {
    const s = await nano.module.prepare();
    warm = s.availability === 'available';
    return toStatus(s);
  } catch (e) {
    return { ...(await onDeviceStatus()), detail: message(e) };
  } finally {
    sub.remove();
  }
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
    // kalam-nano takes one prompt string, so the system instructions go first in it.
    generate: (id: string, { prompt, instructions }: NativePrompt) =>
      native.generate(id, { prompt: [instructions, prompt].filter(Boolean).join('\n\n') }),
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
