import { router } from 'expo-router';
import { Star } from 'lucide-react-native';
import { View } from 'react-native';

import { isCompatible, type BazaarListing } from '@/core/bazaar';
import { clothLabel, cloths, Register, Stamp, Text, useKalamTheme } from '@/design';
import { useT } from '@/i18n/react';

import { CATEGORY, clothForColor, priceText, ratingText } from './parts';
import { bazaarRoutes } from './routes';

/**
 * A listing on the market shelf (docs/12 §6, DIRECTION §6): a register cover like the shelf, the app's title on
 * the label in its own language, the maker's name under it, installs and rating in Courier Prime, and a stamp for
 * how it was checked. Prices show only when payments are switched on.
 */
export function ListingCard({ listing, height = 360, payments, preview = false }: {
  listing: BazaarListing;
  height?: number;
  payments: boolean;
  /** A look-only copy (the publish preview): no button, nothing to focus, nowhere to go. */
  preview?: boolean;
}) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const cloth = clothForColor(listing.appColor);
  const fg = cloths[cloth].fg;
  // Paper: stamps sit on the label white. Ink night: the stamp's own dark wash keeps its light ink readable.
  const coverWash = theme.scheme === 'dark' ? undefined : clothLabel.bg;
  const installs = t('bazaar.installs', { count: listing.installs });
  const compatible = isCompatible(listing.kalamSpecVersion);
  const checked = listing.status === 'published';
  const label = [
    listing.title,
    t('bazaar.by', { name: listing.makerName }),
    payments ? priceText(t, listing.price) : null,
    t(CATEGORY[listing.category]),
    ratingText(t, listing),
    installs,
    listing.featured ? t('bazaar.featuredByTeam') : null,
    compatible ? null : t('bazaar.needsNewer'),
  ].filter(Boolean).join('. ');
  return (
    <Register
      cloth={cloth}
      name={listing.title}
      lang={listing.lang}
      subtitle={t('bazaar.by', { name: listing.makerName })}
      stat={listing.ratingCount ? `${installs} · ★ ${listing.ratingAvg.toFixed(1)}` : installs}
      height={height}
      onPress={preview ? undefined : () => router.push(bazaarRoutes.listing(listing.id))}
      accessibilityLabel={label}
      footer={
        <>
          {checked ? <Stamp kind="checked" label={t(listing.reviewed ? 'bazaar.status.reviewed' : 'bazaar.stamp.checked')} size="sm" wash={coverWash} /> : null}
          {listing.featured ? <Stamp kind="plain" icon={Star} label={t('bazaar.featured')} size="sm" wash={coverWash} /> : null}
          {!compatible ? <Stamp kind="needs" label={t('bazaar.needsNewer')} size="sm" wash={coverWash} /> : null}
          <View style={{ width: '100%', flexDirection: 'row', flexWrap: 'wrap', columnGap: 8, rowGap: 2 }}>
            <Text variant="caption" weight="semibold" numberOfLines={1} style={{ color: fg }}>{t(CATEGORY[listing.category])}</Text>
            {payments ? <Text variant="caption" weight="semibold" style={{ color: fg }}>{priceText(t, listing.price)}</Text> : null}
          </View>
        </>
      }
    />
  );
}
