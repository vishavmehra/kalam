import { router, useFocusEffect } from 'expo-router';
import { Library, Search, Store, Upload, Wallet } from 'lucide-react-native';
import { type ReactNode, useCallback, useRef, useState } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';

import { AppShell } from '@/components/shell/AppShell';
import { useOnline } from '@/components/status/useHybridStatus';
import { BAZAAR_CATEGORIES, type BazaarCategory, type BazaarListing, type BazaarQuery, type BazaarSort } from '@/core/bazaar';
import { Button, Chip, EmptyState, Screen, SegmentedControl, ShelfPlank, Text, TextField, useBreakpoint, useKalamTheme } from '@/design';
import { LANGUAGES } from '@/i18n/languages';
import { useT } from '@/i18n/react';
import { ModeratorLink } from '@/features/bazaar-moderation/ModeratorLink';
import { getServices } from '@/services';

import { ListingCard } from './ListingCard';
import { Busy, CATEGORY, OfflineNote, PageHead } from './parts';
import { bazaarRoutes } from './routes';

const GAP = 24;
const MIN_COVER = 180;
const HEIGHTS = [372, 356, 380, 364];
type Price = 'any' | 'free' | 'paid';
interface Rows { featured: BazaarListing[]; popular: BazaarListing[]; rated: BazaarListing[] }
const NO_ROWS: Rows = { featured: [], popular: [], rated: [] };

/**
 * Kalam Bazaar Discover (docs/12 §4-6, DIRECTION §6): a market shelf of register covers. Editorial and organic
 * rows (featured is always labelled), search, composable filters, 20-cover pages. Offline: saved covers only.
 * The price filter and all credit actions are hidden unless EXPO_PUBLIC_BAZAAR_PAYMENTS is "on".
 */
export function BazaarScreen() {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const { isPhone } = useBreakpoint();
  const online = useOnline();
  const bazaar = getServices().bazaar;
  const configured = bazaar.isConfigured();
  const payments = bazaar.paymentsEnabled();

  const [draft, setDraft] = useState('');
  const [text, setText] = useState('');
  const [category, setCategory] = useState<BazaarCategory | undefined>();
  const [sort, setSort] = useState<BazaarSort>('new');
  const [price, setPrice] = useState<Price>('any');
  const [lang, setLang] = useState<string | undefined>();
  const [listings, setListings] = useState<BazaarListing[]>([]);
  const [rows, setRows] = useState<Rows>(NO_ROWS);
  const [cursor, setCursor] = useState<string | undefined>();
  const [fromCache, setFromCache] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [gridW, setGridW] = useState(0);
  const request = useRef(0);

  // Without payments every app is free to add, so a price filter would only confuse.
  const priceFilter: Price = payments ? price : 'any';
  const searching = !!text.trim();
  const filtered = searching || !!category || priceFilter !== 'any' || !!lang;
  const discover = !filtered && sort === 'new';
  const q: BazaarQuery = { text, category, sort, ...(priceFilter === 'any' ? {} : { price: priceFilter }), ...(lang ? { lang } : {}) };

  const load = useCallback(async () => {
    const id = ++request.current;
    setLoading(true);
    const empty = { listings: [], fromCache: true, cursor: undefined };
    const [page, featured, popular, rated] = await Promise.all([
      bazaar.browse(q).catch(() => empty),
      discover ? bazaar.browse({ featured: true, limit: 4 }).catch(() => empty) : Promise.resolve(empty),
      discover ? bazaar.browse({ sort: 'popular', limit: 4 }).catch(() => empty) : Promise.resolve(empty),
      discover ? bazaar.browse({ sort: 'rating', limit: 4 }).catch(() => empty) : Promise.resolve(empty),
    ]);
    if (id !== request.current) return; // a newer search started
    setListings(page.listings);
    setCursor(page.cursor);
    setFromCache(page.fromCache);
    setRows({
      featured: featured.listings.filter((l) => l.featured).slice(0, 4),
      popular: popular.listings.filter((l) => l.installs > 0).slice(0, 4),
      rated: rated.listings.filter((l) => l.ratingCount > 0).slice(0, 4),
    });
    setLoading(false);
    // `online` is a dependency so the page reloads (or falls back to saved cards) when it changes.
  }, [bazaar, text, category, sort, priceFilter, lang, discover, online]); // eslint-disable-line react-hooks/exhaustive-deps

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const more = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    const page = await bazaar.browse({ ...q, cursor }).catch(() => undefined);
    setLoadingMore(false);
    if (!page) return;
    setListings((prev) => [...prev, ...page.listings.filter((l) => !prev.some((p) => p.id === l.id))]);
    setCursor(page.cursor);
  };

  // Online, but Firestore could not be reached and nothing is saved: the empty state says so, so the note is not repeated.
  const unreachableEmpty = !loading && fromCache && online && listings.length === 0 && !filtered;
  const clear = () => { setDraft(''); setText(''); setCategory(undefined); setPrice('any'); setLang(undefined); setSort('new'); };
  const shelf = (items: BazaarListing[]) => <CoverShelf items={items} width={gridW} payments={payments} strip={isPhone && theme.fontScale <= 1.2} />;
  const languagesInView = [...new Set([...listings, ...rows.popular, ...rows.rated].map((l) => l.lang.split('-')[0] ?? l.lang))];
  const sortTitle = sort === 'popular' ? t('bazaar.sort.popular') : sort === 'rating' ? t('bazaar.sort.rating') : t('bazaar.results');

  return (
    <AppShell active="bazaar">
      <Screen>
        <PageHead
          title={t('bazaar.title')}
          lede={t('bazaar.lede')}
          actions={
            <>
              <ModeratorLink />
              <Button label={t('bazaar.library.title')} variant="ghost" icon={Library} onPress={() => router.push(bazaarRoutes.library)} />
              {payments ? <Button label={t('bazaar.wallet.title')} variant="ghost" icon={Wallet} onPress={() => router.push(bazaarRoutes.wallet)} /> : null}
              <Button label={t('bazaar.studio.title')} variant="outline" icon={Store} onPress={() => router.push(bazaarRoutes.mine)} />
              <Button label={t('bazaar.share')} icon={Upload} onPress={() => router.push(bazaarRoutes.publish())} />
            </>
          }
        />

        {!configured ? (
          <EmptyState title={t('bazaar.notSetUp.title')} description={t('bazaar.notSetUp.body')} />
        ) : (
          <View style={{ gap: 24 }} onLayout={(e) => setGridW(e.nativeEvent.layout.width)}>
            {fromCache && !unreachableEmpty ? <OfflineNote>{online ? t('bazaar.cache.unreachable') : t('bazaar.cache.offline')}</OfflineNote> : null}

            <View style={{ flexDirection: isPhone ? 'column' : 'row', gap: 12, alignItems: isPhone ? 'stretch' : 'flex-end' }}>
              <View style={{ flex: 1, maxWidth: isPhone ? undefined : 420 }}>
                <TextField
                  label={t('bazaar.search.label')}
                  labelHidden
                  icon={Search}
                  value={draft}
                  onChangeText={(v) => { setDraft(v); if (!v.trim()) setText(''); }}
                  onSubmitEditing={() => setText(draft)}
                  placeholder={t('bazaar.search.placeholder')}
                  returnKeyType="search"
                  autoCorrect={false}
                />
              </View>
              {draft.trim() && draft !== text ? <Button label={t('bazaar.search.go')} variant="secondary" onPress={() => setText(draft)} /> : null}
              <View style={{ marginStart: isPhone ? 0 : 'auto' }}>
                <SegmentedControl
                  label={t('bazaar.sort.label')}
                  labelHidden
                  wrap
                  value={sort}
                  onChange={setSort}
                  options={[{ value: 'new', label: t('bazaar.sort.new') }, { value: 'popular', label: t('bazaar.sort.popular') }, { value: 'rating', label: t('bazaar.sort.rating') }]}
                />
              </View>
            </View>

            <View style={{ gap: 10 }}>
              <View role="radiogroup" accessibilityLabel={t('bazaar.filter.category')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <Chip label={t('bazaar.filter.all')} role="radio" selected={!category} onPress={() => setCategory(undefined)} />
                {BAZAAR_CATEGORIES.map((c) => (
                  <Chip key={c} label={t(CATEGORY[c])} role="radio" selected={category === c} onPress={() => setCategory(category === c ? undefined : c)} />
                ))}
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                {payments ? (
                  <View role="radiogroup" accessibilityLabel={t('bazaar.filter.price')} style={{ flexDirection: 'row', gap: 8 }}>
                    {(['any', 'free', 'paid'] as const).map((p) => (
                      <Chip key={p} role="radio" label={t(p === 'any' ? 'bazaar.filter.anyPrice' : p === 'free' ? 'bazaar.price.free' : 'bazaar.filter.paid')} selected={price === p} onPress={() => setPrice(p)} />
                    ))}
                  </View>
                ) : null}
                {languagesInView.length > 1 || lang ? (
                  <View role="radiogroup" accessibilityLabel={t('bazaar.filter.language')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    <Chip role="radio" label={t('bazaar.filter.anyLanguage')} selected={!lang} onPress={() => setLang(undefined)} />
                    {LANGUAGES.filter((l) => languagesInView.includes(l.code) || lang === l.code).map((l) => (
                      <Chip key={l.code} role="radio" label={l.native} lang={l.code} accessibilityLabel={l.english} selected={lang === l.code} onPress={() => setLang(l.code)} />
                    ))}
                  </View>
                ) : null}
              </View>
            </View>

            {loading && listings.length === 0 ? <Busy text={t('bazaar.loading')} /> : null}

            {discover && rows.featured.length ? (
              <Row title={t('bazaar.featured')} note={t('bazaar.featuredNote')}>{shelf(rows.featured)}</Row>
            ) : null}
            {discover && rows.popular.length ? (
              <Row title={t('bazaar.sort.popular')} onAll={() => setSort('popular')} allLabel={t('bazaar.seeAll')}>{shelf(rows.popular)}</Row>
            ) : null}
            {discover && rows.rated.length ? (
              <Row title={t('bazaar.sort.rating')} onAll={() => setSort('rating')} allLabel={t('bazaar.seeAll')}>{shelf(rows.rated)}</Row>
            ) : null}

            {!loading && listings.length === 0 ? (
              filtered ? (
                <EmptyState
                  title={searching ? t('bazaar.none.search', { query: text.trim() }) : t('bazaar.none.filters')}
                  description={fromCache ? t('bazaar.none.cacheHint') : t('bazaar.none.hint')}
                  action={<Button label={t('bazaar.none.showAll')} variant="outline" onPress={clear} />}
                />
              ) : unreachableEmpty ? (
                <EmptyState
                  title={t('bazaar.unreachable.title')}
                  description={t('bazaar.unreachable.body')}
                  action={<Button label={t('common.tryAgain')} variant="outline" onPress={() => void load()} />}
                />
              ) : (
                <EmptyState
                  title={fromCache ? t('bazaar.none.savedTitle') : t('bazaar.none.title')}
                  description={fromCache ? t('bazaar.none.savedBody') : t('bazaar.none.body')}
                  action={fromCache ? undefined : <Button label={t('bazaar.share')} icon={Upload} onPress={() => router.push(bazaarRoutes.publish())} />}
                />
              )
            ) : null}

            {listings.length ? (
              <Row title={discover ? t('bazaar.newIn') : sortTitle}>
                <View style={{ opacity: loading ? 0.6 : 1 }}>{shelf(listings)}</View>
              </Row>
            ) : null}

            {cursor && !fromCache ? (
              <View style={{ alignItems: 'center' }}>
                <Button label={t('bazaar.more')} variant="outline" loading={loadingMore} onPress={more} />
              </View>
            ) : null}
          </View>
        )}
      </Screen>
    </AppShell>
  );
}

/** Covers in rows on planks; a sideways strip on phones (two columns in Large mode). */
function CoverShelf({ items, width, payments, strip }: { items: BazaarListing[]; width: number; payments: boolean; strip: boolean }) {
  const theme = useKalamTheme();
  const { width: windowW } = useWindowDimensions();
  if (strip) {
    const w = Math.round(windowW * 0.66);
    return (
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} snapToInterval={w + 16} decelerationRate="fast" contentContainerStyle={{ paddingTop: 12, paddingEnd: 16 }}>
          <View role="list" style={{ flexDirection: 'row', gap: 16, alignItems: 'flex-end' }}>
            {items.map((l, i) => <View key={l.id} role="listitem" style={{ width: w }}><ListingCard listing={l} payments={payments} height={HEIGHTS[i % HEIGHTS.length]! - 20} /></View>)}
          </View>
        </ScrollView>
        <ShelfPlank />
      </View>
    );
  }
  if (width <= 0) return null;
  const cols = Math.max(2, Math.min(5, Math.floor((width + GAP) / (MIN_COVER * Math.min(theme.fontScale, 1.25) + GAP))));
  const coverW = Math.floor((width - GAP * (cols - 1)) / cols);
  const rows: BazaarListing[][] = [];
  for (let i = 0; i < items.length; i += cols) rows.push(items.slice(i, i + cols));
  return (
    <View style={{ gap: 36 }}>
      {rows.map((row, r) => (
        <View key={row[0]!.id}>
          <View role="list" style={{ flexDirection: 'row', gap: GAP, alignItems: 'flex-end', paddingTop: 12 }}>
            {row.map((l, i) => (
              <View key={l.id} role="listitem" style={{ width: coverW }}>
                <ListingCard listing={l} payments={payments} height={HEIGHTS[(r * cols + i) % HEIGHTS.length]} />
              </View>
            ))}
          </View>
          <ShelfPlank />
        </View>
      ))}
    </View>
  );
}

function Row({ title, note, onAll, allLabel, children }: { title: string; note?: string; onAll?: () => void; allLabel?: string; children: ReactNode }) {
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
        <View style={{ flex: 1, minWidth: 200, gap: 2 }}>
          <Text variant="h3">{title}</Text>
          {note ? <Text variant="bodySmall" tone="muted">{note}</Text> : null}
        </View>
        {onAll && allLabel ? <Button label={allLabel} variant="link" size="sm" onPress={onAll} /> : null}
      </View>
      {children}
    </View>
  );
}
