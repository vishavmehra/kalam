import { View, type ViewProps } from 'react-native';

import { useKalamTheme } from './theme';
import type { radius as radiusTokens } from './tokens';

export interface SurfaceProps extends ViewProps {
  /** Background. Default `surface` (a sheet on the ledger paper). */
  tone?: 'surface' | 'alt' | 'paper' | 'primarySoft' | 'accentSoft' | 'elevated';
  /**
   * Cards separate by tone and a soft ink-tinted shadow, not grey outlines (DIRECTION §1). `true` forces a
   * hairline; High Contrast always draws one. Default false.
   */
  bordered?: boolean;
  /** Shadow level 0 to 3. Default 1 for sheet tones, 0 otherwise. */
  elevation?: 0 | 1 | 2 | 3;
  /** Padding in px, or `true` for 20. */
  padded?: boolean | number;
  radius?: keyof typeof radiusTokens;
}

/** Grouping surface for meaningful content (cards, settings groups). Not for every paragraph. */
export function Surface({ tone = 'surface', bordered, elevation, padded, radius = 'lg', style, ...rest }: SurfaceProps) {
  const theme = useKalamTheme();
  const c = theme.colors;
  const bg = { surface: c.surface, alt: c.surfaceAlt, paper: c.paper, primarySoft: c.primarySoft, accentSoft: c.accentSoft, elevated: c.surfaceElevated }[tone];
  const hc = theme.accessModes.highContrast;
  const level = elevation ?? (tone === 'surface' || tone === 'paper' || tone === 'elevated' ? 1 : 0);
  const line = bordered || hc;
  return (
    <View
      style={[
        {
          backgroundColor: bg,
          borderRadius: theme.radius[radius],
          borderWidth: line ? (hc ? 1.5 : 1) : 0,
          borderColor: hc ? c.borderStrong : c.border,
          padding: padded === true ? 20 : typeof padded === 'number' ? padded : 0,
        },
        theme.elevation[level],
        // Ink night: a shadow barely reads, so a sheet gets a hairline of the rule instead.
        theme.scheme === 'dark' && level > 0 && !line ? { borderWidth: 1, borderColor: c.border } : null,
        style,
      ]}
      {...rest}
    />
  );
}
