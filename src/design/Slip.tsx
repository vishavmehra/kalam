import { type ReactNode, useId } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, Pattern, Rect } from 'react-native-svg';

import { useT } from '@/i18n/react';

import { withAlpha } from './color';
import { Text } from './Text';
import { useKalamTheme } from './theme';
import { slipNumber } from './marks';
import type { TintKind } from './tokens';

export { slipNumber };

/**
 * The perforated top edge of an order-book slip: half holes every 18 px in the colour of what is behind
 * the slip. Purely decorative.
 */
export function Perforation({ behind, height = 5 }: { behind?: string; height?: number }) {
  const theme = useKalamTheme();
  const id = `perf${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <View pointerEvents="none" aria-hidden style={{ position: 'absolute', top: 0, start: 0, end: 0, height }}>
      <Svg width="100%" height={height}>
        <Defs>
          <Pattern id={id} x={0} y={0} width={18} height={height} patternUnits="userSpaceOnUse">
            <Circle cx={9} cy={0} r={4.3} fill={behind ?? theme.colors.background} />
          </Pattern>
        </Defs>
        <Rect x={0} y={0} width="100%" height={height} fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

export interface SlipProps {
  /** Step or version number; shown as "No. 01" in Courier Prime, sindoor ink. Omit for an unnumbered slip. */
  number?: number;
  /** Visible number text override (e.g. "No. 0417"). */
  numberLabel?: string;
  title?: string;
  /** Per-role tint. Default `kraft`. */
  tint?: TintKind;
  /** Colour behind the slip, for the perforation holes. Default the page canvas. */
  behind?: string;
  children?: ReactNode;
  /** Bottom artifact (a material tile, a stamp). */
  footer?: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * An order-book slip (DIRECTION §7): tinted per role, 4 px top and 8 px bottom corners, a perforated top, a
 * dashed tear line, a red "No. 01", a Tiro title and Anek body. Only for real sequences and real records:
 * how it works, build history, version history.
 */
export function Slip({ number, numberLabel, title, tint = 'kraft', behind, children, footer, style, testID }: SlipProps) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const no = numberLabel ?? (number !== undefined ? slipNumber(number, 2, t('slip.no')) : undefined);
  return (
    <View
      testID={testID}
      style={[
        {
          backgroundColor: theme.tints[tint],
          borderTopStartRadius: 4, borderTopEndRadius: 4, borderBottomStartRadius: 8, borderBottomEndRadius: 8,
          paddingTop: 26, paddingBottom: 22, paddingHorizontal: theme.compact ? 20 : 26, gap: 12,
          overflow: 'hidden',
          borderWidth: theme.accessModes.highContrast ? 1.5 : 0, borderColor: theme.colors.borderStrong,
        },
        style,
      ]}
    >
      <Perforation behind={behind} />
      <View aria-hidden pointerEvents="none" style={{ position: 'absolute', top: 12, start: 0, end: 0, borderTopWidth: 1.5, borderStyle: 'dashed', borderColor: withAlpha(theme.colors.text, 0.18) }} />
      {no ? <Text mono variant="caption" style={{ color: theme.colors.markInk }}>{no}</Text> : null}
      {title ? <Text variant="h2">{title}</Text> : null}
      {children}
      {footer ? <View style={{ marginTop: 'auto', paddingTop: 8 }}>{footer}</View> : null}
    </View>
  );
}
