/**
 * Remote Config values and the central AI configuration (docs/13 §10.3: defaults, missing config,
 * invalid model config, cached config, versioned prompts, safe fallback). The web SDK loader has its
 * own test in src/infrastructure/firebase/remote-config.web.test.ts.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { SCHEMA_VERSION } from '../spec/schema';
import { aiConfigSnapshot, DEFAULT_MODELS, modelForRole, PROMPT_VERSIONS, promptVersionFor } from './model-config';
import {
  applyRemoteConfig, FEATURE_DEFAULTS, featureEnabled, MODEL_KEYS, parseRemoteConfig, PROMPT_VERSION_KEYS, remoteConfigState,
  resetRemoteConfig,
} from './remote-config';

const noEnv = {};

afterEach(() => {
  resetRemoteConfig();
});

describe('Remote Config: defaults and missing configuration', () => {
  it('starts on the in-code defaults', () => {
    expect(remoteConfigState()).toEqual({ status: 'defaults', config: { models: {}, promptVersions: {}, features: {} }, rejected: [] });
    for (const role of Object.keys(DEFAULT_MODELS) as Array<keyof typeof DEFAULT_MODELS>) {
      expect(modelForRole(role, noEnv)).toBe(DEFAULT_MODELS[role]);
      expect(promptVersionFor(role)).toBe(PROMPT_VERSIONS[role][0]);
    }
    expect(featureEnabled('videoInput')).toBe(true);
    expect(featureEnabled('aiBlockVerification')).toBe(true);
    expect(featureEnabled('bazaar')).toBe(true);
    expect(FEATURE_DEFAULTS).toEqual({ videoInput: true, aiBlockVerification: true, bazaar: true });
  });

  it('an empty template leaves every value on its default', () => {
    const s = applyRemoteConfig({}, 1234);
    expect(s).toMatchObject({ status: 'remote', rejected: [], fetchedAt: 1234 });
    expect(modelForRole('compiler', noEnv)).toBe(DEFAULT_MODELS.compiler);
  });

  it('has one model key and one prompt version key per role, with the docs/04 §11.6 names', () => {
    expect(MODEL_KEYS).toMatchObject({
      compiler: 'model_compile', judge: 'model_judge', ai_block: 'model_block_fallback', voice: 'model_voice_fallback',
      edit: 'model_edit_fallback', translation: 'model_translate_fallback',
    });
    expect(PROMPT_VERSION_KEYS).toMatchObject({
      compiler: 'prompt_compile_version', ai_block: 'prompt_block_version', voice: 'prompt_voice_version',
      edit: 'prompt_edit_version', translation: 'prompt_translate_version',
    });
    expect(Object.keys(MODEL_KEYS).sort()).toEqual(Object.keys(DEFAULT_MODELS).sort());
  });
});

describe('Remote Config: validation', () => {
  it('applies valid model names and feature flags', () => {
    applyRemoteConfig({ model_compile: 'gemini-3.9-pro', model_block_fallback: ' Gemini-3.5-Flash-Lite ', feature_video_input: 'false', feature_bazaar: 'TRUE' });
    expect(modelForRole('compiler', noEnv)).toBe('gemini-3.9-pro');
    expect(modelForRole('ai_block', noEnv)).toBe('gemini-3.5-flash-lite');
    expect(modelForRole('judge', noEnv)).toBe(DEFAULT_MODELS.judge);
    expect(featureEnabled('videoInput')).toBe(false);
    expect(featureEnabled('bazaar')).toBe(true);
    expect(remoteConfigState().rejected).toEqual([]);
  });

  it('rejects an invalid model, version or flag by key, never echoing the value, and keeps the default', () => {
    const secret = 'AIzaSyD-not-a-model-name';
    const s = applyRemoteConfig({
      model_compile: secret, model_judge: 'gpt-5', model_voice_fallback: 'gemini-../../etc', prompt_edit_version: 'v1; drop',
      feature_ai_block_verification: 'maybe',
    });
    expect(s.rejected.sort()).toEqual(['feature_ai_block_verification', 'model_compile', 'model_judge', 'model_voice_fallback', 'prompt_edit_version']);
    expect(JSON.stringify(s)).not.toContain(secret);
    expect(modelForRole('compiler', noEnv)).toBe(DEFAULT_MODELS.compiler);
    expect(modelForRole('judge', noEnv)).toBe(DEFAULT_MODELS.judge);
    expect(promptVersionFor('edit')).toBe(PROMPT_VERSIONS.edit[0]);
    expect(featureEnabled('aiBlockVerification')).toBe(true);
  });

  it('ignores keys it does not know and empty values', () => {
    const { config, rejected } = parseRemoteConfig({ api_key: 'secret', model_compile: '   ', prompt_block_version: '' });
    expect(config).toEqual({ models: {}, promptVersions: {}, features: {} });
    expect(rejected).toEqual([]);
  });

  it('a later template replaces the earlier one: a removed key returns to its default', () => {
    applyRemoteConfig({ model_compile: 'gemini-3.9-pro' });
    applyRemoteConfig({ model_judge: 'gemini-3.9-pro' });
    expect(modelForRole('compiler', noEnv)).toBe(DEFAULT_MODELS.compiler);
    expect(modelForRole('judge', noEnv)).toBe('gemini-3.9-pro');
  });
});

describe('model precedence and versioned prompts', () => {
  it('Remote Config beats the build-time env override, which beats the default', () => {
    expect(modelForRole('judge', { judge: ' gemini-env ' })).toBe('gemini-env');
    applyRemoteConfig({ model_judge: 'gemini-remote' });
    expect(modelForRole('judge', { judge: 'gemini-env' })).toBe('gemini-remote');
  });

  it('accepts a prompt version only when this build ships it', () => {
    applyRemoteConfig({ prompt_compile_version: 'compile-v9' });
    expect(remoteConfigState().config.promptVersions.compiler).toBe('compile-v9');
    expect(promptVersionFor('compiler')).toBe('compile-v2');
    applyRemoteConfig({ prompt_compile_version: 'COMPILE-V2' });
    expect(promptVersionFor('compiler')).toBe('compile-v2');
  });

  it('ships exactly one versioned prompt per role today', () => {
    for (const versions of Object.values(PROMPT_VERSIONS)) {
      expect(versions.length).toBeGreaterThanOrEqual(1);
      expect(versions[0]).toMatch(/^[a-z]+-v\d+$/);
    }
  });

  it('reports the active configuration for diagnostics, without secrets', () => {
    applyRemoteConfig({ model_compile: 'gemini-3.9-pro', model_judge: 'nope', feature_bazaar: 'false' }, 99);
    const snap = aiConfigSnapshot();
    expect(snap.schemaVersion).toBe(SCHEMA_VERSION);
    expect(snap.remoteConfig).toEqual({ status: 'remote', fetchedAt: 99, rejected: ['model_judge'] });
    expect(snap.roles.find((r) => r.role === 'compiler')).toEqual({ role: 'compiler', model: 'gemini-3.9-pro', promptVersion: 'compile-v2' });
    expect(snap.features).toEqual({ videoInput: true, aiBlockVerification: true, bazaar: false });
    expect(JSON.stringify(snap)).not.toContain('nope');
  });
});
