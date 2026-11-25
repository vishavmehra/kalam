/**
 * Firebase Remote Config on the web (docs/04 §11.6, §15.6; docs/11 §16.1): model names per role,
 * prompt versions and feature flags. src/core/ai/remote-config.ts validates every value with Zod.
 *
 * The first AI request starts the load and never waits for it, so neither startup nor inference
 * blocks on Remote Config. Unsupported browsers, offline starts, a disabled API or any other failure
 * keep the in-code defaults, or the last good values the SDK kept in IndexedDB. One attempt per
 * session; the SDK's own cache covers the next start.
 */
import {
  ensureInitialized, fetchAndActivate, getAll, getRemoteConfig, isSupported, type RemoteConfig,
} from 'firebase/remote-config';
import { applyRemoteConfig, remoteConfigState, type RemoteConfigState } from '@/core/ai/remote-config';
import { getFirebaseApp } from './app';

/** One hour: a changed model name reaches people the same day without a fetch on every start. */
const MIN_FETCH_INTERVAL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5_000;

let loading: Promise<RemoteConfigState> | undefined;

/** Applies the values that came from a Remote Config template ('remote' source), if there is one. */
function applyActive(rc: RemoteConfig): RemoteConfigState {
  const raw: Record<string, string> = {};
  for (const [key, value] of Object.entries(getAll(rc))) {
    if (value.getSource() === 'remote') raw[key] = value.asString();
  }
  const fetchedAt = rc.fetchTimeMillis > 0 ? rc.fetchTimeMillis : undefined;
  return fetchedAt || Object.keys(raw).length ? applyRemoteConfig(raw, fetchedAt) : remoteConfigState();
}

export function loadRemoteConfig(): Promise<RemoteConfigState> {
  loading ??= (async () => {
    try {
      if (!(await isSupported())) return remoteConfigState();
      const app = getFirebaseApp();
      if (!app) return remoteConfigState();
      const rc = getRemoteConfig(app);
      rc.settings = { minimumFetchIntervalMillis: MIN_FETCH_INTERVAL_MS, fetchTimeoutMillis: FETCH_TIMEOUT_MS };
      await ensureInitialized(rc);
      applyActive(rc); // values activated in an earlier session, while the fetch runs
      await fetchAndActivate(rc);
      return applyActive(rc);
    } catch {
      return remoteConfigState(); // defaults, or the last good values, stay in force
    }
  })();
  return loading;
}
