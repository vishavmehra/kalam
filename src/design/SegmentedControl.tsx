import type { LucideIcon } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { Text } from './Text';
import { useKalamTheme } from './theme';
import { webData } from './web';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
}

export interface SegmentedControlProps<T extends string> {
  /** Accessible name of the radio group (and visible label unless `labelHidden`). */
  label: string;
  labelHidden?: boolean;
  options: ReadonlyArray<SegmentOption<T>>;
  value: T;
  onChange: (value: T) => void;
  /** Wrap onto several rows instead of shrinking labels. */
  wrap?: boolean;
}

/** Single choice among 2–4 options (radio group). Selected = raised surface + weight, not colour alone. */
export function SegmentedControl<T extends string>({ label, labelHidden, options, value, onChange, wrap }: SegmentedControlProps<T>) {
  const theme = useKalamTheme();
  const c = theme.colors;
  return (
    <View style={{ gap: 8, alignSelf: 'stretch' }}>
      {labelHidden ? null : <Text variant="bodySmall" weight="medium" tone="secondary">{label}</Text>}
      <View
        role="radiogroup"
        aria-label={label}
        style={{
          flexDirection: 'row', flexWrap: wrap ? 'wrap' : 'nowrap', gap: 4, padding: 4,
          backgroundColor: c.surfaceAlt, borderRadius: theme.radius.md + 2,
          borderWidth: theme.accessModes.highContrast ? 1 : 0, borderColor: c.border,
          alignSelf: 'flex-start', maxWidth: '100%',
        }}
      >
        {options.map((o) => {
          const selected = o.value === value;
          const Icon = o.icon;
          return (
            <Pressable
              key={o.value}
              role="radio"
              aria-checked={selected}
              accessibilityState={{ checked: selected }}
              onPress={() => onChange(o.value)}
              {...webData({ kPress: '', kHover: selected ? 'none' : 'border' })}
              style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                minHeight: theme.touchTarget, paddingHorizontal: 14,
                flexShrink: 1,
                borderRadius: theme.radius.md,
                backgroundColor: selected ? c.surface : 'transparent',
                borderWidth: 1,
                borderColor: selected ? c.borderStrong : 'transparent',
              }}
            >
              {Icon ? <Icon size={16} color={selected ? c.primary : c.textSecondary} strokeWidth={2} /> : null}
              <Text variant="bodySmall" weight={selected ? 'semibold' : 'medium'} tone={selected ? 'default' : 'secondary'} numberOfLines={1}>
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
