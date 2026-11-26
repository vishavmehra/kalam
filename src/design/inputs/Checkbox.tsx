import { Check, Minus } from 'lucide-react-native';
import { useId } from 'react';
import { Pressable, View } from 'react-native';

import { Text } from '../Text';
import { useKalamTheme } from '../theme';
import { webData } from '../web';
import { FieldMessage, spaceToggles } from './shared';

export interface CheckboxProps {
  /** Visible label; also the accessible name. */
  label: string;
  /** Short plain-language explanation under the label. */
  description?: string;
  /** `'mixed'` is the parent of a partly ticked group; a press ticks it. */
  checked: boolean | 'mixed';
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Validation message; also marks the box invalid. */
  error?: string;
  testID?: string;
}

/**
 * Checkbox row: the whole row toggles (48 px minimum). Ticked shows a check and mixed a dash, so the state is
 * never colour alone. Space and Enter toggle on the web.
 */
export function Checkbox({ label, description, checked, onChange, disabled, error, testID }: CheckboxProps) {
  const theme = useKalamTheme();
  const c = theme.colors;
  const id = useId();
  const mixed = checked === 'mixed';
  const filled = mixed || checked === true;
  const toggle = () => { if (!disabled) onChange(mixed ? true : !checked); };
  const Mark = mixed ? Minus : Check;
  return (
    <View style={{ alignSelf: 'stretch' }}>
      <Pressable
        role="checkbox"
        aria-checked={mixed ? 'mixed' : checked}
        aria-disabled={!!disabled}
        aria-invalid={!!error}
        aria-describedby={error || description ? `${id}-desc` : undefined}
        accessibilityState={{ checked: mixed ? 'mixed' : checked, disabled: !!disabled }}
        accessibilityLabel={label}
        accessibilityHint={description}
        onPress={toggle}
        testID={testID}
        {...spaceToggles(toggle)}
        {...webData({ kPress: '', kHover: disabled ? 'none' : 'surface' })}
        style={{
          flexDirection: 'row', alignItems: 'flex-start', gap: 14,
          minHeight: theme.touchTarget, paddingVertical: 12, paddingHorizontal: 12, marginHorizontal: -12,
          borderRadius: theme.radius.md,
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <View
          style={{
            width: 24, height: 24, borderRadius: theme.radius.sm, borderWidth: 2, marginTop: 1,
            alignItems: 'center', justifyContent: 'center',
            borderColor: filled ? c.primary : error ? c.danger : c.borderStrong,
            backgroundColor: filled ? c.primary : c.surfaceElevated,
          }}
        >
          {filled ? <Mark size={16} color={c.onPrimary} strokeWidth={3} /> : null}
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text weight="medium">{label}</Text>
          {description ? <Text nativeID={error ? undefined : `${id}-desc`} variant="bodySmall" tone="secondary">{description}</Text> : null}
        </View>
      </Pressable>
      {error ? <FieldMessage id={`${id}-desc`} error={error} theme={theme} /> : null}
    </View>
  );
}
