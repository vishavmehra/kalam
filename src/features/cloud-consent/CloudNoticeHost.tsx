/**
 * The sheet behind the orchestrator's cloud notice (docs/03 §23, docs/11 §8.3). Mount once, high in the
 * tree. It opens when a voice command, a translation, an edit, an AI step or a photo read needs Firebase
 * before the person has seen the notice. "Allow cloud help" saves settings.cloudNoticeSeen, so Kalam asks
 * once; "Not now" sends nothing, and the feature says Kalam needs the OK.
 */
import { Cloud } from 'lucide-react-native';
import { useSyncExternalStore } from 'react';
import { View } from 'react-native';

import { Button, Sheet, useBreakpoint, useKalamTheme } from '@/design';
import { useT } from '@/i18n/react';
import { useSettingsStore } from '@/state/settings-store';

import { answerCloudNotice, isCloudNoticeOpen, subscribeCloudNotice } from './broker';
import { NoticeRow } from './NoticeRow';

export function CloudNoticeHost() {
  const open = useSyncExternalStore(subscribeCloudNotice, isCloudNoticeOpen, isCloudNoticeOpen);
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const { space } = theme;
  const { isPhone } = useBreakpoint();

  const allow = async () => {
    // Saved first so the next run reads it; the orchestrator also remembers the answer for this session.
    await useSettingsStore.getState().update({ cloudNoticeSeen: true }).catch(() => undefined);
    answerCloudNotice(true);
  };
  const notNow = () => answerCloudNotice(false);
  const send = <Button key="allow" label={t('create.notice.fallbackSend')} icon={Cloud} onPress={allow} fullWidth={isPhone} testID="cloud-consent-allow" />;
  const cancel = <Button key="cancel" label={t('create.notice.notNow')} variant="ghost" onPress={notNow} fullWidth={isPhone} testID="cloud-consent-not-now" />;

  return (
    <Sheet
      visible={open}
      onClose={notNow}
      title={t('create.notice.fallbackTitle')}
      description={t('create.notice.fallbackBody')}
      footer={isPhone ? [send, cancel] : [cancel, send]}
    >
      <View style={{ gap: space[4] }}>
        <NoticeRow where="cloud" title={t('create.notice.laterTitle')}>{t('create.notice.laterBody')}</NoticeRow>
        <NoticeRow where="device" title={t('create.notice.neverTitle')}>{t('create.notice.neverBody')}</NoticeRow>
      </View>
    </Sheet>
  );
}
