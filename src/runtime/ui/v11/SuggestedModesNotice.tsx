/**
 * Offers the Access Modes an app suggests (spec.accessibility.suggestedModes). The app never turns
 * a mode on by itself: Access Modes belong to the person (docs/10). "Turn on" adds them to the
 * person's own modes, which they can switch off again in Settings; "Not now" hides the offer for
 * this app. Renders nothing when there is nothing to offer.
 */
import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { SuggestedMode } from '@/core/spec/schema';
import type { RuntimeTheme } from '../../engine/theme';
import { useV11Words } from '../../use-app-t';
import { font, Pressy } from '../kit';

export interface SuggestedModesNoticeProps {
  t: RuntimeTheme;
  /** From offeredAccessModes(spec, accessModes, kvState). */
  modes: readonly SuggestedMode[];
  onAccept(modes: readonly SuggestedMode[]): void;
  onDismiss(): void;
  /** Language of the words. Absent: the running app's own. */
  lang?: string;
}

export const SuggestedModesNotice = memo(function SuggestedModesNotice({ t, modes, onAccept, onDismiss, lang }: SuggestedModesNoticeProps) {
  const w = useV11Words(lang);
  if (!modes.length) return null;
  const text = w.modesOffer(modes.map((m) => w.modeNames[m]));
  const button = (label: string, primary: boolean, onPress: () => void) => (
    <Pressy
      key={label}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[
        styles.btn,
        {
          minHeight: t.target,
          paddingHorizontal: t.space,
          borderRadius: Math.min(t.radius, 16),
          backgroundColor: primary ? t.colors.primary : 'transparent',
          borderColor: t.colors.primaryText,
          borderWidth: primary ? 0 : Math.max(1, t.borderWidth),
        },
      ]}
    >
      <Text style={[font(t, 15, '600'), { color: primary ? t.colors.onPrimary : t.colors.primaryText }]}>{label}</Text>
    </Pressy>
  );
  const buttons = [button(w.turnOn, true, () => onAccept(modes)), button(w.notNow, false, onDismiss)];
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[styles.box, { gap: t.space * 0.75, padding: t.space, borderRadius: t.radius, backgroundColor: t.colors.primarySoft, borderColor: t.colors.border, borderWidth: t.borderWidth }]}
    >
      <Text style={[font(t, 15), { color: t.colors.text }]}>{text}</Text>
      {/* Left-handed: the main control sits on the leading edge. */}
      <View style={[styles.row, { justifyContent: t.mirror ? 'flex-start' : 'flex-end' }]}>{t.mirror ? buttons : [...buttons].reverse()}</View>
    </View>
  );
});

const styles = StyleSheet.create({
  box: { alignSelf: 'stretch' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  btn: { alignItems: 'center', justifyContent: 'center' },
});
