/** Web date input: the browser's native `<input type="date">` (accessible, localised, no library). */
import { createElement } from 'react';
import { View } from 'react-native';
import { luminance } from '../engine/theme';
import { font } from './kit';
import type { DateInputProps } from './DateInput';

export function DateInput({ t, label, labelledBy, value, onChange, onFocus, onBlur, boxStyle }: DateInputProps) {
  const f = font(t, 17, '500');
  return (
    <View style={[boxStyle, { justifyContent: 'center' }]}>
      {createElement('input', {
        type: 'date',
        value,
        'aria-label': label,
        'aria-labelledby': labelledBy,
        onChange: (e: { target: { value: string } }) => onChange(e.target.value),
        onFocus,
        onBlur,
        style: {
          border: 'none',
          outline: 'none',
          background: 'transparent',
          color: t.colors.text,
          colorScheme: luminance(t.colors.surface) > 0.4 ? 'light' : 'dark',
          fontSize: f.fontSize,
          fontFamily: f.fontFamily ?? 'inherit',
          fontWeight: 500,
          minHeight: t.target - 4,
          width: '100%',
          accentColor: t.colors.primary,
        },
      })}
    </View>
  );
}
