import type { ReactNode } from 'react';
import { Image, type ImageSourcePropType, Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import { withAlpha } from './color';
import { Text } from './Text';
import { useKalamTheme } from './theme';
import { type ClothKind, clothLabel, cloths } from './tokens';
import { webData } from './web';

/** Generated cloth photographs (assets/images/brand/SOURCES.txt, synthetic). Each loads only when a cover uses it. */
const CLOTH_TEXTURE: Record<ClothKind, ImageSourcePropType> = {
  green: require('../../assets/images/brand/cloth-green.webp'),
  lal: require('../../assets/images/brand/cloth-red.webp'),
  neel: require('../../assets/images/brand/cloth-blue.webp'),
  kraft: require('../../assets/images/brand/cloth-brown.webp'),
  haldi: require('../../assets/images/brand/cloth-haldi.webp'),
  ocean: require('../../assets/images/brand/cloth-teal.webp'),
};

export interface RegisterProps {
  /** Cover cloth, matching the app's KalamSpec theme. */
  cloth: ClothKind;
  /** App name in its own script, on the white label. */
  name: string;
  /** BCP 47 language of `name`, so it is pronounced right. */
  lang?: string;
  /** English name under it, when the name is in another script. */
  subtitle?: string;
  /** Courier Prime stats line on the label, e.g. "42 entries". */
  stat?: string;
  /** Stamps and the "Opens offline" note, at the foot of the cover. */
  footer?: ReactNode;
  /** The yellow cord of a lal bahi khata. */
  cord?: boolean;
  /** Cover height; registers on a shelf vary a little. */
  height?: number;
  onPress?: () => void;
  /** Accessible name for the pressable cover (defaults to the name). */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * A cloth-bound register (DIRECTION §6, §7): every app on the shelf. Spine shadow with dashed stitching on
 * the left, a white name label with a double rule in the cloth colour, stats in Courier Prime. Hover lifts a
 * cover 8 px; press sinks it. Name text never sits on the cloth itself.
 */
export function Register({ cloth, name, lang, subtitle, stat, footer, cord, height = 380, onPress, accessibilityLabel, style, testID }: RegisterProps) {
  const theme = useKalamTheme();
  const cl = cloths[cloth];
  const body = (
    <>
      {/* The woven cloth over the token colour; High Contrast keeps the flat cloth. */}
      {theme.accessModes.highContrast ? null : (
        <Image
          source={CLOTH_TEXTURE[cloth]}
          resizeMode="cover"
          aria-hidden
          accessibilityIgnoresInvertColors
          style={{ position: 'absolute', top: 0, start: 0, end: 0, bottom: 0, width: '100%', height: '100%', opacity: 0.55, borderTopStartRadius: 4, borderBottomStartRadius: 4, borderTopEndRadius: 9, borderBottomEndRadius: 9 }}
        />
      )}
      {/* Spine: a darker band and its stitching. */}
      <View aria-hidden pointerEvents="none" style={{ position: 'absolute', start: 0, top: 0, bottom: 0, width: '9%', backgroundColor: 'rgba(0,0,0,0.22)', borderTopStartRadius: 4, borderBottomStartRadius: 4 }} />
      <View aria-hidden pointerEvents="none" style={{ position: 'absolute', start: 9, top: 10, bottom: 10, borderStartWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.35)' }} />
      {cord ? (
        <View aria-hidden pointerEvents="none" style={{ position: 'absolute', end: 26, top: -6, height: '62%', width: 5, borderRadius: 3, backgroundColor: '#F2A541', transform: [{ rotate: '9deg' }] }} />
      ) : null}
      <View
        style={{
          marginTop: '18%', backgroundColor: clothLabel.bg, borderRadius: 7, padding: 3,
          borderWidth: 2, borderColor: cl.cloth,
        }}
      >
        <View style={{ borderWidth: 1, borderColor: cl.cloth, borderRadius: 5, paddingTop: 11, paddingBottom: 9, paddingHorizontal: 9, gap: 4 }}>
          <Text variant="h3" numberOfLines={2} style={{ color: clothLabel.fg, minHeight: Math.round(52 * theme.fontScale) }} {...(lang ? ({ lang } as object) : {})}>
            {name}
          </Text>
          {subtitle ? <Text variant="caption" weight="semibold" numberOfLines={1} style={{ color: clothLabel.muted }}>{subtitle}</Text> : null}
          {stat ? (
            <View style={{ marginTop: 6, paddingTop: 7, borderTopWidth: 1, borderStyle: 'dashed', borderColor: '#D6D0C6' }}>
              <Text mono variant="caption" numberOfLines={1} style={{ color: '#44403C' }}>{stat}</Text>
            </View>
          ) : null}
        </View>
      </View>
      {footer ? <View style={{ marginTop: 'auto', paddingTop: 16, flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{footer}</View> : null}
    </>
  );
  const cover: StyleProp<ViewStyle> = [
    {
      height: height * Math.min(theme.fontScale, 1.25),
      backgroundColor: cl.cloth,
      borderTopStartRadius: 4, borderBottomStartRadius: 4, borderTopEndRadius: 9, borderBottomEndRadius: 9,
      paddingTop: 22, paddingBottom: 16, paddingEnd: 16, paddingStart: 26,
      borderWidth: theme.accessModes.highContrast ? 2 : 0, borderColor: theme.colors.borderStrong,
      shadowColor: '#1C1917', shadowOpacity: theme.scheme === 'dark' ? 0.5 : 0.3, shadowRadius: 18, shadowOffset: { width: 0, height: 14 }, elevation: 6,
    },
    style,
  ];
  if (!onPress) return <View testID={testID} style={cover}>{body}</View>;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      role="button"
      accessibilityLabel={accessibilityLabel ?? name}
      {...webData({ kPress: '', kHover: theme.reducedMotion ? 'none' : 'lift' })}
      style={({ pressed }) => [cover, pressed && !theme.reducedMotion ? { transform: [{ translateY: 4 }] } : null]}
    >
      {body}
    </Pressable>
  );
}

/** The shelf plank under a row of registers. */
export function ShelfPlank() {
  const theme = useKalamTheme();
  return (
    <View aria-hidden pointerEvents="none" style={{ height: 14, borderRadius: 3, backgroundColor: theme.colors.surfaceAlt, borderTopWidth: 3, borderTopColor: withAlpha(theme.colors.borderStrong, 0.8), opacity: 0.9 }} />
  );
}
