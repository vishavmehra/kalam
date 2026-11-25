/**
 * Remote Config values for the AI layer (docs/04 §11.6, §15.6; docs/07 §5.4; docs/15 §9.9): a model
 * name per role, a prompt version per role and three feature flags. Pure TypeScript: the Firebase SDK
 * lives in src/infrastructure/firebase/remote-config.web.ts, which passes the raw strings here.
 *
 * Every value is checked with Zod. A missing, empty or invalid value keeps the in-code default, so
 * Kalam works the same when Remote Config is off, unreachable or misconfigured. Remote Config is not
 * a secret store or a security boundary: only the keys below are read, and a rejected value is
 * reported by its key alone, never echoed.
 */
import { z } from 'zod';
import type { ModelRole } from '../contracts';

/** Parameter per model role. docs/04 §11.6 names the first six; the other three follow the same pattern. */
export const MODEL_KEYS: Readonly<Record<ModelRole, string>> = {
  compiler: 'model_compile',
  judge: 'model_judge',
  ai_block: 'model_block_fallback',
  voice: 'model_voice_fallback',
  edit: 'model_edit_fallback',
  translation: 'model_translate_fallback',
  repair: 'model_repair',
  safety: 'model_safety',
  local_assistant: 'model_local_assistant',
};

export const PROMPT_VERSION_KEYS: Readonly<Record<ModelRole, string>> = {
  compiler: 'prompt_compile_version',
  ai_block: 'prompt_block_version',
  voice: 'prompt_voice_version',
  edit: 'prompt_edit_version',
  translation: 'prompt_translate_version',
  judge: 'prompt_judge_version',
  repair: 'prompt_repair_version',
  safety: 'prompt_safety_version',
  local_assistant: 'prompt_local_assistant_version',
};

export const FEATURE_KEYS = {
  videoInput: 'feature_video_input',
  aiBlockVerification: 'feature_ai_block_verification',
  bazaar: 'feature_bazaar',
} as const;
export type FeatureFlag = keyof typeof FEATURE_KEYS;

/** Each feature exists in this build, so it stays on unless Remote Config turns it off. */
export const FEATURE_DEFAULTS: Readonly<Record<FeatureFlag, boolean>> = {
  videoInput: true,
  aiBlockVerification: true,
  bazaar: true,
};

/** Firebase AI Logic serves Gemini models by id. Anything else is a typo or does not belong here. */
const modelId = z.string().regex(/^gemini-[a-z0-9][a-z0-9.-]{0,62}$/);
const promptVersion = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,31}$/i);
const flag = z.enum(['true', 'false']).transform((v) => v === 'true');

export interface RemoteAIConfig {
  models: Partial<Record<ModelRole, string>>;
  promptVersions: Partial<Record<ModelRole, string>>;
  features: Partial<Record<FeatureFlag, boolean>>;
}

export interface RemoteConfigState {
  /** `remote` once a Remote Config template was applied (fetched now or kept by the SDK from before). */
  status: 'defaults' | 'remote';
  config: RemoteAIConfig;
  /** Keys whose value failed validation and was ignored. */
  rejected: string[];
  /** When the applied template was fetched (ms since epoch), if known. */
  fetchedAt?: number;
}

const ROLES = Object.keys(MODEL_KEYS) as ModelRole[];
const FLAGS = Object.keys(FEATURE_KEYS) as FeatureFlag[];
const emptyConfig = (): RemoteAIConfig => ({ models: {}, promptVersions: {}, features: {} });

/** Validates the raw Remote Config strings. Unknown keys are ignored; empty values count as unset. */
export function parseRemoteConfig(raw: Readonly<Record<string, string>>): { config: RemoteAIConfig; rejected: string[] } {
  const config = emptyConfig();
  const rejected: string[] = [];
  const read = <T>(key: string, schema: z.ZodType<T>, set: (value: T) => void) => {
    const value = Object.prototype.hasOwnProperty.call(raw, key) ? raw[key]?.trim().toLowerCase() : undefined;
    if (!value) return;
    const r = schema.safeParse(value);
    if (r.success) set(r.data);
    else rejected.push(key);
  };
  for (const role of ROLES) {
    read(MODEL_KEYS[role], modelId, (v) => { config.models[role] = v; });
    read(PROMPT_VERSION_KEYS[role], promptVersion, (v) => { config.promptVersions[role] = v; });
  }
  for (const f of FLAGS) read(FEATURE_KEYS[f], flag, (v) => { config.features[f] = v; });
  return { config, rejected };
}

let state: RemoteConfigState = { status: 'defaults', config: emptyConfig(), rejected: [] };

/**
 * Replaces the active values with a validated template. A key absent from the template returns to its
 * default. A failed fetch must not call this, so the last good values stay in force.
 */
export function applyRemoteConfig(raw: Readonly<Record<string, string>>, fetchedAt?: number): RemoteConfigState {
  const { config, rejected } = parseRemoteConfig(raw);
  state = { status: 'remote', config, rejected, ...(fetchedAt ? { fetchedAt } : {}) };
  return state;
}

export function remoteConfigState(): RemoteConfigState {
  return state;
}

/** Back to the in-code defaults (tests, sign-out). */
export function resetRemoteConfig(): void {
  state = { status: 'defaults', config: emptyConfig(), rejected: [] };
}

export function featureEnabled(f: FeatureFlag): boolean {
  return state.config.features[f] ?? FEATURE_DEFAULTS[f];
}
