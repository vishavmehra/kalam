import { View } from 'react-native';

import { Sheet, Text, useKalamTheme } from '@/design';
import { useT } from '@/i18n/react';

import { FONT_NOTICES, OSS_NOTICES } from './oss-notices-data';

/** Open-source notices (docs/11): what Kalam is built with and under which licence, readable offline. */
export function OssNoticesSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const line = { flexDirection: 'row' as const, flexWrap: 'wrap' as const, justifyContent: 'space-between' as const, gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.colors.border };
  return (
    <Sheet visible={visible} onClose={onClose} title={t('settings.notices.title')} description={t('settings.notices.intro')} maxWidth={640} testID="oss-notices">
      <View style={{ gap: 20 }}>
        <View>
          <Text variant="h4" level={3}>{t('settings.notices.packages')}</Text>
          {OSS_NOTICES.map((n) => (
            <View key={n.name} style={line}>
              <Text variant="bodySmall" weight="semibold" style={{ flexShrink: 1 }}>{n.name}</Text>
              <Text variant="bodySmall" tone="muted">{`${n.version}, ${n.license}`}</Text>
            </View>
          ))}
        </View>
        <View>
          <Text variant="h4" level={3}>{t('settings.notices.fonts')}</Text>
          {FONT_NOTICES.map((f) => (
            <View key={f.family} style={line}>
              <Text variant="bodySmall" weight="semibold" style={{ flexShrink: 1 }}>{f.family}</Text>
              <Text variant="bodySmall" tone="muted">{f.by}</Text>
            </View>
          ))}
        </View>
      </View>
    </Sheet>
  );
}
