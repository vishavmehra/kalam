/**
 * Shared pieces of the Kalam Bazaar screens: the back link, section headings, the quiet offline note and
 * the words for categories, prices, statuses and counts. Every visible word comes from the i18n catalogue.
 */
import { router } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';

import type { BazaarCategory, BazaarListing } from '@/core/bazaar';
import { Button, type ClothKind, cloths, LedgerRule, OfflineIcon, Text, useKalamTheme } from '@/design';
import type { TranslationKey } from '@/i18n/keys';
import type { TFunction } from '@/i18n/translator';

import { bazaarRoutes } from './routes';

export const CATEGORY: Record<BazaarCategory, TranslationKey> = {
  business: 'bazaar.category.business', education: 'bazaar.category.education', finance: 'bazaar.category.finance',
  productivity: 'bazaar.category.productivity', health: 'bazaar.category.health', personal: 'bazaar.category.personal',
  field_work: 'bazaar.category.field_work', utilities: 'bazaar.category.utilities', creative: 'bazaar.category.creative',
};

/** Price words. Credits are a test currency and only ever shown when payments are switched on. */
export const priceText = (t: TFunction, price: number) => (price === 0 ? t('bazaar.price.free') : t('bazaar.price.credits', { count: price }));

export function statusText(t: TFunction, l: Pick<BazaarListing, 'status' | 'reviewed'>): string {
  switch (l.status) {
    case 'published': return t(l.reviewed ? 'bazaar.status.reviewed' : 'bazaar.status.passed');
    case 'pending_review': return t('bazaar.status.waiting');
    case 'rejected': return t('bazaar.status.rejected');
    case 'unpublished': return t('bazaar.status.unpublished');
    case 'suspended': return t('bazaar.status.suspended');
  }
}

export const ratingText = (t: TFunction, l: Pick<BazaarListing, 'ratingAvg' | 'ratingCount'>) =>
  l.ratingCount ? t('bazaar.rating.summary', { stars: l.ratingAvg.toFixed(1), count: l.ratingCount }) : t('bazaar.rating.none');

/** A listing's cover cloth: the register cloth closest to the maker's app colour. */
export function clothForColor(hex: string): ClothKind {
  const rgb = (h: string) => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16) || 0);
  const [r, g, b] = rgb(hex);
  let best: ClothKind = 'green';
  let bestD = Infinity;
  for (const [kind, c] of Object.entries(cloths) as Array<[ClothKind, { cloth: string }]>) {
    const [cr, cg, cb] = rgb(c.cloth);
    const d = (r! - cr!) ** 2 + (g! - cg!) ** 2 + (b! - cb!) ** 2;
    if (d < bestD) { bestD = d; best = kind; }
  }
  return best;
}

export function BackToBazaar({ t }: { t: TFunction }) {
  return (
    <View style={{ alignSelf: 'flex-start', marginStart: -8, marginBottom: 12 }}>
      <Button label={t('bazaar.title')} variant="ghost" size="sm" icon={ArrowLeft}
        onPress={() => (router.canGoBack() ? router.back() : router.replace(bazaarRoutes.home))} />
    </View>
  );
}

/** Page heading with the ledger total rule, the only decoration headings get (DIRECTION §7). */
export function PageHead({ title, lede, actions }: { title: string; lede?: string; actions?: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: 16, marginBottom: 28 }}>
      <View style={{ flex: 1, minWidth: 240, gap: 4 }}>
        <Text variant="h1">{title}</Text>
        <LedgerRule />
        {lede ? <Text tone="secondary" style={{ maxWidth: 640, marginTop: 10 }}>{lede}</Text> : null}
      </View>
      {/* Bounded so the buttons wrap onto a second line instead of running off a phone screen. */}
      {actions ? <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', flexShrink: 1, maxWidth: '100%' }}>{actions}</View> : null}
    </View>
  );
}

export function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <View style={{ gap: 12 }}>
      <View style={{ gap: 2 }}>
        <Text variant="h3">{title}</Text>
        {note ? <Text variant="bodySmall" tone="muted">{note}</Text> : null}
      </View>
      {children}
    </View>
  );
}

/** Offline is normal: a quiet graphite line with the wifi-off icon, never a warning banner. */
export function OfflineNote({ children }: { children: string }) {
  const theme = useKalamTheme();
  return (
    <View role="status" style={{ flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 10, paddingHorizontal: 14, marginBottom: 20, borderRadius: theme.radius.paper, backgroundColor: theme.colors.surfaceAlt }}>
      <OfflineIcon size={16} color={theme.colors.graphite} strokeWidth={2.2} />
      <Text variant="bodySmall" style={{ flex: 1, color: theme.colors.graphite }}>{children}</Text>
    </View>
  );
}

export function Busy({ text }: { text: string }) {
  const theme = useKalamTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 24 }}>
      <ActivityIndicator color={theme.colors.primary} />
      <Text tone="secondary">{text}</Text>
    </View>
  );
}
