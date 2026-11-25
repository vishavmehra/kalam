import type { LucideIcon } from 'lucide-react-native';
import type { ComponentRef, ReactNode } from 'react';
import { ActivityIndicator, Pressable, type StyleProp, type ViewStyle } from 'react-native';

import { Text } from './Text';
import { type KalamTheme, useKalamTheme } from './theme';
import { webData } from './web';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  /** Visible label; also the accessible name. Say what happens ("Save changes", not "Submit"). */
  label: string;
  onPress?: () => void;
  /** Default `primary`. Use one primary per section (docs/02 §10.1). */
  variant?: ButtonVariant;
  /** `sm` 44px, `md` 48px (64 in Large mode), `lg` 56px. */
  size?: ButtonSize;
  icon?: LucideIcon;
  iconPosition?: 'start' | 'end';
  /** Shows a spinner and blocks presses (prevents duplicate submissions). */
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

interface VariantStyle { bg: string; fg: string; border: string; hover: string }

function variantStyle(theme: KalamTheme, variant: ButtonVariant): VariantStyle {
  const c = theme.colors;
  switch (variant) {
    case 'primary': return { bg: c.primary, fg: c.onPrimary, border: c.primary, hover: 'primary' };
    case 'secondary': return { bg: c.primarySoft, fg: c.primary, border: c.primarySoft, hover: 'border' };
    case 'outline': return { bg: 'transparent', fg: c.text, border: c.borderStrong, hover: 'surface' };
    case 'ghost': return { bg: 'transparent', fg: c.text, border: 'transparent', hover: 'surface' };
    case 'destructive': return { bg: c.danger, fg: theme.scheme === 'dark' ? '#1A0F0F' : '#FFFFFF', border: c.danger, hover: 'danger' };
    case 'link': return { bg: 'transparent', fg: c.primary, border: 'transparent', hover: 'link' };
  }
}

const HEIGHT: Record<ButtonSize, number> = { sm: 44, md: 48, lg: 56 };

/** Kalam button with primary/secondary/outline/ghost/destructive/link variants and loading state. */
export function Button({
  label, onPress, variant = 'primary', size = 'md', icon: Icon, iconPosition = 'start', loading, disabled,
  fullWidth, accessibilityHint, style, testID,
}: ButtonProps) {
  const theme = useKalamTheme();
  const v = variantStyle(theme, variant);
  const inactive = disabled || loading;
  const height = Math.max(HEIGHT[size], size === 'md' ? theme.touchTarget : 0);
  const iconSize = size === 'lg' ? 20 : 18;
  const iconNode = loading
    ? <ActivityIndicator size="small" color={v.fg} />
    : Icon ? <Icon size={iconSize} color={v.fg} strokeWidth={2} /> : null;

  return (
    <Pressable
      onPress={inactive ? undefined : onPress}
      role="button"
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      aria-disabled={!!inactive}
      accessibilityHint={accessibilityHint}
      testID={testID}
      {...webData({ kPress: '', kHover: inactive ? 'none' : v.hover })}
      style={({ pressed }) => [
        {
          minHeight: height,
          paddingHorizontal: variant === 'link' ? 4 : size === 'sm' ? 14 : 20,
          borderRadius: theme.radius.md,
          backgroundColor: pressed && variant === 'primary' ? theme.colors.primaryPressed : v.bg,
          borderWidth: variant === 'link' ? 0 : 1,
          borderColor: v.border,
          flexDirection: iconPosition === 'end' ? 'row-reverse' : 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          opacity: disabled ? 0.48 : 1,
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
        },
        style,
      ]}
    >
      {iconNode}
      <Text
        variant={size === 'lg' ? 'bodyLarge' : 'body'}
        weight="semibold"
        numberOfLines={2}
        style={{ color: v.fg, textDecorationLine: variant === 'link' ? 'underline' : 'none' }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export interface IconButtonProps {
  icon: LucideIcon;
  /** Accessible name — required because the button has no visible text. */
  label: string;
  onPress?: () => void;
  variant?: 'ghost' | 'outline' | 'secondary' | 'primary';
  /** Visual diameter; the hit area is always ≥ the theme touch target. */
  size?: number;
  disabled?: boolean;
  /** Toggle buttons: exposes aria-pressed. */
  selected?: boolean;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  /** Receives the host view (e.g. to measure a menu anchor). */
  onRef?: (v: ComponentRef<typeof Pressable> | null) => void;
}

/** Square icon-only button with an accessible label and 48px minimum hit area. */
export function IconButton({
  icon: Icon, label, onPress, variant = 'ghost', size, disabled, selected, style, testID, onRef,
}: IconButtonProps) {
  const theme = useKalamTheme();
  const v = variantStyle(theme, variant);
  const dim = Math.max(size ?? theme.touchTarget, theme.touchTarget);
  return (
    <Pressable
      ref={onRef}
      onPress={disabled ? undefined : onPress}
      role="button"
      aria-label={label}
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, selected }}
      aria-pressed={selected}
      aria-disabled={!!disabled}
      testID={testID}
      {...webData({ kPress: '', kHover: disabled ? 'none' : v.hover })}
      style={({ pressed }) => [
        {
          width: dim,
          height: dim,
          borderRadius: theme.radius.md,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: selected ? theme.colors.primarySoft : pressed && variant === 'ghost' ? theme.colors.surfaceAlt : v.bg,
          borderWidth: variant === 'outline' ? 1 : 0,
          borderColor: v.border,
          opacity: disabled ? 0.48 : 1,
        },
        style,
      ]}
    >
      <Icon size={20} color={selected ? theme.colors.primary : v.fg} strokeWidth={2} />
    </Pressable>
  );
}
