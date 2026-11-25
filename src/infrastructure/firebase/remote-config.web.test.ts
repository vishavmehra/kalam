/**
 * Remote Config web loader (docs/13 §10.3: fetch failure, cached configuration, safe fallback). The
 * `firebase/remote-config` SDK is mocked, so these prove Kalam's wiring and fallbacks, not a real fetch.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Source = 'remote' | 'default' | 'static';
const h = vi.hoisted(() => ({
  supported: true as boolean | 'throws',
  app: {} as object | undefined,
  /** Values the SDK has activated (from IndexedDB before the fetch, then from the fetch). */
  active: {} as Record<string, { value: string; source: 'remote' | 'default' | 'static' }>,
  fetched: {} as Record<string, { value: string; source: 'remote' | 'default' | 'static' }>,
  fetchFails: false,
  fetchTimeMillis: -1,
  lastFetchTime: 0,
  calls: [] as string[],
  rc: { settings: undefined as unknown, fetchTimeMillis: -1 },
}));

vi.mock('firebase/remote-config', () => ({
  isSupported: async () => {
    h.calls.push('isSupported');
    if (h.supported === 'throws') throw new Error('indexedDB blocked');
    return h.supported;
  },
  getRemoteConfig: () => {
    h.calls.push('getRemoteConfig');
    h.rc.fetchTimeMillis = h.fetchTimeMillis;
    return h.rc;
  },
  ensureInitialized: async () => { h.calls.push('ensureInitialized'); },
  fetchAndActivate: async () => {
    h.calls.push('fetchAndActivate');
    if (h.fetchFails) throw new Error('Failed to fetch');
    h.active = h.fetched;
    h.rc.fetchTimeMillis = h.lastFetchTime;
    return true;
  },
  getAll: () => Object.fromEntries(Object.entries(h.active).map(([k, v]) => [k, { asString: () => v.value, getSource: () => v.source }])),
}));
vi.mock('./app', () => ({ getFirebaseApp: () => h.app }));

const v = (value: string, source: Source = 'remote') => ({ value, source });

async function load() {
  vi.resetModules();
  const core = await import('@/core/ai/remote-config');
  const models = await import('@/core/ai/model-config');
  const { loadRemoteConfig } = await import('./remote-config.web');
  return { core, models, loadRemoteConfig };
}

beforeEach(() => {
  h.supported = true;
  h.app = {};
  h.active = {};
  h.fetched = {};
  h.fetchFails = false;
  h.fetchTimeMillis = -1;
  h.lastFetchTime = 1_700_000_000_000;
  h.calls = [];
  h.rc = { settings: undefined, fetchTimeMillis: -1 };
});

describe('loadRemoteConfig (web)', () => {
  it('applies fetched values: valid ones win, invalid ones are rejected by key, SDK defaults are ignored', async () => {
    h.fetched = {
      model_compile: v('gemini-3.9-pro'), model_judge: v('not-a-model'), feature_bazaar: v('false'),
      model_edit_fallback: v('gemini-static', 'static'), prompt_block_version: v('block-v1', 'default'),
    };
    const { core, models, loadRemoteConfig } = await load();
    const state = await loadRemoteConfig();
    expect(state).toMatchObject({ status: 'remote', rejected: ['model_judge'], fetchedAt: h.lastFetchTime });
    expect(models.modelForRole('compiler', {})).toBe('gemini-3.9-pro');
    expect(models.modelForRole('judge', {})).toBe(models.DEFAULT_MODELS.judge);
    expect(models.modelForRole('edit', {})).toBe(models.DEFAULT_MODELS.edit);
    expect(core.featureEnabled('bazaar')).toBe(false);
  });

  it('sets a short fetch timeout and an hourly minimum fetch interval', async () => {
    const { loadRemoteConfig } = await load();
    await loadRemoteConfig();
    expect(h.rc.settings).toEqual({ minimumFetchIntervalMillis: 3_600_000, fetchTimeoutMillis: 5_000 });
    expect(h.calls).toEqual(['isSupported', 'getRemoteConfig', 'ensureInitialized', 'fetchAndActivate']);
  });

  it('keeps the values the SDK cached from an earlier session when the fetch fails', async () => {
    h.active = { model_compile: v('gemini-cached') };
    h.fetchTimeMillis = 1_600_000_000_000;
    h.fetchFails = true;
    const { models, loadRemoteConfig } = await load();
    const state = await loadRemoteConfig();
    expect(state).toMatchObject({ status: 'remote', fetchedAt: 1_600_000_000_000 });
    expect(models.modelForRole('compiler', {})).toBe('gemini-cached');
  });

  it('stays on the defaults when the fetch fails and nothing was cached', async () => {
    h.fetchFails = true;
    const { models, loadRemoteConfig } = await load();
    expect(await loadRemoteConfig()).toMatchObject({ status: 'defaults' });
    expect(models.modelForRole('compiler', {})).toBe(models.DEFAULT_MODELS.compiler);
  });

  it.each([
    ['an unsupported browser', () => { h.supported = false; }],
    ['a browser that blocks storage', () => { h.supported = 'throws'; }],
    ['a build without Firebase', () => { h.app = undefined; }],
  ])('uses the defaults and never fetches in %s', async (_name, arrange) => {
    arrange();
    const { loadRemoteConfig } = await load();
    expect(await loadRemoteConfig()).toMatchObject({ status: 'defaults' });
    expect(h.calls).not.toContain('fetchAndActivate');
  });

  it('fetches once per session however many requests start it', async () => {
    h.fetched = { model_compile: v('gemini-3.9-pro') };
    const { loadRemoteConfig } = await load();
    await Promise.all([loadRemoteConfig(), loadRemoteConfig()]);
    await loadRemoteConfig();
    expect(h.calls.filter((c) => c === 'fetchAndActivate')).toHaveLength(1);
  });
});

describe('loadRemoteConfig on Android and in Node', () => {
  it('keeps the defaults without touching the SDK', async () => {
    vi.resetModules();
    const { loadRemoteConfig } = await import('./remote-config');
    expect(await loadRemoteConfig()).toMatchObject({ status: 'defaults' });
    expect(h.calls).toEqual([]);
  });
});
