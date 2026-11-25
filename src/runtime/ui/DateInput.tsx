/**
 * Android date input: typed YYYY-MM-DD plus a one-tap "Today". (No date-picker package is
 * installed; validation of the typed value happens in the engine.)
 */
import { Text, TextInput, View, type ViewStyle } from 'react-native';
import { isoDate } from '../engine/fields';
import type { RuntimeTheme } from '../engine/theme';
import { font, Pressy } from './kit';

export interface DateInputProps {
  t: RuntimeTheme;
  label: string;
  labelledBy: string;
  value: string;
  onChange(value: string): void;
  onFocus(): void;
  onBlur(): void;
  boxStyle: ViewStyle;
}

export function DateInput({ t, label, labelledBy, value, onChange, onFocus, onBlur, boxStyle }: DateInputProps) {
  return (
    <View style={[boxStyle, { flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
      <TextInput
        accessibilityLabel={`${label}, year-month-day`}
        accessibilityLabelledBy={labelledBy}
        value={value}
        onChangeText={onChange}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={t.colors.textMuted}
        keyboardType="numbers-and-punctuation"
        maxLength={10}
        style={[font(t, 17, '500'), { flex: 1, color: t.colors.text, paddingVertical: 10 }]}
      />
      <Pressy
        accessibilityRole="button"
        accessibilityLabel={`Set ${label} to today`}
        onPress={() => onChange(isoDate(new Date()))}
        style={{ minHeight: t.target, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 999, backgroundColor: t.colors.primarySoft }}
      >
        <Text style={[font(t, 14, '600'), { color: t.colors.primaryText }]}>Today</Text>
      </Pressy>
    </View>
  );
}
