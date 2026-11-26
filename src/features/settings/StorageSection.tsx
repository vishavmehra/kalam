import { Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { Button, ConfirmSheet, Text, useBreakpoint, useKalamTheme, useToast } from '@/design';
import { clearDiagnostics } from '@/features/diagnostics';
import { useT } from '@/i18n/react';
import { useAppsStore } from '@/state/apps-store';

import { Section } from './Section';
import { wipeLocalData } from './wipe';

/**
 * Full local wipe. Backups live in BackupPanel (encrypted) and space per app in StorageManagerPanel.
 * The wipe also clears the usage counts and timings that diagnostics keeps (M1).
 */
export function StorageSection() {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const toast = useToast();
  const { isPhone } = useBreakpoint();
  const refresh = useAppsStore((s) => s.refresh);
  const [confirmWipe, setConfirmWipe] = useState(false);

  const wipe = async () => {
    try {
      await wipeLocalData();
      await clearDiagnostics().catch(() => {});
      await refresh();
      toast.show({ message: t('settings.storage.deleted'), tone: 'success' });
    } catch {
      toast.show({ message: t('settings.storage.deleteFailed'), tone: 'danger' });
    } finally {
      setConfirmWipe(false);
    }
  };

  return (
    <Section title={t('settings.wipe.title')} description={t('settings.wipe.intro')} testID="settings-wipe">
      <View style={{ gap: 8, paddingVertical: 8, alignItems: isPhone ? 'stretch' : 'flex-start' }}>
        <Button label={t('settings.storage.deleteAll')} icon={Trash2} variant="destructive" onPress={() => setConfirmWipe(true)} fullWidth={isPhone} />
        <Text variant="bodySmall" tone="muted">{t('settings.wipe.keeps')}</Text>
      </View>
      <ConfirmSheet
        visible={confirmWipe}
        title={t('settings.storage.deleteTitle')}
        message={t('settings.wipe.confirm')}
        confirmLabel={t('settings.wipe.confirmLabel')}
        destructive
        onCancel={() => setConfirmWipe(false)}
        onConfirm={wipe}
      />
    </Section>
  );
}
