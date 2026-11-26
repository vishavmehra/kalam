import { router } from 'expo-router';
import { Store } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { listingIdFromBasedOn } from '@/core/bazaar';
import type { KalamSpec } from '@/core/spec/schema';
import { Text, useKalamTheme } from '@/design';
import { useT } from '@/i18n/react';

import { bazaarRoutes } from './routes';

/**
 * Credit line for apps installed or remixed from Kalam Bazaar (docs/12 §15.2, §15.4), set in Courier Prime
 * (DIRECTION §6). It reads the lineage kept in `meta`, which ordinary edits never change, so attribution cannot
 * be dropped. Renders nothing for other apps. Mount next to the app title in the run and edit screens.
 */
export function AttributionNote({ spec }: { spec: KalamSpec }) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const listingId = listingIdFromBasedOn(spec.meta.basedOn);
  if (!listingId) return null;
  const remix = spec.meta.source === 'remix';
  const author = spec.meta.author;
  const what = remix
    ? author ? t('bazaar.attribution.remixBy', { name: author }) : t('bazaar.attribution.remix')
    : author ? t('bazaar.attribution.fromBy', { name: author }) : t('bazaar.attribution.from');
  return (
    <Pressable
      role="link"
      accessibilityLabel={t('bazaar.attribution.open', { what })}
      onPress={() => router.push(bazaarRoutes.listing(listingId))}
      hitSlop={8}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 28, alignSelf: 'flex-start' }}
    >
      <Store size={14} color={theme.colors.textMuted} />
      <View>
        <Text variant="caption" tone="muted" mono numberOfLines={1} style={{ textDecorationLine: 'underline' }}>{what}</Text>
      </View>
    </Pressable>
  );
}
