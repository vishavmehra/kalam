import { router, useFocusEffect } from 'expo-router';
import { CloudOff, Library, Search, Store, Upload, Wallet } from 'lucide-react-native';
import { type ReactNode, useCallback, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { LANGUAGES } from '@/components/languages';
import { AppShell } from '@/components/shell/AppShell';
import { useOnline } from '@/components/status/useHybridStatus';
import {
  BAZAAR_CATEGORIES, CATEGORY_LABELS, type BazaarCategory, type BazaarListing, type BazaarQuery, type BazaarSort,
} from '@/core/bazaar';
import { Button, Chip, EmptyState, Screen, SegmentedControl, Surface, Text, TextField, useBreakpoint, useKalamTheme } from '@/design';
import { getServices } from '@/services';

import { ListingCard } from './ListingCard';
import { bazaarRoutes } from './routes';

const GAP = 16;
const MIN_CARD = 250;
type Price = 'any' | 'free' | 'paid';
interface Rows { featured: BazaarListing[]; popular: BazaarListing[]; rated: BazaarListing[] }
const NO_ROWS: Rows = { featured: [], popular: [], rated: [] };

/**
 * Kalam Bazaar Discover (docs/12 §4-6): editorial and organic rows (featured is always labelled),
 * search, composable filters, 20-card pages. Offline: saved cards only, read-only.
 */
export function BazaarScreen() {
  const theme = useKalamTheme();
  const { isPhone, hasRail } = useBreakpoint();
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

  const searching = !!text.trim();
  const filtered = searching || !!category || price !== 'any' || !!lang;
  const discover = !filtered && sort === 'new';
  const q: BazaarQuery = { text, category, sort, ...(price === 'any' ? {} : { price }), ...(lang ? { lang } : {}) };

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
  }, [bazaar, text, category, sort, price, lang, discover, online]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const clear = () => { setDraft(''); setText(''); setCategory(undefined); setPrice('any'); setLang(undefined); setSort('new'); };
  const cols = isPhone ? 1 : Math.max(1, Math.min(4, Math.floor((gridW + GAP) / (MIN_CARD + GAP))));
  const cardW = gridW > 0 ? Math.floor((gridW - GAP * (cols - 1)) / cols) : 0;
  const grid = (items: BazaarListing[]) => (
    <View role="list" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GAP }}>
      {cardW > 0 ? items.map((l) => <View key={l.id} role="listitem"><ListingCard listing={l} width={cardW} /></View>) : null}
    </View>
  );
  const languagesInView = [...new Set([...listings, ...rows.popular, ...rows.rated].map((l) => l.lang.split('-')[0] ?? l.lang))];

  return (
    <AppShell active="bazaar">
      <Screen>
        <View style={{ flexDirection: hasRail ? 'row' : 'column', alignItems: hasRail ? 'flex-end' : 'stretch', gap: 16, marginBottom: 24 }}>
          <View style={{ flex: 1, gap: 6 }}>
            <Text variant="h1">Kalam Bazaar</Text>
            <Text tone="secondary" style={{ maxWidth: 620 }}>
              Apps made by other people. Install a copy and it is yours. It keeps working offline, and your entries stay on your device.
            </Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Button label="My library" variant="ghost" icon={Library} onPress={() => router.push(bazaarRoutes.library)} />
            {payments ? <Button label="Credits" variant="ghost" icon={Wallet} onPress={() => router.push(bazaarRoutes.wallet)} /> : null}
            <Button label="Creator Studio" variant="outline" icon={Store} onPress={() => router.push(bazaarRoutes.mine)} />
            <Button label="Share an app" icon={Upload} onPress={() => router.push(bazaarRoutes.publish())} />
          </View>
        </View>

        {!configured ? (
          <EmptyState
            title="Kalam Bazaar is not set up in this build"
            description="Your own apps work the same. Sharing needs Firebase to be configured."
          />
        ) : (
          <View style={{ gap: 20 }} onLayout={(e) => setGridW(e.nativeEvent.layout.width)}>
            {fromCache ? (
              <Surface tone="alt" padded={16} style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }} role="status">
                <CloudOff size={18} color={theme.colors.warning} />
                <Text style={{ flex: 1 }}>
                  {online
                    ? 'Kalam Bazaar could not be reached. These are apps you looked at before.'
                    : 'You are offline. These are apps you looked at before. Apps you opened can still be installed.'}
                </Text>
              </Surface>
            ) : null}

            <View style={{ flexDirection: isPhone ? 'column' : 'row', gap: 12, alignItems: isPhone ? 'stretch' : 'flex-end' }}>
              <View style={{ flex: 1, maxWidth: isPhone ? undefined : 420 }}>
                <TextField
                  label="Search apps"
                  labelHidden
                  icon={Search}
                  value={draft}
                  onChangeText={(v) => { setDraft(v); if (!v.trim()) setText(''); }}
                  onSubmitEditing={() => setText(draft)}
                  placeholder="Search by name, use or maker"
                  returnKeyType="search"
                  autoCorrect={false}
                />
              </View>
              {draft.trim() && draft !== text ? <Button label="Search" variant="secondary" onPress={() => setText(draft)} /> : null}
              <View style={{ marginLeft: isPhone ? 0 : 'auto' }}>
                <SegmentedControl
                  label="Sort"
                  labelHidden
                  wrap
                  value={sort}
                  onChange={setSort}
                  options={[{ value: 'new', label: 'Newest' }, { value: 'popular', label: 'Most installed' }, { value: 'rating', label: 'Top rated' }]}
                />
              </View>
            </View>

            <View style={{ gap: 10 }}>
              <View role="radiogroup" accessibilityLabel="Category" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <Chip label="All" role="radio" selected={!category} onPress={() => setCategory(undefined)} />
                {BAZAAR_CATEGORIES.map((c) => (
                  <Chip key={c} label={CATEGORY_LABELS[c]} role="radio" selected={category === c} onPress={() => setCategory(category === c ? undefined : c)} />
                ))}
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                <View role="radiogroup" accessibilityLabel="Price" style={{ flexDirection: 'row', gap: 8 }}>
                  {(['any', 'free', 'paid'] as const).map((p) => (
                    <Chip key={p} role="radio" label={p === 'any' ? 'Any price' : p === 'free' ? 'Free' : 'Paid'} selected={price === p} onPress={() => setPrice(p)} />
                  ))}
                </View>
                {languagesInView.length > 1 || lang ? (
                  <View role="radiogroup" accessibilityLabel="Language" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    <Chip role="radio" label="Any language" selected={!lang} onPress={() => setLang(undefined)} />
                    {LANGUAGES.filter((l) => languagesInView.includes(l.code) || lang === l.code).map((l) => (
                      <Chip key={l.code} role="radio" label={l.native} accessibilityLabel={l.english} selected={lang === l.code} onPress={() => setLang(l.code)} />
                    ))}
                  </View>
                ) : null}
              </View>
            </View>

            {loading && listings.length === 0 ? (
              <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 24 }}>
                <ActivityIndicator color={theme.colors.primary} />
                <Text tone="secondary">Loading apps</Text>
              </View>
            ) : null}

            {discover && rows.featured.length ? (
              <Row title="Featured" note="Chosen by the Kalam team. Featured apps are not ranked by installs or ratings.">{grid(rows.featured)}</Row>
            ) : null}
            {discover && rows.popular.length ? (
              <Row title="Most installed" onAll={() => setSort('popular')}>{grid(rows.popular)}</Row>
            ) : null}
            {discover && rows.rated.length ? (
              <Row title="Top rated" onAll={() => setSort('rating')}>{grid(rows.rated)}</Row>
            ) : null}

            {!loading && listings.length === 0 ? (
              filtered ? (
                <EmptyState
                  title={searching ? `No apps match "${text.trim()}"` : 'No apps match these filters'}
                  description={fromCache ? 'Only apps you looked at before are saved for offline use.' : 'Try another word, category or price.'}
                  action={<Button label="Show all apps" variant="outline" onPress={clear} />}
                />
              ) : (
                <EmptyState
                  title={fromCache ? 'No saved apps yet' : 'No apps here yet'}
                  description={fromCache ? 'Open Kalam Bazaar while online and the apps you see are saved for later.' : 'Be the first to share an app you made.'}
                  action={fromCache ? undefined : <Button label="Share an app" icon={Upload} onPress={() => router.push(bazaarRoutes.publish())} />}
                />
              )
            ) : null}

            {listings.length ? (
              <Row title={discover ? 'New in Kalam Bazaar' : sort === 'popular' ? 'Most installed' : sort === 'rating' ? 'Top rated' : 'Results'}>
                <View style={{ opacity: loading ? 0.6 : 1 }}>{grid(listings)}</View>
              </Row>
            ) : null}

            {cursor && !fromCache ? (
              <View style={{ alignItems: 'center' }}>
                <Button label="Show more apps" variant="outline" loading={loadingMore} onPress={more} />
              </View>
            ) : null}
          </View>
        )}
      </Screen>
    </AppShell>
  );
}

function Row({ title, note, onAll, children }: { title: string; note?: string; onAll?: () => void; children: ReactNode }) {
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
        <View style={{ flex: 1, minWidth: 200, gap: 2 }}>
          <Text variant="h3">{title}</Text>
          {note ? <Text variant="bodySmall" tone="muted">{note}</Text> : null}
        </View>
        {onAll ? <Button label="See all" variant="link" size="sm" onPress={onAll} /> : null}
      </View>
      {children}
    </View>
  );
}
