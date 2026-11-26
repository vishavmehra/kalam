import { CircleAlert, CircleCheck, Cloud, LayoutTemplate, type LucideIcon, Smartphone, WifiOff } from 'lucide-react-native';
import { Image, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { withAlpha } from './color';
import { Text } from './Text';
import { useKalamTheme } from './theme';
import type { StampKind } from './tokens';

export interface StampProps {
  kind: StampKind;
  /** Visible words. Stamps always carry words, never colour alone. */
  label: string;
  /** Default icon per kind; pass `null` for none. */
  icon?: LucideIcon | null;
  /** `md` 28 px (default), `sm` 24 px. */
  size?: 'sm' | 'md';
  /** Wash behind the ink. Defaults to the kind's own wash; route stamps on a field use the sheet. */
  wash?: string;
  /** Dense tables: show only the icon; the label stays the accessible name. */
  iconOnly?: boolean;
  /** Screen-reader text when it should say more than the label. */
  accessibilityLabel?: string;
  testID?: string;
}

const ICON: Record<StampKind, LucideIcon | null> = {
  template: LayoutTemplate,
  device: Smartphone,
  cloud: Cloud,
  checked: CircleCheck,
  needs: CircleAlert,
  plain: null,
};

/**
 * A rubber-stamp impression (DIRECTION §7): a rectangle with a double rule in ink colour on its wash. Used for
 * where AI ran and for checks: Template, On device, Cloud, Checked, Needs check. 6 px corners.
 */
export function Stamp({ kind, label, icon, size = 'md', wash, iconOnly, accessibilityLabel, testID }: StampProps) {
  const theme = useKalamTheme();
  const s = theme.stamps[kind];
  const bg = wash ?? s.wash;
  const Icon = icon === undefined ? ICON[kind] : icon;
  const h = Math.round((size === 'sm' ? 24 : 28) * Math.min(theme.fontScale, 1.35));
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={accessibilityLabel ?? label}
      role={iconOnly ? 'img' : undefined}
      style={{
        alignSelf: 'flex-start', minHeight: h, padding: 1.5,
        borderRadius: theme.radius.stamp, borderWidth: 1.5, borderColor: s.ink, backgroundColor: bg,
      }}
    >
      <View
        style={{
          flex: 1, flexDirection: 'row', alignItems: 'center', gap: 5,
          paddingStart: size === 'sm' ? 5 : 6, paddingEnd: size === 'sm' ? 6 : 7,
          borderRadius: theme.radius.stamp - 2, borderWidth: 0.75, borderColor: withAlpha(s.ink, 0.55),
        }}
      >
        {Icon ? <Icon size={size === 'sm' ? 13 : 15} color={s.ink} strokeWidth={2.2} /> : null}
        {iconOnly ? null : <Text
          variant={size === 'sm' ? 'caption' : 'bodySmall'}
          weight="semibold"
          numberOfLines={1}
          style={{ color: s.ink, fontSize: Math.round((size === 'sm' ? 12 : 13) * theme.fontScale), lineHeight: Math.round((size === 'sm' ? 15 : 17) * theme.fontScale) }}
        >
          {label}
        </Text>}
      </View>
    </View>
  );
}

/** Offline is normal: a graphite stamp with the wifi-off icon, never a warning. */
export const OfflineIcon = WifiOff;

export interface CheckedImpressionProps {
  /** "Checked" or "Needs check", in the UI language. */
  label: string;
  /** Short date line, e.g. "25 NOV 2026". */
  date?: string;
  needsCheck?: boolean;
  width?: number;
}

/** A real rubber-stamp frame with ink density (generated, assets/images/brand/SOURCES.txt), tinted per verdict. */
const STAMP_FRAME = require('../../assets/images/brand/stamp-rect.webp');
const FRAME_RATIO = 573 / 900;

/**
 * The big impression that lands at the end of a build (DIRECTION §4, §6): a double-ruled stamp frame with real
 * ink density, a tick or an alert, the verdict and a date line, tilted like a real stamp. Decorative copy of a
 * state that is also said in words nearby, so it is hidden from screen readers.
 */
export function CheckedImpression({ label, date, needsCheck, width = 200 }: CheckedImpressionProps) {
  const theme = useKalamTheme();
  const ink = needsCheck ? theme.stamps.needs.ink : theme.stamps.checked.ink;
  const height = Math.round(width * FRAME_RATIO);
  const k = width / 200;
  return (
    <View aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width, height }}>
      <Image source={STAMP_FRAME} resizeMode="contain" aria-hidden style={{ position: 'absolute', width, height, tintColor: ink }} />
      {/* The frame is pressed at about -4°; the words follow it. */}
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 * k, paddingHorizontal: 22 * k, transform: [{ rotate: '-4deg' }] }}>
        <Svg width={30 * k} height={30 * k} viewBox="0 0 30 30">
          {needsCheck ? (
            <Path d="M15 5v13M15 24v1" fill="none" stroke={ink} strokeWidth={4.5} strokeLinecap="round" />
          ) : (
            <Path d="M4 15l7 7 15-16" fill="none" stroke={ink} strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" />
          )}
        </Svg>
        <View style={{ flexShrink: 1 }}>
          <Text weight="bold" numberOfLines={1} style={{ color: ink, fontSize: Math.round((label.length > 9 ? 20 : 26) * k), lineHeight: Math.round((label.length > 9 ? 24 : 30) * k) }}>
            {label}
          </Text>
          {date ? <Text mono numberOfLines={1} style={{ color: ink, fontSize: Math.round(12 * k), lineHeight: Math.round(15 * k), letterSpacing: 1 }}>{date}</Text> : null}
        </View>
      </View>
    </View>
  );
}
