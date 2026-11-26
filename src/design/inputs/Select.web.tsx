/** Web select: the browser's own `<select>` (keyboard, type-ahead, screen readers and mobile wheels for free), styled from the tokens. */
import { ChevronDown } from 'lucide-react-native';
import { createElement, useId, useState } from 'react';
import { View } from 'react-native';

import { useT } from '@/i18n/react';

import { useKalamTheme } from '../theme';
import { fontFamily } from '../typography';
import { webData } from '../web';
import { FieldShell, frameStyle } from './shared';
import type { SelectProps } from './Select';

export function Select<T extends string>({
  label, labelHidden, options, value, onChange, placeholder, helper, error, disabled, testID,
}: SelectProps<T>) {
  const theme = useKalamTheme();
  const c = theme.colors;
  const tr = useT(theme.uiLanguage);
  const id = useId();
  const [focused, setFocused] = useState(false);
  return (
    <FieldShell id={id} label={label} labelHidden={labelHidden} helper={helper} error={error} theme={theme}>
      <View {...webData({ kField: '' })} style={frameStyle(theme, { focused, error: !!error, disabled })}>
        {createElement(
          'select',
          {
            value: value ?? '',
            disabled,
            'aria-label': label,
            'aria-labelledby': labelHidden ? undefined : `${id}-label`,
            'aria-invalid': !!error,
            'aria-describedby': error || helper ? `${id}-desc` : undefined,
            'data-testid': testID,
            onFocus: () => setFocused(true),
            onBlur: () => setFocused(false),
            onChange: (e: { target: { value: string } }) => {
              const hit = options.find((o) => o.value === e.target.value);
              if (hit) onChange(hit.value);
            },
            style: {
              flex: 1,
              alignSelf: 'stretch',
              minHeight: theme.touchTarget - 4,
              paddingInlineEnd: 28,
              appearance: 'none',
              WebkitAppearance: 'none',
              border: 'none',
              outline: 'none',
              background: 'transparent',
              cursor: disabled ? 'not-allowed' : 'pointer',
              color: value === null ? c.textMuted : c.text,
              // Dark popup lists in Ink night.
              colorScheme: theme.scheme,
              fontFamily: fontFamily('regular', false, theme.script),
              fontSize: Math.round(16 * theme.fontScale),
            },
          },
          value === null ? createElement('option', { key: '', value: '', disabled: true }, placeholder ?? tr('inputs.select.placeholder')) : null,
          options.map((o) => createElement('option', { key: o.value, value: o.value, disabled: o.disabled, style: { color: c.text, background: c.surfaceElevated } }, o.label)),
        )}
        <View pointerEvents="none" style={{ position: 'absolute', end: 14 }}>
          <ChevronDown size={18} color={c.textSecondary} strokeWidth={2} />
        </View>
      </View>
    </FieldShell>
  );
}
