import { CircleAlert, type LucideIcon } from 'lucide-react-native';
import { useId, useState } from 'react';
import { TextInput, type TextInputProps, View } from 'react-native';

import { Text } from './Text';
import { useKalamTheme } from './theme';
import { fontFamily } from './typography';

export interface TextFieldProps extends Omit<TextInputProps, 'style' | 'placeholderTextColor'> {
  /** Visible label (placeholders never replace labels — docs/02 §10.2). */
  label: string;
  /** Visually hide the label (search fields with an icon only); it stays the accessible name. */
  labelHidden?: boolean;
  helper?: string;
  /** Validation message; also marks the field invalid. */
  error?: string;
  icon?: LucideIcon;
}

/** Labelled text input with focus, error and helper states. */
export function TextField({ label, labelHidden, helper, error, icon: Icon, multiline, onFocus, onBlur, ...rest }: TextFieldProps) {
  const theme = useKalamTheme();
  const c = theme.colors;
  const [focused, setFocused] = useState(false);
  const id = useId();
  const borderColor = error ? c.danger : focused ? c.primary : c.borderStrong;
  return (
    <View style={{ gap: 6, alignSelf: 'stretch' }}>
      {labelHidden ? null : (
        <Text variant="bodySmall" weight="medium" tone="secondary" nativeID={`${id}-label`}>{label}</Text>
      )}
      <View
        style={{
          flexDirection: 'row',
          alignItems: multiline ? 'flex-start' : 'center',
          gap: 8,
          minHeight: multiline ? 96 : theme.touchTarget,
          paddingHorizontal: 14,
          borderRadius: theme.radius.md,
          borderWidth: focused || error ? 2 : 1,
          // Keep text from shifting when the border thickens.
          margin: focused || error ? 0 : 1,
          borderColor,
          backgroundColor: c.surface,
        }}
      >
        {Icon ? <Icon size={18} color={c.textMuted} strokeWidth={2} /> : null}
        <TextInput
          {...rest}
          multiline={multiline}
          accessibilityLabel={label}
          aria-labelledby={labelHidden ? undefined : `${id}-label`}
          aria-invalid={!!error}
          aria-describedby={error || helper ? `${id}-desc` : undefined}
          placeholderTextColor={c.textMuted}
          onFocus={(e) => { setFocused(true); onFocus?.(e); }}
          onBlur={(e) => { setFocused(false); onBlur?.(e); }}
          style={{
            flex: 1,
            alignSelf: 'stretch',
            paddingVertical: multiline ? 12 : 0,
            fontFamily: fontFamily('regular', false, theme.script),
            fontSize: Math.round(15 * theme.fontScale),
            color: c.text,
            textAlignVertical: multiline ? 'top' : 'center',
            // RN-web: suppress the native outline; the border is the focus indicator.
            outlineStyle: 'none',
          } as object}
        />
      </View>
      {error ? (
        <View nativeID={`${id}-desc`} style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
          <CircleAlert size={14} color={c.danger} />
          <Text variant="bodySmall" tone="danger">{error}</Text>
        </View>
      ) : helper ? (
        <Text nativeID={`${id}-desc`} variant="bodySmall" tone="muted">{helper}</Text>
      ) : null}
    </View>
  );
}
