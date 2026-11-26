import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Text, useKalamTheme } from '@/design';
import { useT } from '@/i18n/react';

import { moderationApi } from './client';
import type { ListingStats } from './model';

/**
 * A maker's own numbers for one listing (docs/12 §13.1, §21): views, previews and installs. Views and previews
 * only count people who chose to share them, and the line says so. It hides itself when the numbers cannot be
 * loaded (offline, signed out, not the maker, functions not deployed), because a missing number is not news.
 */
export function ListingCountsLine({ listingId }: { listingId: string }) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const [stats, setStats] = useState<ListingStats | null>(null);
  useEffect(() => {
    let alive = true;
    void moderationApi.stats(listingId).then((r) => { if (alive && r.ok) setStats(r.data); });
    return () => { alive = false; };
  }, [listingId]);
  if (!stats) return null;
  return (
    <View style={{ gap: 2 }}>
      <Text variant="bodySmall" numeric>{t('bazaar.mod.counts.line', { views: stats.views, previews: stats.previews, installs: stats.installs })}</Text>
      <Text variant="caption" tone="muted">{t('bazaar.mod.counts.note')}</Text>
    </View>
  );
}
