/**
 * One-time notice before the first build that may send content online (docs/03 §23,
 * docs/11 §8.3). Says exactly what leaves the device and what never does, then lets the person
 * send or stop. Accepting sets settings.cloudNoticeSeen.
 */
import { Cloud } from 'lucide-react-native';
import { View } from 'react-native';

import { Button, Sheet, Text, useBreakpoint, useKalamTheme } from '@/design';
import { NoticeRow } from '@/features/cloud-consent/NoticeRow';
import { useT } from '@/i18n/react';

export function CloudNoticeSheet({ visible, onSend, onCancel }: { visible: boolean; onSend: () => void; onCancel: () => void }) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const { space } = theme;
  const { isPhone } = useBreakpoint();
  const send = <Button key="send" label={t('create.notice.send')} icon={Cloud} onPress={onSend} fullWidth={isPhone} testID="cloud-notice-send" />;
  const cancel = <Button key="cancel" label={t('create.notice.notNow')} variant="ghost" onPress={onCancel} fullWidth={isPhone} />;
  return (
    <Sheet
      visible={visible}
      onClose={onCancel}
      title={t('create.notice.title')}
      description={t('create.notice.description')}
      // Phones stack the actions with the main one first, under the thumb.
      footer={isPhone ? [send, cancel] : [cancel, send]}
    >
      <View style={{ gap: space[4] }}>
        <NoticeRow where="cloud" title={t('create.notice.sentTitle')}>{t('create.notice.sentBody')}</NoticeRow>
        <NoticeRow where="cloud" title={t('create.notice.laterTitle')}>{t('create.notice.laterBody')}</NoticeRow>
        <NoticeRow where="device" title={t('create.notice.neverTitle')}>{t('create.notice.neverBody')}</NoticeRow>
        <Text variant="bodySmall" tone="muted">{t('create.notice.footer')}</Text>
      </View>
    </Sheet>
  );
}
