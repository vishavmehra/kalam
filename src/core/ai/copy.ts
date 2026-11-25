/**
 * Every user-facing sentence of the AI core (routing and failure messages) in one place, so the i18n
 * migration can move them together. Plain English, no technical detail (docs/13 §21).
 */
import type { AIErrorCode } from '../contracts';
import type { Capability } from './capabilities';

export const AI_COPY = {
  offline: 'This needs an online model. Your saved apps and local data remain available.',
  offlineOnlyMode: 'Offline-only mode is on, so cloud AI is not used.',
  cloudOff: 'Cloud AI is turned off in Settings.',
  firebaseMissing: 'Firebase AI Logic is not configured for this build.',
  taskNeedsCloud: 'This task cannot run on-device.',
  deviceNotReady: (availability: string) => `On-device AI is not ready on this device (${availability}).`,
  deviceLacks: (capability: Capability) => `On-device AI on this device cannot handle ${CAPABILITY_LABELS[capability]}.`,
  rateLimited: 'Kalam has asked for a lot of AI help in a short time. Wait a minute and try again.',
  cancelled: 'The request was cancelled.',
  inputTooLarge: 'This is too much for the AI to read at once. Try a shorter description or fewer photos.',
} as const;

export const CAPABILITY_LABELS: Readonly<Record<Capability, string>> = {
  text: 'text',
  image_input: 'images',
  audio_input: 'audio',
  video_input: 'video',
  structured_output: 'structured answers',
  image_generation: 'making images',
};

/** One safe sentence per failure kind, for any screen that shows an AI failure. */
export const AI_ERROR_MESSAGES: Readonly<Record<AIErrorCode, string>> = {
  offline: 'You are offline. Your work is saved on this device. Try again when you are back online.',
  consent_denied: 'This needs cloud AI, which is turned off in Settings.',
  model_unavailable: 'The AI model needed for this is not available right now.',
  not_configured: 'AI is not set up in this version of Kalam.',
  timeout: 'The AI took too long to answer. Try again.',
  invalid_output: 'The AI gave an answer Kalam could not use. Try again.',
  provider_error: 'The AI service had a problem. Try again in a moment.',
  quota: 'The AI limit has been reached for now. Wait a minute and try again.',
  unsupported_modality: 'The AI here cannot use this kind of input. Type it instead, or try a JPEG or PNG photo.',
  cancelled: 'Stopped.',
  app_check_failed: 'Kalam could not confirm this device with Firebase, so cloud AI is blocked for now. Try again later.',
  bad_request: 'The AI service would not take this request. Try a shorter description, or word it differently.',
};

/** Where the failure happened changes what is true and what helps. Codes not listed use AI_ERROR_MESSAGES. */
export const AI_ERROR_MESSAGES_BY_SOURCE: Readonly<Record<'on_device' | 'cloud', Partial<Record<AIErrorCode, string>>>> = {
  on_device: {
    model_unavailable: 'On-device AI cannot do this right now.',
    unsupported_modality: 'On-device AI here cannot read this kind of input. Type it instead, or turn on cloud AI.',
  },
  cloud: {
    model_unavailable: 'The cloud AI model is not available right now. Try again later.',
  },
};
