import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { getDatabase } from '@/infrastructure/storage/database';
import { createWidgetsController, type WidgetsController, type WidgetsState } from './controller';
import { getWidgetService, getWidgetStore } from './service';

/** How long to wait after the last change before the home screen is told, so typing does not redraw it on every key. */
export const SYNC_DELAY_MS = 1500;

/**
 * Mount once, high in the tree (the root layout). Keeps the home screen current: when Kalam opens or comes to the front,
 * when it goes to the background, and (after a short pause) when an app that has a live widget changes. Does nothing
 * for a person with no widgets and no install shortcuts switched on beyond one cheap read.
 */
export function useWidgetSync(): void {
  useEffect(() => {
    const service = getWidgetService();
    const widgets = getWidgetStore();
    const db = getDatabase();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let watching: Array<() => void> = [];
    let alive = true;

    const run = (reason: 'open' | 'change', delay: number) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void service.sync(reason), delay);
    };
    // Entries and counters of an app with a live widget. Widgets that follow Kalam opening need no watching.
    const watch = async () => {
      for (const off of watching) off();
      watching = [];
      const live = new Set((await widgets.list().catch(() => [])).filter((w) => w.refresh === 'live').map((w) => w.appId));
      if (!alive) return;
      for (const appId of live) {
        watching.push(db.records.subscribe(appId, () => run('change', SYNC_DELAY_MS)), db.state.subscribe(appId, () => run('change', SYNC_DELAY_MS)));
      }
    };

    run('open', 0);
    void watch();
    const offStore = widgets.subscribe(() => void watch());
    const app = AppState.addEventListener('change', (s) => {
      if (s === 'active') run('open', 0);
      else if (s === 'background') run('change', 0);
    });
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      for (const off of watching) off();
      offStore();
      app.remove();
    };
  }, []);
}

const IDLE: WidgetsState = { phase: 'loading', views: [], candidates: [], availability: undefined, prefs: undefined };

/** The widget state for one app (or for the whole device without `appId`). Loads while `active` and stops when it closes. */
export function useWidgetsController(appId: string | undefined, active: boolean): { state: WidgetsState; controller: WidgetsController | undefined } {
  const controller = useMemo(() => {
    if (!active) return undefined;
    return createWidgetsController({ service: getWidgetService(), appId, onChanged: (l) => getWidgetStore().subscribe(l) });
  }, [appId, active]);
  useEffect(() => {
    controller?.start();
    return () => controller?.stop();
  }, [controller]);
  const subscribe = useCallback((l: () => void) => (controller ? controller.subscribe(l) : () => undefined), [controller]);
  const snapshot = useCallback(() => (controller ? controller.getState() : IDLE), [controller]);
  const state = useSyncExternalStore(subscribe, snapshot, snapshot);
  return { state, controller };
}
