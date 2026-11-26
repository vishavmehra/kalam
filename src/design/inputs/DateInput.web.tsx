/** Web date input: the browser's own `<input type="date">` (localised, accessible picker, no library), styled from the tokens. */
import { createElement, useId, useState } from 'react';
import { View } from 'react-native';

import { useT } from '@/i18n/react';

import { useKalamTheme } from '../theme';
import { fontFamily } from '../typography';
import { webData } from '../web';
import type { DateInputProps } from './DateInput';
import { parseDateText, type DateError } from './logic';
import { dateMessage, FieldShell, frameStyle } from './shared';
import { useParsedText } from './useParsedText';

export function DateInput({ label, labelHidden, value, onChange, min, max, helper, error, disabled, testID }: DateInputProps) {
  const theme = useKalamTheme();
  const c = theme.colors;
  const tr = useT(theme.uiLanguage);
  const id = useId();
  const [focused, setFocused] = useState(false);
  const rules = { min, max };
  // Same contract as the phone field: `value` is null unless the text is a real date in range. The text stays
  // as typed so the message can explain why (the picker greys out days outside min and max, typing does not).
  const field = useParsedText<string, DateError>({ value, onChange, parse: (t) => parseDateText(t, rules), format: (v) => v });
  const parsed = parseDateText(field.text, rules);
  const message = error ?? (parsed.kind === 'error' ? dateMessage(tr, parsed.reason, rules) : undefined);
  return (
    <FieldShell id={id} label={label} labelHidden={labelHidden} helper={helper} error={message} theme={theme}>
      <View {...webData({ kField: '' })} style={frameStyle(theme, { focused, error: !!message, disabled })}>
        {createElement('input', {
          type: 'date',
          value: field.text,
          min,
          max,
          disabled,
          'aria-label': label,
          'aria-labelledby': labelHidden ? undefined : `${id}-label`,
          'aria-invalid': !!message,
          'aria-describedby': message || helper ? `${id}-desc` : undefined,
          'data-testid': testID,
          // An unfinished or impossible date reads as '' while it is being typed.
          onChange: (e: { target: { value: string } }) => field.onChangeText(e.target.value),
          onFocus: () => setFocused(true),
          onBlur: () => setFocused(false),
          style: {
            flex: 1,
            alignSelf: 'stretch',
            minHeight: theme.touchTarget - 4,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            color: c.text,
            colorScheme: theme.scheme,
            accentColor: c.primary,
            fontFamily: fontFamily('regular', false, theme.script),
            fontSize: Math.round(16 * theme.fontScale),
          },
        })}
      </View>
    </FieldShell>
  );
}
