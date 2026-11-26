import { useId } from 'react';
import { Pressable, View } from 'react-native';

import { Text } from '../Text';
import { useKalamTheme } from '../theme';
import { webData } from '../web';
import { useRovingFocus } from './roving';
import { FieldShell } from './shared';

export interface RadioOption<T extends string> {
  value: T;
  label: string;
  /** Short plain-language explanation under the label. */
  description?: string;
  disabled?: boolean;
}

export interface RadioGroupProps<T extends string> {
  /** Name of the group (and visible heading unless `labelHidden`). */
  label: string;
  labelHidden?: boolean;
  options: ReadonlyArray<RadioOption<T>>;
  value: T | null;
  onChange: (value: T) => void;
  helper?: string;
  /** Validation message; also marks the group invalid. */
  error?: string;
  disabled?: boolean;
  /** Layout only: arrow keys move through the options either way. */
  direction?: 'column' | 'row';
  testID?: string;
}

/**
 * Single choice among a few options, one per row. For two to four short options in a pill row use
 * SegmentedControl. On the web one Tab stop enters the group and the arrow keys move and select (WAI-ARIA radio
 * group); Space selects the focused option.
 */
export function RadioGroup<T extends string>({
  label, labelHidden, options, value, onChange, helper, error, disabled, direction = 'column', testID,
}: RadioGroupProps<T>) {
  const theme = useKalamTheme();
  const c = theme.colors;
  const id = useId();
  const isOff = (i: number) => !!disabled || !!options[i]?.disabled;
  const selected = options.findIndex((o) => o.value === value);
  const stop = selected >= 0 && !isOff(selected) ? selected : options.findIndex((_, i) => !isOff(i));
  // Arrow keys move and select; Space selects the focused option. One handler owns onKeyDown (see roving.ts).
  const select = (i: number) => { const o = options[i]; if (o && !isOff(i)) onChange(o.value); };
  const roving = useRovingFocus({
    count: options.length, orientation: 'both', current: stop, isDisabled: isOff, onMove: select, onActivate: select,
  });

  return (
    <FieldShell id={id} label={label} labelHidden={labelHidden} helper={helper} error={error} theme={theme}>
      <View
        role="radiogroup"
        aria-label={label}
        aria-labelledby={labelHidden ? undefined : `${id}-label`}
        aria-invalid={!!error}
        aria-describedby={error || helper ? `${id}-desc` : undefined}
        testID={testID}
        style={{ flexDirection: direction, flexWrap: direction === 'row' ? 'wrap' : 'nowrap', columnGap: 16 }}
      >
        {options.map((o, i) => {
          const on = i === selected;
          const off = isOff(i);
          const pick = () => { if (!off) onChange(o.value); };
          return (
            <Pressable
              key={o.value}
              role="radio"
              aria-checked={on}
              aria-disabled={off}
              accessibilityState={{ checked: on, disabled: off }}
              accessibilityLabel={o.label}
              accessibilityHint={o.description}
              onPress={pick}
              {...roving.itemProps(i)}
              {...webData({ kPress: '', kHover: off ? 'none' : 'surface' })}
              style={{
                flexDirection: 'row', alignItems: 'flex-start', gap: 14,
                minHeight: theme.touchTarget, paddingVertical: 12, paddingHorizontal: 12,
                marginHorizontal: direction === 'column' ? -12 : 0,
                borderRadius: theme.radius.md,
                opacity: off ? 0.5 : 1,
              }}
            >
              <View
                style={{
                  width: 24, height: 24, borderRadius: 12, borderWidth: 2, marginTop: 1,
                  alignItems: 'center', justifyContent: 'center',
                  borderColor: on ? c.primary : error ? c.danger : c.borderStrong,
                  backgroundColor: c.surfaceElevated,
                }}
              >
                {/* The dot (a shape) carries the state, not the colour. */}
                {on ? <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: c.primary }} /> : null}
              </View>
              <View style={{ flexShrink: 1, gap: 2 }}>
                <Text weight={on ? 'semibold' : 'medium'}>{o.label}</Text>
                {o.description ? <Text variant="bodySmall" tone="secondary">{o.description}</Text> : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    </FieldShell>
  );
}
