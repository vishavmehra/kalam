/** Phones: typed date (year-month-day or day first) with a Today button. The web build (DateInput.web.tsx) uses the browser's date input. */
import { useId, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { useT } from '@/i18n/react';

import { Text } from '../Text';
import { useKalamTheme } from '../theme';
import { webData } from '../web';
import { parseDateText, todayIso, type DateError } from './logic';
import { dateMessage, FieldShell, frameStyle, inputTextStyle } from './shared';
import { useParsedText } from './useParsedText';

export interface DateInputProps {
  /** Visible label (placeholders never replace labels, docs/02 §10.2). */
  label: string;
  labelHidden?: boolean;
  /** 'YYYY-MM-DD', or null while empty or not a real date in range. */
  value: string | null;
  onChange: (value: string | null) => void;
  /** Earliest and latest allowed date, 'YYYY-MM-DD'. */
  min?: string;
  max?: string;
  /** Replaces the format hint. */
  helper?: string;
  /** Message from the form; shown instead of the field's own message. */
  error?: string;
  disabled?: boolean;
  testID?: string;
}

/** Date field: type 2026-11-25 or 25/11/2026 (digits of any shipped script), or press Today. */
export function DateInput({ label, labelHidden, value, onChange, min, max, helper, error, disabled, testID }: DateInputProps) {
  const theme = useKalamTheme();
  const c = theme.colors;
  const tr = useT(theme.uiLanguage);
  const id = useId();
  const [focused, setFocused] = useState(false);
  const rules = { min, max };
  const field = useParsedText<string, DateError>({
    value,
    onChange,
    parse: (t) => parseDateText(t, rules),
    format: (v) => v,
  });
  const message = error ?? (field.error ? dateMessage(tr, field.error, rules) : undefined);
  return (
    <FieldShell id={id} label={label} labelHidden={labelHidden} helper={helper ?? tr('inputs.date.hint')} error={message} theme={theme}>
      <View {...webData({ kField: '' })} style={[frameStyle(theme, { focused, error: !!message, disabled }), { paddingEnd: 6 }]}>
        <TextInput
          value={field.text}
          onChangeText={field.onChangeText}
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); field.onBlur(); }}
          editable={!disabled}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={c.textMuted}
          keyboardType="numbers-and-punctuation"
          maxLength={10}
          accessibilityLabel={label}
          aria-labelledby={labelHidden ? undefined : `${id}-label`}
          aria-invalid={!!message}
          aria-describedby={`${id}-desc`}
          testID={testID}
          style={inputTextStyle(theme)}
        />
        <Pressable
          role="button"
          aria-label={tr('inputs.date.setToday', { label })}
          accessibilityLabel={tr('inputs.date.setToday', { label })}
          aria-disabled={!!disabled}
          accessibilityState={{ disabled: !!disabled }}
          onPress={disabled ? undefined : () => field.set(todayIso())}
          {...webData({ kPress: '', kHover: disabled ? 'none' : 'surface' })}
          style={{
            minHeight: theme.touchTarget - 8, justifyContent: 'center', paddingHorizontal: 12,
            borderRadius: theme.radius.press, backgroundColor: c.primarySoft,
          }}
        >
          <Text variant="bodySmall" weight="semibold" tone="primary">{tr('common.today')}</Text>
        </Pressable>
      </View>
    </FieldShell>
  );
}
