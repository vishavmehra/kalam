import { Moon, Sun } from 'lucide-react-native';

import { IconButton, Tooltip, useKalamTheme, useToast } from '@/design';
import { useT } from '@/i18n/react';
import { useSettingsStore } from '@/state/settings-store';

/**
 * Paper or Ink night in one press. The first press turns "Match device" into an explicit choice; Settings can
 * set it back. Stored in settings, so it survives a restart.
 */
export function ThemeToggle({ color }: { color?: string }) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const toast = useToast();
  const update = useSettingsStore((s) => s.update);
  const toInk = theme.scheme === 'light';
  const label = toInk ? t('shell.theme.toInk') : t('shell.theme.toPaper');
  return (
    <Tooltip label={label} placement="bottom">
      <IconButton
        icon={toInk ? Moon : Sun}
        label={label}
        color={color}
        testID="theme-toggle"
        onPress={() => {
          update({ colorScheme: toInk ? 'dark' : 'light' }).catch(() => toast.show({ message: t('settings.saveError'), tone: 'danger' }));
        }}
      />
    </Tooltip>
  );
}
