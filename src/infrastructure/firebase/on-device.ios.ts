/**
 * iOS on-device AI (docs/17 §3.2: "iOS, integrating Apple Foundation Models through Firebase AI Logic").
 * Apple's on-device model (FoundationModels SystemLanguageModel) runs in the kalam-apple native module;
 * Firebase AI Logic's JS SDK chooses device or cloud, exactly as on the web and Android: the adapter from
 * prompt-api.native.ts goes in as globalThis.LanguageModel, firebase/ai's hybrid router calls it, and
 * response.inferenceSource says which one ran. firebase-provider.ts has no iOS branch, and the cloud leg
 * (with App Check) is the same JS SDK every platform uses, so the orchestrator keeps its one cloud fallback.
 *
 * Sources, read 2026-11-25:
 * - https://firebase.google.com/docs/ai-logic/hybrid/ios/get-started and .../hybrid/ios/configuration-options:
 *   on-device runs only with Apple Intelligence on, text input only, about 4096 tokens, foreground only;
 *   the app cannot start the model download, only check availability and ask the person to turn on
 *   Apple Intelligence.
 * - firebase-ios-sdk FirebaseAI/CHANGELOG.md 13.0.0: the interim SystemLanguageModel/HybridModel wrapper of
 *   12.13 was removed; Firebase now says to use Apple's Foundation Models framework directly, which is what
 *   the Swift module does.
 * - https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel: iOS 26.0+, availability
 *   .unavailable(.deviceNotEligible | .appleIntelligenceNotEnabled | .modelNotReady), supportedLanguages.
 *   modelNotReady: "The models aren't available on the user's device. Models are downloaded automatically
 *   based on factors like network status, battery level, and system load." It does not say a download is
 *   running, so Kalam reports it as unavailable with that reason, never as downloading.
 * Structured output: the JSON Schema goes in the prompt and the caller's Zod parse decides, as on Android.
 */
import type { OnDeviceStatus } from '@/core/contracts';
import { loadKalamApple, type AppleUnavailableReason, type KalamAppleModule } from '../../../modules/kalam-apple';
import type { LanguageModelStatic } from './on-device.web';
import {
  createPromptLanguageModel, errorMessage as message, promptError, type NativePrompt, type PromptLanguageModel,
} from './prompt-api.native';

export { TEXT_IO, type LanguageModelStatic } from './on-device.web';

/** The name Firebase AI Logic gives this model (rawResponse.modelVersion, hybrid configuration options page). */
export const ON_DEVICE_MODEL_NAME = 'apple-foundation-models-system-language-model';

const PLATFORM: OnDeviceStatus['platform'] = 'ios';

/**
 * Firebase: on-device requests above "4096 tokens (or approximately 3000 English words)" fail. Apple TN3193:
 * the 4096-token window holds the instructions, the prompt and the answer. At about 3.5 characters a token
 * in English this leaves room for an answer.
 * ponytail: a character count, not Apple's tokenizer. Japanese runs about one character a token, so a long
 * Japanese request still reaches the device and fails there; use tokenCount(for:) once the Swift runs.
 */
const MAX_PROMPT_CHARS = 9_000;

export const UNAVAILABLE_DETAIL: Record<AppleUnavailableReason, string> = {
  deviceNotEligible: 'This iPhone or iPad cannot run Apple Intelligence, so Kalam uses the cloud when you allow it.',
  appleIntelligenceNotEnabled: 'Apple Intelligence is off. Turn it on in Settings, Apple Intelligence and Siri, to run AI on this device.',
  modelNotReady: 'Apple Intelligence is not ready on this device yet. iOS gets its model by itself, depending on network, battery and how busy the device is.',
  osTooOld: 'AI on this device needs iOS 26 or later with Apple Intelligence on.',
  simulatorNoModel: 'This simulator has no working Apple Intelligence. A simulator uses the one on its Mac, and this Mac has it turned off or cannot run it (for example a cloud build machine).',
  unknown: 'Apple Intelligence is not available right now.',
};

const unavailableDetail = (reason?: string | null) =>
  reason && Object.hasOwn(UNAVAILABLE_DETAIL, reason) ? UNAVAILABLE_DETAIL[reason as AppleUnavailableReason] : UNAVAILABLE_DETAIL.unknown;

/** Swift error codes (KalamAppleModule.swift) to Prompt API error names, which errors.ts maps to Kalam codes. */
const PROMPT_ERROR_BY_CODE: Record<string, string> = {
  ERR_APPLE_NOT_SUPPORTED: 'NotSupportedError',
  ERR_APPLE_NOT_ALLOWED: 'NotAllowedError',
  ERR_APPLE_TOO_LARGE: 'QuotaExceededError',
};

let adapter: PromptLanguageModel | undefined;

/** Kalam's adapter, or undefined without the native module. Never another global LanguageModel. */
export function getLanguageModel(): LanguageModelStatic | undefined {
  if (!adapter) {
    const apple = loadKalamApple();
    if (!apple.module) return undefined;
    adapter = createPromptLanguageModel(appleEngine(apple.module), 'apple');
    (globalThis as { LanguageModel?: LanguageModelStatic }).LanguageModel = adapter;
  }
  return adapter;
}

// firebase/ai reads globalThis.LanguageModel whenever a GenerativeModel is made, so it goes in at load.
getLanguageModel();

/**
 * 'available' only when SystemLanguageModel itself says so (on a simulator, after one real answer: see
 * KalamAppleModule.swift). Anything else, including a value this build does not know or a failed check, is
 * 'unavailable' with a reason, so Kalam never claims on-device AI it cannot run.
 */
export async function onDeviceStatus(): Promise<OnDeviceStatus> {
  const apple = loadKalamApple();
  if (!apple.module) return { platform: PLATFORM, apiExposed: false, availability: 'unavailable', detail: apple.reason };
  try {
    const s = await apple.module.availability();
    if (s.availability === 'available') return { platform: PLATFORM, apiExposed: true, availability: 'available', detail: undefined };
    return { platform: PLATFORM, apiExposed: true, availability: 'unavailable', detail: unavailableDetail(s.reason) };
  } catch (e) {
    return { platform: PLATFORM, apiExposed: true, availability: 'unavailable', detail: `${UNAVAILABLE_DETAIL.unknown} ${message(e)}` };
  }
}

/**
 * iOS downloads Apple's model by itself once Apple Intelligence is on; an app cannot start or follow that
 * download. So this only reports the current state.
 */
export async function prepareOnDevice(_onProgress?: (p: number) => void): Promise<OnDeviceStatus> {
  return onDeviceStatus();
}

/** iOS loads the model when a request needs it and does not say whether it is in memory, so no `warm`. */
export function warmUpOnDevice(): Promise<OnDeviceStatus> {
  return onDeviceStatus();
}

function appleEngine(native: KalamAppleModule) {
  return {
    async ready(languages: string[]) {
      const s = await native.availability();
      const supported = new Set(s.languages ?? []);
      return s.availability === 'available' && languages.every((l) => supported.has(l));
    },
    maxPromptChars: MAX_PROMPT_CHARS,
    // Instructions stay a separate field: Swift passes them to LanguageModelSession(model:instructions:).
    generate: (id: string, options: NativePrompt) => native.generate(id, options),
    cancel: (id: string) => native.cancel(id),
    toPromptError: (e: unknown) => promptError(PROMPT_ERROR_BY_CODE[(e as { code?: string })?.code ?? ''] ?? 'UnknownError', message(e)),
  };
}
