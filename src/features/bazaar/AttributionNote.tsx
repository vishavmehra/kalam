import { router } from 'expo-router';
import { Store } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { listingIdFromBasedOn } from '@/core/bazaar';
import type { KalamSpec } from '@/core/spec/schema';
import { Text, useKalamTheme } from '@/design';

import { bazaarRoutes } from './routes';

/**
 * Credit line for apps installed or remixed from Kalam Bazaar (docs/12 §15.2, §15.4). It reads the
 * lineage kept in `meta`, which ordinary edits never change, so attribution cannot be dropped.
 * Renders nothing for other apps. Mount next to the app title in the run and edit screens.
 */
export function AttributionNote({ spec }: { spec: KalamSpec }) {
  const theme = useKalamTheme();
  const listingId = listingIdFromBasedOn(spec.meta.basedOn);
  if (!listingId) return null;
  const by = spec.meta.author ? ` by ${spec.meta.author}` : '';
  const what = spec.meta.source === 'remix' ? `Remix of an app${by}` : `From Kalam Bazaar${by}`;
  return (
    <Pressable
      role="link"
      accessibilityLabel={`${what}. Open the listing.`}
      onPress={() => router.push(bazaarRoutes.listing(listingId))}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32, alignSelf: 'flex-start' }}
    >
      <Store size={14} color={theme.colors.textMuted} />
      <View>
        <Text variant="caption" tone="muted" style={{ textDecorationLine: 'underline' }}>{what}</Text>
      </View>
    </Pressable>
  );
}
