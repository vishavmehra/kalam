/**
 * Small building blocks shared by the runtime components. Styled only from the resolved app
 * theme (never Kalam shell components) so generated apps feel like their own product.
 */
import { memo, useRef, type ComponentRef, type ReactNode, type Ref } from 'react';
import {
  Animated, Easing, Platform, Pressable, StyleSheet, Text, View,
  type PressableProps, type StyleProp, type TextStyle, type ViewStyle,
} from 'react-native';
import { useReducedMotion as useShellReducedMotion } from '@/design/theme';
import { fontFamilies, lightColors } from '@/design/tokens';
import type { RuntimeFont } from '@/i18n/runtime-font';
import type { ExecutionBadge } from '../engine/types';
import { ensureContrast, type RuntimeTheme } from '../engine/theme';

export const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
export const NATIVE_DRIVER = Platform.OS !== 'web';

/**
 * The resolved app theme plus the font for the app's own script (`spec.lang`), set by KalamRuntime.
 * ponytail: lives here because engine/theme.ts is owned elsewhere; fold `scriptFont` into RuntimeTheme there later.
 */
export type AppTheme = RuntimeTheme & { scriptFont?: RuntimeFont };

type Weight = '400' | '500' | '600' | '700';
const SCRIPT_WEIGHT = { '400': 'regular', '500': 'medium', '600': 'semibold', '700': 'bold' } as const;

/**
 * Noto family for apps written in an Indic script (docs/10 §12.1). Serif and rounded apps keep their
 * own face and let the platform fall back per glyph. Undefined means "use the normal family".
 */
function scriptFamily(t: RuntimeTheme, weight: Weight): string | undefined {
  const sf = (t as AppTheme).scriptFont;
  if (!sf || sf.script === 'latin' || t.fontFamily === 'serif' || t.fontFamily === 'rounded') return undefined;
  const w = SCRIPT_WEIGHT[weight];
  // Web: Latin letters and digits keep Inter, the script glyphs come from Noto.
  return Platform.OS === 'web' ? sf.cssStack(w, t.fontFamily === 'inter' ? family(t, weight) : undefined) : sf.family(w);
}

function family(t: RuntimeTheme, weight: Weight): string | undefined {
  switch (t.fontFamily) {
    case 'inter':
      return weight === '400' ? fontFamilies.ui : weight === '500' ? fontFamilies.uiMedium : weight === '600' ? fontFamilies.uiSemibold : fontFamilies.uiBold;
    case 'serif':
      // iOS has no generic "serif" family name; Georgia ships with every iPhone.
      return Platform.select({ web: 'Georgia, "Iowan Old Style", "Times New Roman", serif', ios: 'Georgia', default: 'serif' });
    case 'rounded':
      return Platform.OS === 'web' ? 'ui-rounded, "SF Pro Rounded", "Nunito", system-ui, sans-serif' : undefined;
    case 'noto_sans':
      return Platform.select({ web: '"Noto Sans", system-ui, sans-serif', android: 'sans-serif', default: undefined });
    default:
      return undefined;
  }
}

/** Font style scaled by the theme (and Large Mode). Line height ≈ 1.4× for body text. */
export function font(t: RuntimeTheme, size: number, weight: Weight = '400', line = 1.4): TextStyle {
  const fontSize = Math.round(size * t.fontScale);
  const lineHeight = Math.round(fontSize * line);
  const script = scriptFamily(t, weight);
  // Each Noto weight is its own family, so no fontWeight with it (no faux bold).
  return script ? { fontSize, lineHeight, fontFamily: script } : { fontSize, lineHeight, fontFamily: family(t, weight), fontWeight: weight };
}

export const tabular: TextStyle = { fontVariant: ['tabular-nums'] };

/**
 * Reduced motion for generated apps: the person's Kalam setting wins over the OS preference
 * (docs/10 §9.2). Read from the shell context the runtime is mounted in; no styling comes from it.
 */
export function useReducedMotion(): boolean {
  return useShellReducedMotion();
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** Pressable with a subtle 0.97 press scale — feedback that the app heard the tap. */
export const Pressy = memo(function Pressy({
  style, children, disabled, ...rest
}: Omit<PressableProps, 'style' | 'children'> & { style?: StyleProp<ViewStyle>; children: ReactNode; ref?: Ref<ComponentRef<typeof View>> }) {
  const scale = useRef(new Animated.Value(1)).current;
  const to = (v: number, ms: number) =>
    Animated.timing(scale, { toValue: v, duration: ms, easing: EASE_OUT, useNativeDriver: NATIVE_DRIVER }).start();
  // The pressable itself carries the layout style, so flex/width props behave like a plain View.
  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPressIn={(e) => {
        to(0.97, 100);
        rest.onPressIn?.(e);
      }}
      onPressOut={(e) => {
        to(1, 160);
        rest.onPressOut?.(e);
      }}
      style={[style, { transform: [{ scale }] }, disabled && { opacity: 0.5 }]}
    >
      {children}
    </AnimatedPressable>
  );
});

const BADGE: Record<ExecutionBadge, { label: string; color: string }> = {
  on_device: { label: 'On-device', color: lightColors.sourceOnDevice },
  cloud: { label: 'Cloud', color: lightColors.sourceCloud },
  deterministic: { label: 'Deterministic', color: lightColors.sourceDeterministic },
  offline: { label: 'Offline: AI unavailable', color: lightColors.sourceOffline },
};

/**
 * Honest execution-source badge. Always text + colour (never colour alone). Uses Kalam's
 * fixed source colours so "On-device" means the same thing in every app.
 */
export function SourceBadge({ source, t, detail }: { source: ExecutionBadge; t: RuntimeTheme; detail?: string }) {
  const b = BADGE[source];
  const label = detail ? `${b.label} · ${detail}` : b.label;
  return (
    <View
      accessible
      accessibilityLabel={`Ran: ${label}`}
      style={[styles.badge, { borderColor: b.color, backgroundColor: t.colors.surface }]}
    >
      <View style={[styles.dot, { backgroundColor: b.color }]} />
      <Text style={[font(t, 12, '600', 1.3), { color: t.highContrast ? '#000000' : ensureContrast(b.color, t.colors.surface) }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, borderWidth: 1,
    borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
});
