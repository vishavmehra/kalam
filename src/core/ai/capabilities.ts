/**
 * Verified provider capability registry (docs/07 §14.6, docs/17 §5.1).
 *
 * One row per provider and capability. A row says what Kalam has actually seen work, with the
 * evidence and the date, instead of assuming that every provider handles every modality.
 * Pure data and pure functions: no SDK, no network, nothing here decides routing by itself.
 * Routing code may use `isVerified` to avoid sending a modality to a provider that was never
 * shown to handle it.
 *
 * Status meanings:
 * - `verified`    Kalam ran a real request and it worked. `checkedOn` is the date of that run.
 * - `unverified`  Probably works (documented or supported by the API) but Kalam has not run it.
 * - `unsupported` Known not to work in this build, so callers must not try it.
 * - `not_assumed` The docs say not to assume it. Treat as unavailable until someone verifies it.
 *
 * To record new evidence, change the row's status, evidence and `checkedOn` together.
 */

export const CAPABILITY_PROVIDERS = ['firebase_cloud', 'nano_web', 'nano_android', 'claude', 'nebius'] as const;
export type CapabilityProviderId = (typeof CAPABILITY_PROVIDERS)[number];

export const CAPABILITIES = [
  'text', 'image_input', 'audio_input', 'video_input', 'structured_output', 'image_generation',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export type CapabilityStatus = 'verified' | 'unverified' | 'unsupported' | 'not_assumed';

export interface CapabilityRecord {
  readonly provider: CapabilityProviderId;
  readonly capability: Capability;
  readonly status: CapabilityStatus;
  /** What was run or read to reach this status. Plain text, never a secret or a config value. */
  readonly evidence: string;
  /** ISO date (YYYY-MM-DD) the status was last established or checked. */
  readonly checkedOn: string;
  /** Model the evidence applies to, when it is model specific. */
  readonly model?: string;
}

const row = (
  provider: CapabilityProviderId, capability: Capability, status: CapabilityStatus,
  checkedOn: string, evidence: string, model?: string,
): CapabilityRecord => Object.freeze({ provider, capability, status, evidence, checkedOn, ...(model ? { model } : {}) });

const CLOUD_MODEL = 'gemini-3.8-flash';
const CLOUD_RUN = 'Real call through Firebase AI Logic, Agent Platform backend, location global, thinking level LOW (scripts/verify-firebase-ai.mjs, scripts/verify-cloud-compile.mjs).';
const NANO_RUN = 'Real Prompt API call in Chrome 157 through the Firebase AI Logic hybrid SDK, Gemini Nano downloaded (first run 2026-11-17, repeated 2026-11-18).';
const NANO_ANDROID = 'The kalam-nano native module (modules/kalam-nano, used by on-device.native.ts) wires Firebase AI Logic\'s Android on-device SDK. Not yet run on a supported phone (emulators have no AICore), and on-device.native.ts still reports `unavailable` wherever the module or AICore is missing.';
const NANO_ANDROID_TEXT_ONLY = 'The Android adapter in on-device.native.ts accepts text only: firebase/ai passes images as ImageBitmap, which React Native lacks.';
const NOT_ASSUMED_NANO = 'docs/07 §14.6 says not to assume this for Gemini Nano. Not tried in Kalam.';
const SPECIALIST_RUN = 'Ran through the Firebase Functions emulator with the server-side key. Specialists are off by default (EXPO_PUBLIC_SPECIALIST_ENABLED=false) and need user consent.';

const REGISTRY: readonly CapabilityRecord[] = Object.freeze([
  // Firebase AI Logic cloud (Gemini)
  row('firebase_cloud', 'text', 'verified', '2026-11-18', CLOUD_RUN, CLOUD_MODEL),
  row('firebase_cloud', 'image_input', 'unverified', '2026-11-17',
    'The Firebase AI Logic model table lists gemini-3.8-flash as image capable (checked 2026-11-17). Kalam sends image parts as inlineData, but no real image request has been recorded yet.', CLOUD_MODEL),
  row('firebase_cloud', 'audio_input', 'unverified', '2026-11-18',
    'Not exercised in Kalam yet. Verify the selected model before sending audio parts.'),
  row('firebase_cloud', 'video_input', 'unverified', '2026-11-18',
    'Not exercised in Kalam yet. Verify the selected model before sending video parts.'),
  row('firebase_cloud', 'structured_output', 'verified', '2026-11-18',
    `${CLOUD_RUN} Output is requested with responseJsonSchema and always checked with Zod.`, CLOUD_MODEL),
  row('firebase_cloud', 'image_generation', 'unverified', '2026-11-18',
    'Needs an image model and Blaze billing. No model has been selected or tried.'),

  // Gemini Nano in Chrome (Prompt API via the Firebase hybrid SDK)
  row('nano_web', 'text', 'verified', '2026-11-18', NANO_RUN, 'gemini-nano'),
  row('nano_web', 'image_input', 'unverified', '2026-11-18',
    'The Prompt API accepts image input, and the provider declares an image expected input when images are sent. Not yet verified in Kalam.', 'gemini-nano'),
  row('nano_web', 'audio_input', 'not_assumed', '2026-11-18', NOT_ASSUMED_NANO),
  row('nano_web', 'video_input', 'not_assumed', '2026-11-18', NOT_ASSUMED_NANO),
  row('nano_web', 'structured_output', 'verified', '2026-11-18',
    `${NANO_RUN} JSON Schema is passed as responseConstraint and the result is checked with Zod.`, 'gemini-nano'),
  row('nano_web', 'image_generation', 'not_assumed', '2026-11-18', NOT_ASSUMED_NANO),

  // Gemini Nano on Android
  row('nano_android', 'text', 'unverified', '2026-11-18', NANO_ANDROID, 'gemini-nano'),
  row('nano_android', 'image_input', 'unsupported', '2026-11-18', NANO_ANDROID_TEXT_ONLY),
  row('nano_android', 'audio_input', 'not_assumed', '2026-11-18', NOT_ASSUMED_NANO),
  row('nano_android', 'video_input', 'not_assumed', '2026-11-18', NOT_ASSUMED_NANO),
  row('nano_android', 'structured_output', 'unverified', '2026-11-18',
    `${NANO_ANDROID} On-device constrained decoding needs compile-time schemas, so the adapter puts the JSON Schema in the prompt and Zod checks the answer.`, 'gemini-nano'),
  row('nano_android', 'image_generation', 'not_assumed', '2026-11-18', NOT_ASSUMED_NANO),

  // Claude (server side specialist)
  row('claude', 'text', 'verified', '2026-11-18', SPECIALIST_RUN),
  row('claude', 'image_input', 'not_assumed', '2026-11-18',
    'The Claude API accepts images, but Kalam\'s specialist function does not forward images to Claude (functions/src/providers.ts). Sketch interpretation goes to the Nebius vision model.'),
  row('claude', 'audio_input', 'not_assumed', '2026-11-18', 'Not wired and not tried in Kalam.'),
  row('claude', 'video_input', 'not_assumed', '2026-11-18', 'Not wired and not tried in Kalam.'),
  row('claude', 'structured_output', 'verified', '2026-11-18', `${SPECIALIST_RUN} The plan task returns JSON that the server and the client both validate.`),
  row('claude', 'image_generation', 'unsupported', '2026-11-18', 'Claude does not generate images. docs/07 §14.6 marks this not assumed.'),

  // Nebius Token Factory (server side specialist)
  row('nebius', 'text', 'verified', '2026-11-18', SPECIALIST_RUN),
  row('nebius', 'image_input', 'unverified', '2026-11-18',
    'The specialist function forwards images to the Nebius vision model as image_url parts. The emulator run was text only, so image input is not verified.'),
  row('nebius', 'audio_input', 'unverified', '2026-11-18', 'Not wired and not tried in Kalam. Verify the selected model first.'),
  row('nebius', 'video_input', 'unverified', '2026-11-18', 'Not wired and not tried in Kalam. Verify the selected model first.'),
  row('nebius', 'structured_output', 'verified', '2026-11-18', `${SPECIALIST_RUN} Output is validated server-side before it reaches the app.`),
  row('nebius', 'image_generation', 'unverified', '2026-11-18', 'No image model selected or tried. Verify the model and its billing first.'),
]);

export interface CapabilityFilter {
  provider?: CapabilityProviderId;
  capability?: Capability;
  status?: CapabilityStatus;
}

/** All rows, optionally filtered. Returns a new array of frozen records. */
export function listCapabilities(filter: CapabilityFilter = {}): CapabilityRecord[] {
  return REGISTRY.filter((r) =>
    (filter.provider === undefined || r.provider === filter.provider)
    && (filter.capability === undefined || r.capability === filter.capability)
    && (filter.status === undefined || r.status === filter.status));
}

/** The record for one provider and capability. The matrix is complete, so this always finds a row. */
export function getCapability(provider: CapabilityProviderId, capability: Capability): CapabilityRecord {
  const found = REGISTRY.find((r) => r.provider === provider && r.capability === capability);
  if (!found) throw new Error(`No capability record for ${provider} / ${capability}`);
  return found;
}

/** True only when Kalam has run a real request for this provider and capability. */
export function isVerified(provider: CapabilityProviderId, capability: Capability): boolean {
  return getCapability(provider, capability).status === 'verified';
}

/**
 * True when routing may send this capability to this provider: verified, or unverified (documented
 * but not yet run in Kalam). `unsupported` and `not_assumed` rows are never routed (docs/07 §14.6).
 */
export function isUsable(provider: CapabilityProviderId, capability: Capability): boolean {
  const { status } = getCapability(provider, capability);
  return status === 'verified' || status === 'unverified';
}
