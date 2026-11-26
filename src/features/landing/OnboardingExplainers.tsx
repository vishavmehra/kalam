import { View } from 'react-native';

import { Text, useKalamTheme } from '@/design';
import type { TranslationKey } from '@/i18n/keys';
import { useT } from '@/i18n/react';

const ITEMS: ReadonlyArray<{ title: TranslationKey; body: TranslationKey }> = [
  { title: 'onboarding.know.ai.title', body: 'onboarding.know.ai.body' },
  { title: 'onboarding.know.access.title', body: 'onboarding.know.access.body' },
  { title: 'onboarding.know.offline.title', body: 'onboarding.know.offline.body' },
];

/**
 * Three plain facts a new person should have before the first app (docs/03 §10.1): which AI Kalam uses and that it always
 * says so, that accessibility modes apply everywhere, and that apps keep working with no signal. A definition list on
 * hairlines, not a row of feature cards.
 */
export function OnboardingExplainers() {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  return (
    <View role="group" aria-label={t('onboarding.know.title')} style={{ gap: 0, maxWidth: 540 }} testID="onboarding-know">
      <Text variant="bodySmall" weight="semibold" tone="secondary" style={{ marginBottom: 4 }}>{t('onboarding.know.title')}</Text>
      {ITEMS.map((item) => (
        <View key={item.title} style={{ gap: 2, paddingVertical: 10, borderTopWidth: 1, borderTopColor: theme.colors.border }}>
          <Text variant="body" weight="semibold">{t(item.title)}</Text>
          <Text variant="bodySmall" tone="secondary">{t(item.body)}</Text>
        </View>
      ))}
    </View>
  );
}
