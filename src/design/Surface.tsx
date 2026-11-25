import { View, type ViewProps } from 'react-native';

import { useKalamTheme } from './theme';
import type { radius as radiusTokens } from './tokens';

export interface SurfaceProps extends ViewProps {
  /** Background. Default `surface` (white card on paper). */
  tone?: 'surface' | 'alt' | 'paper' | 'primarySoft' | 'accentSoft' | 'elevated';
  /** 1px hairline border. Default true. */
  bordered?: boolean;
  /** Shadow level 0–3 (docs/02 §8.3). Default 0 — prefer borders. */
  elevation?: 0 | 1 | 2 | 3;
  /** Padding in px, or `true` for 16/20 responsive default. */
  padded?: boolean | number;
  radius?: keyof typeof radiusTokens;
}

/** Grouping surface for meaningful content (cards, settings groups). Not for every paragraph. */
export function Surface({ tone = 'surface', bordered = true, elevation = 0, padded, radius = 'lg', style, ...rest }: SurfaceProps) {
  const theme = useKalamTheme();
  const c = theme.colors;
  const bg = { surface: c.surface, alt: c.surfaceAlt, paper: c.paper, primarySoft: c.primarySoft, accentSoft: c.accentSoft, elevated: c.surfaceElevated }[tone];
  return (
    <View
      style={[
        {
          backgroundColor: bg,
          borderRadius: theme.radius[radius],
          borderWidth: bordered ? 1 : 0,
          borderColor: c.border,
          padding: padded === true ? 20 : typeof padded === 'number' ? padded : 0,
        },
        theme.scheme === 'light' ? theme.elevation[elevation] : null,
        style,
      ]}
      {...rest}
    />
  );
}
