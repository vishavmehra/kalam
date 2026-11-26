import type { LucideIcon } from 'lucide-react-native';
import type { ComponentRef, ReactNode } from 'react';
import { ActivityIndicator, Pressable, type StyleProp, type ViewStyle } from 'react-native';

import { Text } from './Text';
import { type KalamTheme, useKalamTheme } from './theme';
import { webData } from './web';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  /** Visible label; also the accessible name. Say what happens ("Build app", not "Submit"). */
  label: string;
  onPress?: () => void;
  /** Default `primary`. One primary per section. */
  variant?: ButtonVariant;
  /** `sm` and `md` 48 px (sm has tighter padding), `lg` 54 px. Every size grows to 64 px in Large mode. */
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

interface VariantStyle { bg: string; fg: string; ring: string | null; ringWidth: number; hover: string }

/**
 * DIRECTION §7: primary is the action colour (royal on Paper, a paper slip on Ink night); quiet buttons are
 * transparent with a 1.5 px ring; destructive is danger text on its wash, never a solid red fill.
 */
function variantStyle(theme: KalamTheme, variant: ButtonVariant): VariantStyle {
  const c = theme.colors;
  const hc = theme.accessModes.highContrast;
  switch (variant) {
    case 'primary': return { bg: c.actionBg, fg: c.actionFg, ring: hc ? c.borderStrong : null, ringWidth: 2, hover: 'action' };
    case 'secondary': return { bg: c.primarySoft, fg: c.primary, ring: hc ? c.primary : null, ringWidth: 1.5, hover: 'border' };
    case 'outline': return { bg: 'transparent', fg: c.text, ring: c.borderStrong, ringWidth: 1.5, hover: 'surface' };
    case 'ghost': return { bg: 'transparent', fg: c.text, ring: null, ringWidth: 0, hover: 'surface' };
    case 'destructive': return { bg: c.dangerSoft, fg: c.danger, ring: hc ? c.danger : null, ringWidth: 1.5, hover: 'danger' };
    case 'link': return { bg: 'transparent', fg: c.primary, ring: null, ringWidth: 0, hover: 'link' };
  }
}

const HEIGHT: Record<ButtonSize, number> = { sm: 48, md: 48, lg: 54 };

/** Kalam button: primary, secondary, outline (quiet), ghost, destructive and link, with a loading state. */
export function Button({
  label, onPress, variant = 'primary', size = 'md', icon: Icon, iconPosition = 'start', loading, disabled,
  fullWidth, accessibilityHint, style, testID,
}: ButtonProps) {
  const theme = useKalamTheme();
  const v = variantStyle(theme, variant);
  const inactive = disabled || loading;
  const height = Math.max(HEIGHT[size], theme.touchTarget);
  const iconSize = size === 'lg' ? 19 : 18;
  const iconNode = loading
    ? <ActivityIndicator size="small" color={v.fg} />
    : Icon ? <Icon size={iconSize} color={v.fg} strokeWidth={2} /> : null;
  const sinks = variant === 'primary' || variant === 'secondary' || variant === 'destructive';

  return (
    <Pressable
      onPress={inactive ? undefined : onPress}
      role="button"
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      aria-disabled={!!inactive}
      accessibilityHint={accessibilityHint}
      testID={testID}
      {...webData(inactive ? { kPress: '', kHover: 'none' } : sinks ? { kPress: '', kHover: v.hover, kSink: '' } : { kPress: '', kHover: v.hover })}
      style={({ pressed }) => [
        {
          minHeight: height,
          paddingHorizontal: variant === 'link' ? 4 : size === 'sm' ? 14 : size === 'lg' ? 24 : 20,
          borderRadius: theme.radius.press,
          backgroundColor: pressed && variant === 'primary' ? theme.colors.actionBgPressed : v.bg,
          borderWidth: v.ring ? v.ringWidth : 0,
          borderColor: v.ring ?? 'transparent',
          flexDirection: iconPosition === 'end' ? 'row-reverse' : 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          opacity: disabled ? 0.48 : 1,
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
          transform: pressed && !theme.reducedMotion ? [{ translateY: 1 }] : undefined,
        },
        variant === 'primary' && !inactive && theme.scheme === 'light' ? theme.elevation[1] : null,
        style,
      ]}
    >
      {iconNode}
      <Text
        variant={size === 'lg' ? 'bodyLarge' : 'body'}
        weight="semibold"
        numberOfLines={2}
        style={{
          color: v.fg,
          textDecorationLine: variant === 'link' ? 'underline' : 'none',
          ...(size === 'lg' ? { fontSize: Math.round(17 * theme.fontScale), lineHeight: Math.round(24 * theme.fontScale) } : null),
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export interface IconButtonProps {
  icon: LucideIcon;
  /** Accessible name, required because the button has no visible text. */
  label: string;
  onPress?: () => void;
  variant?: 'ghost' | 'outline' | 'secondary' | 'primary';
  /** Visual size; the hit area is always at least the theme touch target. */
  size?: number;
  disabled?: boolean;
  /** Toggle buttons: exposes aria-pressed. */
  selected?: boolean;
  /** Icon colour override (e.g. on the ink field). */
  color?: string;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  /** Receives the host view (e.g. to measure a menu anchor). */
  onRef?: (v: ComponentRef<typeof Pressable> | null) => void;
}

/** Square icon-only button with an accessible label and a 48 px minimum hit area (64 in Large mode). */
export function IconButton({
  icon: Icon, label, onPress, variant = 'ghost', size, disabled, selected, color, style, testID, onRef,
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
      {...webData({ kPress: 'scale', kHover: disabled ? 'none' : v.hover })}
      style={({ pressed }) => [
        {
          width: dim,
          height: dim,
          borderRadius: theme.radius.press,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: selected ? theme.colors.primarySoft : pressed && variant === 'ghost' ? theme.colors.surfaceAlt : v.bg,
          borderWidth: v.ring ? v.ringWidth : 0,
          borderColor: v.ring ?? 'transparent',
          opacity: disabled ? 0.48 : 1,
        },
        style,
      ]}
    >
      <Icon size={20} color={color ?? (selected ? theme.colors.primary : variant === 'ghost' ? theme.colors.textSecondary : v.fg)} strokeWidth={2} />
    </Pressable>
  );
}
