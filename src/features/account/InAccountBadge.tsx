import { Cloud, CloudUpload } from 'lucide-react-native';

import type { StoredApp } from '@/core/contracts';
import { Chip, useKalamTheme } from '@/design';
import { useT } from '@/i18n/react';

import { useAccountSync } from './use-account-sync';

/**
 * Shelf badge: "In your account" once this app's current design is in the account, "Waiting to sync"
 * while a change is queued. Nothing when account sync is off or the person is signed out.
 */
export function InAccountBadge({ app }: { app: Pick<StoredApp, 'id' | 'spec' | 'updatedAt'> }) {
  const { sync } = useAccountSync(); // re-renders on every status change
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const state = sync.appState(app);
  if (!state) return null;
  return state === 'in_account'
    ? <Chip label={t('accountSync.badge.inAccount')} icon={Cloud} tone="neutral" />
    : <Chip label={t('accountSync.badge.waiting')} icon={CloudUpload} tone="info" />;
}
