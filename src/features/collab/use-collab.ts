import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import type { LocalSpace, LocalTeam, SyncStatus } from '@/core/collab';
import { getCollabService, startCollabSync } from '@/infrastructure/collab/service';

/** Starts background sync for shared apps. Mount once at the app root. */
export function useCollabSync(): void {
  useEffect(() => startCollabSync(), []);
}

/** Live sync state of one app (`shared: false` for an app that is only on this device). */
export function useSyncStatus(appId: string): SyncStatus {
  const engine = getCollabService();
  useEffect(() => {
    void engine.refresh(appId);
  }, [engine, appId]);
  const subscribe = useCallback((l: () => void) => engine.subscribe(l), [engine]);
  const snapshot = useCallback(() => engine.status(appId), [engine, appId]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** This device's sharing state for one app, re-read whenever sync reports a change. `null` while loading. */
export function useSpace(appId: string): LocalSpace | undefined | null {
  // Keyed by app id, so switching apps shows "loading" instead of the previous app's state.
  const [state, setState] = useState<{ appId: string; space: LocalSpace | undefined } | undefined>();
  useEffect(() => {
    const engine = getCollabService();
    let alive = true;
    const load = () => void engine.space(appId).then((space) => alive && setState({ appId, space }), () => alive && setState({ appId, space: undefined }));
    load();
    const off = engine.subscribe(load);
    return () => {
      alive = false;
      off();
    };
  }, [appId]);
  return state?.appId === appId ? state.space : null;
}

export function useTeams(active: boolean): LocalTeam[] {
  const [teams, setTeams] = useState<LocalTeam[]>([]);
  useEffect(() => {
    if (!active) return;
    const engine = getCollabService();
    let alive = true;
    const load = () => void engine.teams().then((t) => alive && setTeams(t), () => undefined);
    load();
    const off = engine.subscribe(load);
    return () => {
      alive = false;
      off();
    };
  }, [active]);
  return teams;
}
