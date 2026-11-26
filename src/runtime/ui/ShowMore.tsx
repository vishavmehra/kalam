/**
 * "Show more" under a screen that Simple mode has folded (docs/10 §4.3). A plain text button in the app's own theme:
 * it opens, or closes again, the secondary components of that one screen. Nothing is deleted either way.
 */
import { ChevronDown } from 'lucide-react-native';
import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { RuntimeTheme } from '../engine/theme';
import { font, Pressy } from './kit';

export const ShowMoreToggle = memo(function ShowMoreToggle({ t, open, label, onPress }: {
  t: RuntimeTheme; open: boolean; label: string; onPress(): void;
}) {
  return (
    <Pressy
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ expanded: open }}
      aria-expanded={open}
      onPress={onPress}
      style={[styles.toggle, { minHeight: t.target, borderRadius: t.radius }]}
    >
      <Text style={[font(t, 16, '600'), { color: t.colors.primaryText }]}>{label}</Text>
      <View style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}>
        <ChevronDown size={18 * t.fontScale} color={t.colors.primaryText} />
      </View>
    </Pressy>
  );
});

const styles = StyleSheet.create({
  toggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, alignSelf: 'center', paddingHorizontal: 16 },
});
