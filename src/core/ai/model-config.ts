import type { ModelRole } from '../contracts';
import { SCHEMA_VERSION } from '../spec/schema';
import { FEATURE_KEYS, featureEnabled, remoteConfigState, type FeatureFlag } from './remote-config';

/**
 * Logical model roles (docs/07 §5.5) → Firebase AI Logic cloud model ids. This is the ONLY place
 * model ids live (docs/07 §5.4, §16.2). On-device-first roles run on Chrome's built-in Gemini Nano
 * (no id to choose); the id below is their cloud leg when the hybrid SDK falls back.
 *
 * Evidence, checked 2026-11-17:
 * - firebase.google.com/docs/ai-logic/models (Gemini Developer API): `gemini-3.8-flash` and
 *   `gemini-3.5-flash-lite` are "billing not required", accept image input and support JSON output.
 *   `gemini-2.5-*` are routed to 3.x from 2026-12-01; `gemini-2.0-*` were shut down 2026-06-01.
 * - firebase@13.4 `@firebase/ai` hard-codes `DEFAULT_HYBRID_IN_CLOUD_MODEL = 'gemini-3.5-flash-lite'`.
 * Precedence: Remote Config (`model_*`, see remote-config.ts) → `EXPO_PUBLIC_AI_MODEL_<ROLE>` → these defaults.
 */
export const DEFAULT_MODELS: Readonly<Record<ModelRole, string>> = {
  compiler: 'gemini-3.8-flash',
  repair: 'gemini-3.8-flash',
  judge: 'gemini-3.8-flash',
  safety: 'gemini-3.5-flash-lite',
  local_assistant: 'gemini-3.5-flash-lite',
  edit: 'gemini-3.5-flash-lite',
  voice: 'gemini-3.5-flash-lite',
  ai_block: 'gemini-3.5-flash-lite',
  translation: 'gemini-3.5-flash-lite',
};

/** Reported as `model` when Chrome's built-in model served the request. */
export const ON_DEVICE_MODEL = 'gemini-nano';

// Expo inlines EXPO_PUBLIC_* at build time only when each variable is referenced literally.
const ENV_OVERRIDES: Readonly<Record<ModelRole, string | undefined>> = {
  compiler: process.env.EXPO_PUBLIC_AI_MODEL_COMPILER,
  repair: process.env.EXPO_PUBLIC_AI_MODEL_REPAIR,
  judge: process.env.EXPO_PUBLIC_AI_MODEL_JUDGE,
  safety: process.env.EXPO_PUBLIC_AI_MODEL_SAFETY,
  local_assistant: process.env.EXPO_PUBLIC_AI_MODEL_LOCAL_ASSISTANT,
  edit: process.env.EXPO_PUBLIC_AI_MODEL_EDIT,
  voice: process.env.EXPO_PUBLIC_AI_MODEL_VOICE,
  ai_block: process.env.EXPO_PUBLIC_AI_MODEL_AI_BLOCK,
  translation: process.env.EXPO_PUBLIC_AI_MODEL_TRANSLATION,
};

export function modelForRole(
  role: ModelRole,
  overrides: Partial<Record<ModelRole, string | undefined>> = ENV_OVERRIDES,
): string {
  return remoteConfigState().config.models[role] ?? (overrides[role]?.trim() || DEFAULT_MODELS[role]);
}

/**
 * Output token ceiling per role (docs/07 §16.2 output token limits). A request without its own
 * maxOutputTokens gets this one, and a larger request is cut down to it, so no call reaches the cloud
 * uncapped. The values sit above what each caller asks for today (compile 8192, judge test writer
 * 4096, edit 4096, translation up to 8192), leaving room for Gemini 3 thinking tokens.
 */
export const MAX_OUTPUT_TOKENS: Readonly<Record<ModelRole, number>> = {
  compiler: 16_384,
  repair: 16_384,
  judge: 4_096,
  safety: 1_024,
  local_assistant: 1_024,
  edit: 4_096,
  voice: 1_024,
  ai_block: 2_048,
  translation: 8_192,
};

export function outputTokensFor(role: ModelRole, requested?: number): number {
  const cap = MAX_OUTPUT_TOKENS[role];
  return requested === undefined || !Number.isFinite(requested) ? cap : Math.min(Math.max(1, Math.floor(requested)), cap);
}

/**
 * Prompt template version labels, per role, default first (docs/04 §8.5 and §11.6, docs/13 §24).
 * Every inference event records the label in use. Bump a role's label in the same change that edits
 * any prompt text sent with that role, so events and evaluation results trace back to the prompt
 * that produced them.
 * ponytail: labels only. Each role ships one prompt text, so a Remote Config `prompt_*` value can only
 * pick a label this build ships and cannot switch the text, and nothing checks that a prompt edit came
 * with a bump. Ship a second text per role (and a fingerprint test) when prompts are A/B tested.
 */
export const PROMPT_VERSIONS: Readonly<Record<ModelRole, readonly [string, ...string[]]>> = {
  compiler: ['compile-v2'],
  repair: ['repair-v2'],
  judge: ['judge-v1'],
  safety: ['safety-v1'],
  local_assistant: ['assistant-v1'],
  edit: ['edit-v1'],
  voice: ['voice-v1'],
  ai_block: ['block-v1'],
  translation: ['translate-v1'],
};

export function promptVersionFor(role: ModelRole): string {
  const shipped = PROMPT_VERSIONS[role];
  const wanted = remoteConfigState().config.promptVersions[role];
  return wanted && shipped.includes(wanted) ? wanted : shipped[0];
}

/** What the AI layer is running with, for a diagnostics view (docs/04 §20.1). No secrets, no content. */
export function aiConfigSnapshot() {
  const rc = remoteConfigState();
  const roles = Object.keys(DEFAULT_MODELS) as ModelRole[];
  return {
    schemaVersion: SCHEMA_VERSION,
    remoteConfig: { status: rc.status, fetchedAt: rc.fetchedAt, rejected: rc.rejected },
    roles: roles.map((role) => ({ role, model: modelForRole(role), promptVersion: promptVersionFor(role) })),
    features: Object.fromEntries((Object.keys(FEATURE_KEYS) as FeatureFlag[]).map((f) => [f, featureEnabled(f)])) as Record<FeatureFlag, boolean>,
  };
}
