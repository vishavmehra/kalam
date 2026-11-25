import { Link } from 'expo-router';
import { Download, Heart, Star } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { CATEGORY_LABELS, isCompatible, priceLabel, type BazaarListing } from '@/core/bazaar';
import { languageName } from '@/core/spec/describe';
import { Chip, Text, useKalamTheme, webData } from '@/design';

import { ListingIcon } from './ListingIcon';
import { bazaarRoutes } from './routes';

export const countLabel = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
export const ratingLabel = (l: Pick<BazaarListing, 'ratingAvg' | 'ratingCount'>) =>
  l.ratingCount ? `${l.ratingAvg.toFixed(1)} stars from ${countLabel(l.ratingCount, 'review', 'reviews')}` : 'No reviews yet';

/** Browse card (docs/12 §6): icon, title, maker, description, price, category, language, rating, installs. */
export function ListingCard({ listing, width }: { listing: BazaarListing; width: number }) {
  const theme = useKalamTheme();
  const c = theme.colors;
  const compact = width < 240;
  const installs = countLabel(listing.installs, 'install', 'installs');
  const likes = countLabel(listing.likes, 'like', 'likes');
  const price = priceLabel(listing.price);
  const compatible = isCompatible(listing.kalamSpecVersion);
  return (
    <Link href={bazaarRoutes.listing(listing.id)} asChild>
      <Pressable
        role="link"
        accessibilityLabel={`${listing.title}, by ${listing.makerName}. ${price}. ${CATEGORY_LABELS[listing.category]}. ${ratingLabel(listing)}. ${installs}.${listing.featured ? ' Featured by the Kalam team.' : ''}`}
        {...webData({ kPress: '', kHover: 'border' })}
        android_ripple={{ color: c.surfaceAlt, foreground: true }}
        style={{
          width,
          minHeight: compact ? 200 : 220,
          padding: compact ? 14 : 18,
          gap: 12,
          backgroundColor: c.surface,
          borderRadius: theme.radius.lg,
          borderWidth: theme.accessModes.highContrast ? 2 : 1,
          borderColor: c.border,
          overflow: 'hidden',
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <ListingIcon listing={listing} size={compact ? 40 : 48} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant={compact ? 'body' : 'h4'} weight="semibold" numberOfLines={2}>{listing.title}</Text>
            <Text variant="bodySmall" tone="muted" numberOfLines={1}>by {listing.makerName}</Text>
          </View>
        </View>
        <Text variant="bodySmall" tone="secondary" numberOfLines={3} style={{ flex: 1 }}>{listing.description}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <Chip label={price} tone={listing.price === 0 ? 'success' : 'accent'} />
          {!compact ? <Chip label={CATEGORY_LABELS[listing.category]} tone="neutral" /> : null}
          {!listing.lang.startsWith('en') ? <Chip label={languageName(listing.lang)} tone="neutral" /> : null}
          {listing.featured ? <Chip label="Featured" tone="info" /> : null}
          {!compatible ? <Chip label="Needs a newer Kalam" tone="warning" /> : null}
        </View>
        <View style={{ flexDirection: 'row', gap: 14, flexWrap: 'wrap' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Star size={14} color={c.textMuted} />
            <Text variant="caption" tone="muted">{listing.ratingCount ? `${listing.ratingAvg.toFixed(1)} (${listing.ratingCount})` : 'New'}</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Download size={14} color={c.textMuted} />
            <Text variant="caption" tone="muted">{installs}</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Heart size={14} color={c.textMuted} />
            <Text variant="caption" tone="muted">{likes}</Text>
          </View>
        </View>
      </Pressable>
    </Link>
  );
}
