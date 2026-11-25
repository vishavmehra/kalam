import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';

import type { RecordRepository } from '@/core/contracts';
import { createShareService, type ShareService } from '@/core/share';
import { getDatabase, secureRandomBytes } from '@/infrastructure/storage/database';
import { createShareController, type ShareController, type ShareState } from './controller';

let shared: ShareService | undefined;

/**
 * One sharing service for the whole app, over this device's database. Links, apps and entries all
 * come from the local database. It never logs: nothing here needs to leave a trace of what was shared.
 */
export function getShareService(): ShareService {
  if (!shared) {
    const db = getDatabase();
    shared = createShareService({
      store: db.shareLinks,
      apps: db.apps,
      records: db.records,
      newId: () => Array.from(secureRandomBytes(12), (b) => b.toString(16).padStart(2, '0')).join(''),
    });
  }
  return shared;
}

let wrapped: { base: RecordRepository; repo: RecordRepository } | undefined;

/**
 * The entries the runtime reads for one app: its own, plus read only entries another app shares into it
 * through a link the person made. Hand this to the runtime instead of `db.records`. The same repository
 * comes back for the same `base`, so the runtime's change subscriptions stay stable.
 */
export function sharedRecordRepository(base: RecordRepository): RecordRepository {
  if (wrapped?.base !== base) wrapped = { base, repo: getShareService().sharedRecords(base) };
  return wrapped.repo;
}

const IDLE: ShareState = { phase: 'loading', views: [], others: [] };

/** The sharing state for one app. Loads while `active` (the sheet is open) and stops when it closes. */
export function useShareController(appId: string, active: boolean): { state: ShareState; controller: ShareController | undefined } {
  const controller = useMemo(() => {
    if (!active) return undefined;
    const db = getDatabase();
    return createShareController({
      service: getShareService(),
      appId,
      listApps: () => db.apps.list(),
      onLinksChanged: (listener) => db.shareLinks.subscribe(listener),
    });
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
