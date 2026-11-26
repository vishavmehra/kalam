import { router } from 'expo-router';
import { LibraryBig } from 'lucide-react-native';
import { View } from 'react-native';

import { routes } from '@/components/shell/routes';
import { Button, InkUnderline, Logo, Screen, Slip, Text, useBreakpoint, useKalamTheme, withAlpha } from '@/design';
import { useT } from '@/i18n/react';

/** Three ruled lines of a ledger page; the middle entry is empty and struck with the red pen. */
function EmptyEntry() {
  const { colors } = useKalamTheme();
  const rule = { height: 1, backgroundColor: withAlpha(colors.text, 0.16) };
  return (
    <View aria-hidden pointerEvents="none" style={{ gap: 26, paddingTop: 10, paddingBottom: 6 }}>
      <View style={rule} />
      <View>
        <View style={rule} />
        <View style={{ position: 'absolute', start: 0, top: -9 }}><InkUnderline width={120} /></View>
      </View>
      <View style={rule} />
    </View>
  );
}

/** Unknown routes: a ledger page with no entry, and the way back to the shelf. */
export default function NotFound() {
  const { uiLanguage } = useKalamTheme();
  const t = useT(uiLanguage);
  const { isPhone } = useBreakpoint();
  return (
    <Screen maxWidth={560} safeBottom align="center" contentStyle={{ marginTop: isPhone ? 40 : 96 }}>
      <View style={{ gap: 32 }}>
        <Logo size={32} />
        <Slip
          testID="not-found"
          tint="kraft"
          numberLabel={`${t('slip.no')} 404`}
          title={t('errors.notFound.title')}
          footer={<Button label={t('errors.notFound.cta')} icon={LibraryBig} onPress={() => router.replace(routes.shelf)} testID="not-found-shelf" />}
        >
          <Text tone="secondary">{t('errors.notFound.description')}</Text>
          <EmptyEntry />
        </Slip>
      </View>
    </Screen>
  );
}
