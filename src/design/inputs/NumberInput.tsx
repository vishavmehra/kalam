import { Minus, Plus, type LucideIcon } from 'lucide-react-native';
import { useId, useState } from 'react';
import { Platform, Pressable, TextInput, View } from 'react-native';

import { useT } from '@/i18n/react';

import { useKalamTheme } from '../theme';
import { webData } from '../web';
import { formatNumberText, parseNumberText, stepNumber, type NumberError } from './logic';
import { FieldShell, frameStyle, inputTextStyle, numberMessage } from './shared';
import { useParsedText } from './useParsedText';

export interface NumberInputProps {
  /** Visible label (placeholders never replace labels, docs/02 §10.2). */
  label: string;
  labelHidden?: boolean;
  /** The typed number, or null while empty or not a valid number in range. */
  value: number | null;
  onChange: (value: number | null) => void;
  min?: number;
  max?: number;
  /** Size of a stepper press or Up and Down key. Default 1. */
  step?: number;
  /** Places kept: 0 for whole numbers (number pad), 2 for money. Typed extra places are rounded. */
  decimals?: number;
  placeholder?: string;
  helper?: string;
  /** Message from the form; shown instead of the field's own range message. */
  error?: string;
  disabled?: boolean;
  testID?: string;
}

/**
 * Number field with minus and plus steppers. Reads typed digits of any shipped script and thousands commas;
 * out-of-range text is reported as an error, never silently changed (steppers and arrow keys do clamp).
 * Reports null until the text is a valid number in range.
 */
export function NumberInput({
  label, labelHidden, value, onChange, min, max, step, decimals, placeholder, helper, error, disabled, testID,
}: NumberInputProps) {
  const theme = useKalamTheme();
  const c = theme.colors;
  const tr = useT(theme.uiLanguage);
  const id = useId();
  const [focused, setFocused] = useState(false);
  const rules = { min, max, decimals };
  const field = useParsedText<number, NumberError>({
    value,
    onChange,
    parse: (t) => parseNumberText(t, rules),
    format: (n) => formatNumberText(n, decimals),
  });
  const message = error ?? (field.error ? numberMessage(tr, field.error, rules) : undefined);
  const web = Platform.OS === 'web';

  const bump = (dir: 1 | -1) => {
    // Step from what is typed even when it is out of range; fall back to the last good value.
    const typed = parseNumberText(field.text);
    field.set(stepNumber(typed.kind === 'ok' ? typed.value : value, dir, { min, max, step, decimals }));
  };
  const atMax = value !== null && max !== undefined && value >= max;
  const atMin = value !== null && min !== undefined && value <= min;

  return (
    <FieldShell id={id} label={label} labelHidden={labelHidden} helper={helper} error={message} theme={theme}>
      <View {...webData({ kField: '' })} style={[frameStyle(theme, { focused, error: !!message, disabled }), { paddingEnd: 4 }]}>
        <TextInput
          value={field.text}
          onChangeText={field.onChangeText}
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); field.onBlur(); }}
          onKeyPress={(e) => {
            if (!web || disabled) return;
            const k = e.nativeEvent.key;
            if (k === 'ArrowUp' || k === 'ArrowDown') { e.preventDefault(); bump(k === 'ArrowUp' ? 1 : -1); }
          }}
          editable={!disabled}
          placeholder={placeholder}
          placeholderTextColor={c.textMuted}
          // iOS decimal pad has no minus key.
          keyboardType={min !== undefined && min >= 0 ? (decimals === 0 ? 'number-pad' : 'decimal-pad') : 'numbers-and-punctuation'}
          accessibilityLabel={label}
          aria-labelledby={labelHidden ? undefined : `${id}-label`}
          aria-invalid={!!message}
          aria-describedby={message || helper ? `${id}-desc` : undefined}
          // Web: announce as a spin button. Not on native, where a spin role would change how the field is edited.
          {...(web ? { role: 'spinbutton' as const, 'aria-valuemin': min, 'aria-valuemax': max, 'aria-valuenow': value ?? undefined } : {})}
          testID={testID}
          style={inputTextStyle(theme)}
        />
        <Stepper icon={Minus} label={tr('inputs.number.decrease', { label })} disabled={disabled || atMin} onPress={() => bump(-1)} />
        <Stepper icon={Plus} label={tr('inputs.number.increase', { label })} disabled={disabled || atMax} onPress={() => bump(1)} />
      </View>
    </FieldShell>
  );
}

function Stepper({ icon: Icon, label, disabled, onPress }: { icon: LucideIcon; label: string; disabled?: boolean; onPress: () => void }) {
  const theme = useKalamTheme();
  const size = theme.touchTarget - 4;
  return (
    <Pressable
      role="button"
      aria-label={label}
      accessibilityLabel={label}
      aria-disabled={!!disabled}
      accessibilityState={{ disabled: !!disabled }}
      onPress={disabled ? undefined : onPress}
      // Keyboard users have Up and Down in the field, so the steppers are not extra Tab stops.
      {...(Platform.OS === 'web' ? { tabIndex: -1 } : {})}
      {...webData({ kPress: 'scale', kHover: disabled ? 'none' : 'surface' })}
      style={{ width: size, height: size, borderRadius: theme.radius.press, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.4 : 1 }}
    >
      <Icon size={20} color={theme.colors.textSecondary} strokeWidth={2.2} />
    </Pressable>
  );
}
