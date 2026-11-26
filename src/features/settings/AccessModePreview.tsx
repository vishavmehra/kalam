import { Activity, LibraryBig, type LucideIcon, PenLine, Settings } from 'lucide-react-native';
import { View } from 'react-native';

import type { AccessModes } from '@/core/contracts';
import { Button, Surface, Text, ThemeProvider, useKalamTheme } from '@/design';
import type { TranslationKey } from '@/i18n/keys';
import { useT } from '@/i18n/react';

import { sampleKeys } from './access-preview';

const KEYS: Record<ReturnType<typeof sampleKeys>[number], { label: TranslationKey; icon: LucideIcon }> = {
  shelf: { label: 'nav.shelf', icon: LibraryBig },
  make: { label: 'shell.make', icon: PenLine },
  activity: { label: 'nav.activity', icon: Activity },
  settings: { label: 'nav.settings', icon: Settings },
};

/**
 * A small sample of Kalam as it would look with `modes` on (docs/03 §19.4). It nests a preview ThemeProvider, so the
 * sample is drawn in the proposed look while the sheet around it keeps the current one, and nothing on the page changes.
 */
export function AccessModePreview({ modes }: { modes: AccessModes }) {
  const outer = useKalamTheme();
  return (
    <ThemeProvider
      preview
      settings={{ colorScheme: outer.scheme, reducedMotion: outer.reducedMotion ? 'on' : 'off', language: outer.uiLanguage, accessModes: modes }}
    >
      <Sample modes={modes} />
    </ThemeProvider>
  );
}

function Sample({ modes }: { modes: AccessModes }) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const c = theme.colors;
  return (
    <Surface tone="paper" bordered padded={14} style={{ gap: 12 }} pointerEvents="none" testID="access-preview">
      <Text variant="h3" level={0}>{t('settings.access.preview.sampleTitle')}</Text>
      <Text>{t('settings.access.preview.sampleBody')}</Text>
      <View style={{ alignItems: 'flex-start' }}>
        <Button label={t('settings.access.preview.sampleButton')} onPress={() => undefined} />
      </View>
      <View aria-hidden style={{ flexDirection: 'row', gap: 4, borderTopWidth: 1, borderTopColor: c.border, paddingTop: 8 }}>
        {sampleKeys(modes).map((k) => {
          const Icon = KEYS[k].icon;
          return (
            <View key={k} style={{ flex: 1, minHeight: theme.touchTarget, alignItems: 'center', justifyContent: 'center', gap: 2 }}>
              <Icon size={Math.round(18 * Math.min(theme.fontScale, 1.25))} color={c.textSecondary} />
              <Text variant="caption" numberOfLines={1}>{t(KEYS[k].label)}</Text>
            </View>
          );
        })}
      </View>
    </Surface>
  );
}
