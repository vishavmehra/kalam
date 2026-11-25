import { View } from 'react-native';
import { SvgXml } from 'react-native-svg';

import type { BazaarListing } from '@/core/bazaar';
import { AppIconTile, useKalamTheme } from '@/design';

/**
 * Listing icon: the maker's custom SVG (sanitised again when the listing was read, docs/11 §11.6)
 * or the app's glyph tile. SvgXml builds native/React elements, never HTML, so no script can run.
 */
export function ListingIcon({ listing, size }: { listing: Pick<BazaarListing, 'icon' | 'iconSvg' | 'appColor'>; size: number }) {
  const theme = useKalamTheme();
  if (listing.iconSvg) {
    return (
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ width: size, height: size, borderRadius: Math.round(size * 0.28), overflow: 'hidden', backgroundColor: theme.colors.surfaceAlt }}
      >
        <SvgXml xml={listing.iconSvg} width={size} height={size} />
      </View>
    );
  }
  return <AppIconTile icon={listing.icon} appColor={listing.appColor} size={size} />;
}
