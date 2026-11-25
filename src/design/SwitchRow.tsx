import { Check, type LucideIcon } from 'lucide-react-native';
import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { Text } from './Text';
import { useKalamTheme } from './theme';
import { webData } from './web';

export interface SwitchRowProps {
  label: string;
  /** Short plain-language explanation of what changes. */
  description?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  icon?: LucideIcon;
  testID?: string;
}

/**
 * A settings row that toggles on press anywhere. One focus stop (role switch); the thumb shows a
 * check when on so the state is not conveyed by colour alone.
 */
export function SwitchRow({ label, description, value, onValueChange, disabled, icon: Icon, testID }: SwitchRowProps) {
  const theme = useKalamTheme();
  const c = theme.colors;
  const x = useSharedValue(value ? 1 : 0);
  useEffect(() => {
    x.value = theme.reducedMotion ? (value ? 1 : 0) : withTiming(value ? 1 : 0, { duration: 160 });
  }, [value, theme.reducedMotion, x]);
  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: x.value * 18 }] }));

  return (
    <Pressable
      role="switch"
      aria-checked={value}
      aria-disabled={!!disabled}
      accessibilityState={{ checked: value, disabled: !!disabled }}
      accessibilityLabel={label}
      accessibilityHint={description}
      onPress={disabled ? undefined : () => onValueChange(!value)}
      testID={testID}
      {...webData({ kHover: disabled ? 'none' : 'surface' })}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 14,
        minHeight: theme.touchTarget + 8, paddingVertical: 12, paddingHorizontal: 12, marginHorizontal: -12,
        borderRadius: theme.radius.md,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {Icon ? <Icon size={20} color={c.textSecondary} strokeWidth={2} /> : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text weight="medium">{label}</Text>
        {description ? <Text variant="bodySmall" tone="secondary">{description}</Text> : null}
      </View>
      <View
        style={{
          width: 46, height: 28, borderRadius: 14, padding: 3,
          backgroundColor: value ? c.primary : c.surfaceAlt,
          borderWidth: 1, borderColor: value ? c.primary : c.borderStrong,
          justifyContent: 'center',
        }}
      >
        <Animated.View
          style={[{ width: 20, height: 20, borderRadius: 10, backgroundColor: value ? c.onPrimary : c.surface, alignItems: 'center', justifyContent: 'center', borderWidth: value ? 0 : 1, borderColor: c.borderStrong }, thumb]}
        >
          {value ? <Check size={12} color={c.primary} strokeWidth={3} /> : null}
        </Animated.View>
      </View>
    </Pressable>
  );
}
