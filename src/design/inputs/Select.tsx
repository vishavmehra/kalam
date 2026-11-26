/** Phones: a labelled field that opens a sheet of options. The web build (Select.web.tsx) uses the browser's own select. */
import { Check, ChevronDown } from 'lucide-react-native';
import { useId, useState } from 'react';
import { Pressable, View } from 'react-native';

import { useT } from '@/i18n/react';

import { Sheet } from '../Sheet';
import { Text } from '../Text';
import { useKalamTheme } from '../theme';
import { webData } from '../web';
import { FieldShell, frameStyle } from './shared';

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  disabled?: boolean;
}

export interface SelectProps<T extends string = string> {
  /** Visible label (placeholders never replace labels, docs/02 §10.2). */
  label: string;
  /** Visually hide the label; it stays the accessible name. */
  labelHidden?: boolean;
  options: ReadonlyArray<SelectOption<T>>;
  /** Selected value, or null for none yet. */
  value: T | null;
  onChange: (value: T) => void;
  /** Shown while nothing is selected. Default: "Choose one". */
  placeholder?: string;
  helper?: string;
  /** Validation message; also marks the field invalid. */
  error?: string;
  disabled?: boolean;
  testID?: string;
}

/** Pick one of many options. Selected row shows a check as well as its weight. */
export function Select<T extends string>({
  label, labelHidden, options, value, onChange, placeholder, helper, error, disabled, testID,
}: SelectProps<T>) {
  const theme = useKalamTheme();
  const c = theme.colors;
  const tr = useT(theme.uiLanguage);
  const id = useId();
  const [open, setOpen] = useState(false);
  const picked = options.find((o) => o.value === value);
  const shown = picked?.label ?? placeholder ?? tr('inputs.select.placeholder');
  return (
    <FieldShell id={id} label={label} labelHidden={labelHidden} helper={helper} error={error} theme={theme}>
      <Pressable
        role="combobox"
        aria-expanded={open}
        aria-disabled={!!disabled}
        aria-invalid={!!error}
        accessibilityState={{ expanded: open, disabled: !!disabled }}
        accessibilityLabel={`${label}: ${shown}`}
        onPress={disabled ? undefined : () => setOpen(true)}
        testID={testID}
        {...webData({ kPress: '', kHover: disabled ? 'none' : 'border' })}
        style={frameStyle(theme, { error: !!error, disabled })}
      >
        <Text numberOfLines={1} tone={picked ? 'default' : 'muted'} style={{ flex: 1 }}>{shown}</Text>
        <ChevronDown size={18} color={c.textSecondary} strokeWidth={2} />
      </Pressable>
      <Sheet visible={open} onClose={() => setOpen(false)} title={tr('inputs.select.choose', { label })}>
        <View role="list" aria-label={label} style={{ marginHorizontal: -12, paddingBottom: 16 }}>
          {options.map((o) => {
            const on = o.value === value;
            return (
              <Pressable
                key={o.value}
                role="option"
                aria-selected={on}
                aria-disabled={!!o.disabled}
                accessibilityState={{ selected: on, disabled: !!o.disabled }}
                accessibilityLabel={o.label}
                onPress={o.disabled ? undefined : () => { setOpen(false); onChange(o.value); }}
                {...webData({ kHover: o.disabled ? 'none' : 'surface' })}
                style={{
                  minHeight: theme.touchTarget, flexDirection: 'row', alignItems: 'center', gap: 12,
                  paddingHorizontal: 12, borderRadius: theme.radius.md, opacity: o.disabled ? 0.5 : 1,
                  backgroundColor: on ? c.primarySoft : 'transparent',
                }}
              >
                <Text weight={on ? 'semibold' : 'medium'} style={{ flex: 1 }}>{o.label}</Text>
                {on ? <Check size={18} color={c.primary} strokeWidth={2.5} /> : null}
              </Pressable>
            );
          })}
        </View>
      </Sheet>
    </FieldShell>
  );
}
