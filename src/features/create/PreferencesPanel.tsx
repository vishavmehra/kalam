/** Optional creation preferences: look, language and currency of the generated app. */
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { Chip, Text, useKalamTheme } from '@/design';
import { LANGUAGES } from '@/components/languages';
import { THEME_PRESETS, type ThemePreset } from '@/core/spec/schema';
import { THEME_PRESET_TOKENS } from '@/core/templates/themes';
import { useCreationStore } from '@/state/creation-store';

const PRESET_NAMES: Record<ThemePreset, string> = {
  calm_green: 'Calm green', warm_paper: 'Warm paper', ocean_blue: 'Ocean blue',
  soft_lavender: 'Soft lavender', minimal_neutral: 'Minimal', high_contrast: 'High contrast',
};
const CURRENCIES = [
  { code: 'INR', label: '₹ Rupee' }, { code: 'USD', label: '$ Dollar' }, { code: 'EUR', label: '€ Euro' },
  { code: 'GBP', label: '£ Pound' }, { code: 'AED', label: 'AED Dirham' },
] as const;

function Group({ title, children }: { title: string; children: ReactNode }) {
  const { space } = useKalamTheme();
  return (
    <View role="radiogroup" aria-label={title} style={{ gap: space[2] }}>
      <Text variant="bodySmall" weight="semibold" tone="secondary">{title}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>{children}</View>
    </View>
  );
}

export function PreferencesPanel() {
  const { colors, space, radius } = useKalamTheme();
  const prefs = useCreationStore((s) => s.preferences);
  const setPreferences = useCreationStore((s) => s.setPreferences);

  return (
    <View style={{ gap: space[5] }}>
      <Text variant="bodySmall" tone="muted">Optional. Kalam picks sensible defaults when these are left empty.</Text>
      <Group title="Look">
        {THEME_PRESETS.map((p) => {
          const selected = prefs.themePreset === p;
          return (
            <View key={p} style={{ flexDirection: 'row', alignItems: 'center', gap: space[1] }}>
              <View
                accessibilityElementsHidden
                importantForAccessibility="no"
                style={{ width: 14, height: 14, borderRadius: radius.pill, backgroundColor: THEME_PRESET_TOKENS[p].primary, borderWidth: 1, borderColor: colors.border }}
              />
              <Chip label={PRESET_NAMES[p]} role="radio" selected={selected} onPress={() => setPreferences({ themePreset: selected ? undefined : p })} />
            </View>
          );
        })}
      </Group>
      <Group title="App language">
        {LANGUAGES.map((l) => (
          <Chip
            key={l.code}
            label={l.native}
            lang={l.code}
            accessibilityLabel={l.english}
            role="radio"
            selected={prefs.language === l.code}
            onPress={() => setPreferences({ language: l.code })}
          />
        ))}
      </Group>
      <Group title="Currency">
        {CURRENCIES.map((c) => {
          const selected = prefs.currency === c.code;
          return <Chip key={c.code} label={c.label} role="radio" selected={selected} onPress={() => setPreferences({ currency: selected ? undefined : c.code })} />;
        })}
      </Group>
    </View>
  );
}
