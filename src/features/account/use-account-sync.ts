import { useSyncExternalStore } from 'react';

import type { AccountSyncStatus } from '@/core/account-sync';
import { getAccountSync } from '@/infrastructure/account-sync/service';

/** Live status of "my apps in my account" plus the engine for actions. */
export function useAccountSync(): { status: AccountSyncStatus; sync: ReturnType<typeof getAccountSync> } {
  const sync = getAccountSync();
  const status = useSyncExternalStore(sync.subscribe, sync.status, sync.status);
  return { status, sync };
}
