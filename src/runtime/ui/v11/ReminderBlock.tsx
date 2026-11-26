/**
 * Reminder (KalamSpec 1.1): says in one sentence when it fires and lets the person switch it on.
 * Off by default: nothing is scheduled and no notification permission is asked for until then.
 * The status line says what really happened (blocked notifications, a device that cannot show
 * them), never just "On".
 */
import { Bell, BellOff } from 'lucide-react-native';
import { memo } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { PERMISSION_REASON } from '@/core/spec/copy';
import type { ComponentOf, KalamSpec } from '@/core/spec/schema';
import type { RuntimeTheme } from '../../engine/theme';
import { describeReminder, type ReminderStatus } from '../../engine/v11';
import { useComponentBounds } from '../../layout';
import { useV11Words } from '../../use-app-t';
import { font, Pressy } from '../kit';

export interface ReminderBlockProps {
  c: ComponentOf<'reminder'>;
  t: RuntimeTheme;
  spec: KalamSpec;
  enabled: boolean;
  /** Result of the last switch (setReminderEnabled's `reminderStatus`). Absent: plain on or off. */
  status?: ReminderStatus;
  busy?: boolean;
  onToggle(on: boolean): void;
  /** Opens the system page where blocked notifications can be allowed (absent on web). */
  onOpenSettings?(): void;
  /** Read-aloud of the component's readAloud / a11yLabel text when the person uses it. */
  onFocus?(): void;
  /** Language of the words. Absent: the running app's own (spec.lang). */
  lang?: string;
}

export const ReminderBlock = memo(function ReminderBlock({ c, t, spec, enabled, status, busy, onToggle, onOpenSettings, onFocus, lang }: ReminderBlockProps) {
  const bounds = useComponentBounds(c.id);
  const w = useV11Words(lang ?? spec.lang);
  const shown: ReminderStatus = !enabled ? 'off' : status && status !== 'off' ? status : 'on';
  const Icon = shown === 'on' ? Bell : BellOff;
  // The app's own reason, shown before the person is asked (docs/14 §10.7).
  const reason = spec.permissions?.find((p) => p.kind === 'notifications')?.reason ?? PERMISSION_REASON.notifications;
  const label = <Text style={[font(t, 15, '500'), { color: t.colors.text, flex: 1 }]}>{w.remindMe}</Text>;
  return (
    <View
      {...bounds}
      style={[styles.box, { gap: t.space * 0.5, padding: t.space, backgroundColor: t.colors.surface, borderColor: t.colors.border, borderWidth: t.borderWidth, borderRadius: t.radius }]}
    >
      <View style={styles.head}>
        <Icon size={22 * t.fontScale} color={shown === 'on' ? t.colors.primaryText : t.colors.textMuted} />
        <Text style={[font(t, 16, '600', 1.3), { color: t.colors.text, flex: 1 }]}>{c.label}</Text>
      </View>
      <Text style={[font(t, 15), { color: t.colors.text }]}>{describeReminder(spec, c, lang)}</Text>
      {enabled ? null : <Text style={[font(t, 14), { color: t.colors.textMuted }]}>{w.reminderWhy(reason)}</Text>}
      {/* Same row pattern as the 1.0 toggle; left-handed puts the switch on the leading edge. */}
      <View style={[styles.head, { minHeight: t.target }]}>
        {t.mirror ? null : label}
        <Switch
          value={enabled}
          disabled={busy}
          onValueChange={(on) => {
            onFocus?.();
            onToggle(on);
          }}
          accessibilityLabel={`${w.remindMe}: ${c.a11yLabel ?? c.label}`}
          accessibilityHint={c.a11yDescription}
          accessibilityState={{ checked: enabled, disabled: !!busy }}
          trackColor={{ true: t.colors.primary, false: t.colors.border }}
          thumbColor={t.colors.surface}
        />
        {t.mirror ? label : null}
      </View>
      <Text accessibilityLiveRegion="polite" style={[font(t, 13), { color: shown === 'on' || shown === 'off' ? t.colors.textMuted : t.colors.text }]}>
        {w.reminderStatus[shown]}
      </Text>
      {shown === 'no_permission' && onOpenSettings ? (
        <Pressy
          accessibilityRole="button"
          accessibilityLabel={w.openSettings}
          onPress={onOpenSettings}
          style={[styles.head, { minHeight: t.target, alignSelf: t.mirror ? 'flex-end' : 'flex-start' }]}
        >
          <Text style={[font(t, 15, '600'), { color: t.colors.primaryText }]}>{w.openSettings}</Text>
        </Pressy>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  box: { alignSelf: 'stretch' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
