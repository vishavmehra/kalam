/**
 * One block of the cloud notice: a stamp saying where the thing happens (Cloud or On device, words as well as
 * an icon), its title, and one honest sentence. Shared by the first-build notice and the later one.
 */
import type { ReactNode } from 'react';
import { View } from 'react-native';

import { Stamp, Text, useKalamTheme } from '@/design';
import { useT } from '@/i18n/react';

export function NoticeRow({ where, title, children }: { where: 'cloud' | 'device'; title: string; children: ReactNode }) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  return (
    <View style={{ gap: theme.space[2] }}>
      <Stamp kind={where} label={t(where === 'cloud' ? 'stamp.cloud' : 'stamp.device')} size="sm" />
      <View style={{ gap: 2 }}>
        <Text weight="semibold">{title}</Text>
        <Text variant="bodySmall" tone="secondary">{children}</Text>
      </View>
    </View>
  );
}
