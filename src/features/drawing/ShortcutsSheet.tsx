import { View } from 'react-native';

import { Sheet, Text, useKalamTheme } from '@/design';
import { useT } from '@/i18n/react';

import { SHORTCUT_GROUPS } from './shortcuts';

/** One key cap: a small raised key, so a chord reads as keys pressed together. */
function KeyCap({ label }: { label: string }) {
  const { colors, radius } = useKalamTheme();
  return (
    <View style={{ minWidth: 28, height: 28, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, borderWidth: 1, borderBottomWidth: 2.5, borderColor: colors.borderStrong, backgroundColor: colors.surfaceAlt }}>
      <Text mono variant="caption" weight="bold">{label}</Text>
    </View>
  );
}

/** Every Studio shortcut in one place (docs/10 §6.3). Opens from the keyboard icon or the ? key. */
export function ShortcutsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  return (
    <Sheet visible={visible} onClose={onClose} title={t('studio.shortcuts.title')} description={t('studio.shortcuts.intro')} maxWidth={560} testID="studio-shortcuts">
      <View style={{ gap: 22 }}>
        {SHORTCUT_GROUPS.map((g) => (
          <View key={g.title} role="group" aria-label={t(g.title)} style={{ gap: 4 }}>
            <Text variant="h4" level={3}>{t(g.title)}</Text>
            {g.rows.map((row) => (
              <View key={row.action} style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
                <Text variant="bodySmall" style={{ flexShrink: 1 }}>{t(row.action)}</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                  {row.chords.map((chord, i) => (
                    <View key={chord.join('+')} style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                      {i > 0 ? <Text variant="caption" tone="muted">{t('studio.shortcuts.or')}</Text> : null}
                      {chord.map((k, j) => (
                        <View key={`${k}${j}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                          {j > 0 ? <Text variant="caption" tone="muted">+</Text> : null}
                          <KeyCap label={k} />
                        </View>
                      ))}
                    </View>
                  ))}
                </View>
              </View>
            ))}
          </View>
        ))}
      </View>
    </Sheet>
  );
}
