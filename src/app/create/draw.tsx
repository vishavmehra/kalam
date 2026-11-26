/**
 * Drawing Studio route (docs/08, docs/02 §11.4). The studio itself lives in
 * `src/features/drawing/DrawingStudioScreen.tsx` and loads on first visit, so the shelf, Make and the
 * apps you run do not pay for the canvas, the tools and the exporters at start.
 */
import { lazy, Suspense } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { Text, useKalamTheme } from '@/design';
import { useT } from '@/i18n/react';

const Studio = lazy(() => import('@/features/drawing/DrawingStudioScreen'));

function StudioLoading() {
  const { colors, uiLanguage } = useKalamTheme();
  const t = useT(uiLanguage);
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: colors.background }} accessibilityLiveRegion="polite">
      <ActivityIndicator color={colors.textSecondary} />
      <Text tone="secondary">{t('common.loading')}</Text>
    </View>
  );
}

export default function DrawingStudio() {
  return <Suspense fallback={<StudioLoading />}><Studio /></Suspense>;
}
