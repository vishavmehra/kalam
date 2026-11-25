/**
 * What a chart needs from its surroundings. The Kalam shell fills it from the design system;
 * a generated app fills it from its own resolved theme (see ChartBlock), so charts inside an app
 * look like the app, not like Kalam.
 */
import type { TextStyle } from 'react-native';

import { fontFamily, typeScale, type TypeVariant, useKalamTheme } from '@/design';
import type { FontWeightName } from '@/design';

export interface ChartStyle {
  colors: {
    text: string;
    muted: string;
    /** Grid lines, bar tracks and table rules. */
    grid: string;
    /** Behind the marks; also the 2px gap between donut slices. */
    surface: string;
    /** The one series colour. */
    mark: string;
  };
  text: { small: TextStyle; body: TextStyle; strong: TextStyle };
  /** Minimum touch target (48, or 64 in Large mode). */
  target: number;
  radius: number;
}

/** Chart style from the Kalam shell theme (Large mode scales the text). */
export function useShellChartStyle(): ChartStyle {
  const theme = useKalamTheme();
  const type = (v: TypeVariant, w: FontWeightName): TextStyle => ({
    fontSize: Math.round(typeScale[v].size * theme.fontScale),
    lineHeight: Math.round(typeScale[v].line * theme.fontScale),
    fontFamily: fontFamily(w),
  });
  return {
    colors: { text: theme.colors.text, muted: theme.colors.textSecondary, grid: theme.colors.border, surface: theme.colors.surface, mark: theme.colors.primary },
    text: { small: type('caption', 'medium'), body: type('bodySmall', 'regular'), strong: type('body', 'semibold') },
    target: theme.touchTarget,
    radius: theme.radius.md,
  };
}
