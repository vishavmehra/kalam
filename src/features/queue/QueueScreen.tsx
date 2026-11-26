import { router, type Href } from 'expo-router';
import { View } from 'react-native';

import { LedgerRule, Screen, Text, useKalamTheme } from '@/design';
import { useT } from '@/i18n/react';

import { QueuePanel } from './QueuePanel';

/** The queued tasks page. Route file: `export { QueueScreen as default } from '@/features/queue';` */
export function QueueScreen() {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  return (
    <Screen maxWidth={760} testID="queue-screen">
      <View style={{ gap: 6, marginBottom: theme.space[5] }}>
        <Text variant="h1" level={1}>{t('queue.title')}</Text>
        <LedgerRule />
      </View>
      <QueuePanel
        onOpenReview={() => router.push('/create/review' as Href)}
        onOpenApp={(id) => router.push(`/app/${encodeURIComponent(id)}` as Href)}
      />
    </Screen>
  );
}
