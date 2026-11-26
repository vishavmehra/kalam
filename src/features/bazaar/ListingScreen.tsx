import { router, useFocusEffect } from 'expo-router';
import { Download, Flag, GitFork, Heart, Play, RefreshCw, RotateCcw, ShieldAlert, ShoppingBag, Sparkles } from 'lucide-react-native';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, View } from 'react-native';

import { routes } from '@/components/shell/routes';
import { useOnline } from '@/components/status/useHybridStatus';
import { BASED_ON_PREFIX, isCompatible, sampleRecords, SENSITIVE_CATEGORIES, type BazaarListing, type Screenshot } from '@/core/bazaar';
import type { AIExecutionResult, BazaarUpdateCheck, KalamUser, RecordValue } from '@/core/contracts';
import type { KalamSpec } from '@/core/spec/schema';
import { AppShell } from '@/components/shell/AppShell';
import { Button, clothLabel, EmptyState, OfflineIcon, Register, Screen, Stamp, Surface, Text, useBreakpoint, useKalamTheme, useToast } from '@/design';
import { useAuthUser } from '@/features/auth/use-auth';
import { recordListingEvent } from '@/features/bazaar-moderation/listing-events';
import type { TranslationKey } from '@/i18n/keys';
import { languageInfo } from '@/i18n/languages';
import { useFormat, useT } from '@/i18n/react';
import { KalamRuntime } from '@/runtime/KalamRuntime';
import { createMemoryRuntimeServices } from '@/runtime/memory-services';
import { useAccessModes } from '@/runtime/RunAppScreen';
import { getServices } from '@/services';
import { useAppsStore } from '@/state/apps-store';

import { BackToBazaar, CATEGORY, clothForColor, OfflineNote, priceText, ratingText, statusText } from './parts';
import { ReviewsSection } from './ReviewsSection';
import { bazaarRoutes } from './routes';
import { PurchaseSheet, ReportSheet, SignInSheet, UpdateSheet } from './sheets';

type Load = { kind: 'loading' } | { kind: 'missing' } | { kind: 'ready'; listing: BazaarListing; fromCache: boolean };
type SpecState = { kind: 'loading' } | { kind: 'ready'; spec: KalamSpec } | { kind: 'error'; message: string };

const LICENSE: Record<BazaarListing['license'], TranslationKey> = {
  remix_allowed: 'bazaar.license.remix_allowed',
  all_rights_reserved: 'bazaar.license.all_rights_reserved',
  personal: 'bazaar.license.personal',
};

/**
 * Listing details (docs/12 §7, §8, §10.3, §11, §12.3, §14, §15; DIRECTION §6): the cover large on the left with
 * the safe preview under it, the description and "Add to my shelf" on the right, reviews as slips. Credit
 * actions show only when payments are switched on.
 */
export function ListingScreen({ id }: { id: string }) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const { relativeTime } = useFormat(theme.uiLanguage);
  const { isDesktop } = useBreakpoint();
  const toast = useToast();
  const online = useOnline();
  const { user } = useAuthUser();
  const bazaar = getServices().bazaar;
  const payments = bazaar.paymentsEnabled();
  const apps = useAppsStore((s) => s.apps);
  const refreshApps = useAppsStore((s) => s.refresh);

  const [state, setState] = useState<Load>({ kind: 'loading' });
  const [spec, setSpec] = useState<SpecState>({ kind: 'loading' });
  const [shots, setShots] = useState<Screenshot[]>([]);
  const [liked, setLiked] = useState(false);
  const [likes, setLikes] = useState(0);
  const [totals, setTotals] = useState<Pick<BazaarListing, 'ratingAvg' | 'ratingCount'> | null>(null);
  const [busy, setBusy] = useState<'install' | 'remix' | 'like' | 'buy' | null>(null);
  const [signIn, setSignIn] = useState<{ reason: string; then: (u: KalamUser) => void } | null>(null);
  const [reporting, setReporting] = useState(false);
  const [buying, setBuying] = useState<{ credits: number | undefined } | null>(null);
  const [update, setUpdate] = useState<BazaarUpdateCheck | null>(null);
  const [showUpdate, setShowUpdate] = useState(false);
  const [owned, setOwned] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const [showPreview, setShowPreview] = useState(false);

  const load = useCallback(async () => {
    const got = await bazaar.getListing(id).catch(() => undefined);
    if (!got) { setState({ kind: 'missing' }); return; }
    setState({ kind: 'ready', ...got });
    setLikes(got.listing.likes);
    setTotals(null);
    const [s, media] = await Promise.all([bazaar.loadSpec(got.listing), got.listing.screenshotCount ? bazaar.loadMedia(id) : Promise.resolve([])]);
    setSpec(s.ok ? { kind: 'ready', spec: s.spec } : { kind: 'error', message: s.message });
    setOwned(s.ok && got.listing.price > 0);
    setShots(media);
  }, [bazaar, id]);

  useFocusEffect(useCallback(() => {
    void load();
    void refreshApps().catch(() => undefined);
  }, [load, refreshApps]));

  useEffect(() => {
    let alive = true;
    if (user) bazaar.isLiked(id).then((v) => { if (alive) setLiked(v); }, () => undefined);
    else setLiked(false);
    return () => { alive = false; };
  }, [bazaar, id, user]);

  const installed = useMemo(
    () => apps.find((a) => a.spec.meta.basedOn === `${BASED_ON_PREFIX}${id}` && a.spec.meta.source === 'import'),
    [apps, id],
  );
  useEffect(() => {
    let alive = true;
    if (installed && online) bazaar.checkUpdate(installed.id).then((c) => { if (alive) setUpdate(c.available ? c : null); }, () => undefined);
    else setUpdate(null);
    return () => { alive = false; };
  }, [bazaar, installed, online]);

  // One anonymous count per opening, and only when the person turned on "share view counts" in Settings.
  // Above the early return, so it uses the `id` prop (the listing does not exist yet).
  useEffect(() => { void recordListingEvent(id, 'view'); }, [id]);

  if (state.kind !== 'ready') {
    return (
      <AppShell active="bazaar">
        <Screen maxWidth={1100}>
          <BackToBazaar t={t} />
          {state.kind === 'loading' ? (
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 24 }}>
              <ActivityIndicator color={theme.colors.primary} />
              <Text tone="secondary">{t('bazaar.listing.loading')}</Text>
            </View>
          ) : (
            <EmptyState
              title={t('bazaar.listing.missing')}
              description={online ? t('bazaar.listing.removed') : t('bazaar.listing.notSaved')}
              action={<Button label={t('bazaar.listing.backHome')} variant="outline" onPress={() => router.replace(bazaarRoutes.home)} />}
            />
          )}
        </Screen>
      </AppShell>
    );
  }

  const { listing, fromCache } = state;
  const canRemix = listing.remixAllowed;
  const paid = listing.price > 0;
  const isMaker = !!user && user.uid === listing.makerUid;
  const compatible = isCompatible(listing.kalamSpecVersion);
  const rating = totals ?? listing;
  const language = languageInfo(listing.lang);
  const coverWash = theme.scheme === 'dark' ? undefined : clothLabel.bg;

  const requireUser = (reason: string, then: (u: KalamUser) => void) => {
    if (user) then(user);
    else setSignIn({ reason, then });
  };

  const finish = async (r: { ok: boolean; appId?: string; message: string }, mode: 'install' | 'remix') => {
    await refreshApps().catch(() => undefined);
    if (!r.ok || !r.appId) { toast.show({ message: r.message, tone: 'danger' }); return; }
    const appId = r.appId;
    if (mode === 'remix') {
      toast.show({ message: r.message, tone: 'success' });
      router.push(routes.editApp(appId));
    } else {
      toast.show({ message: r.message, tone: 'success', action: { label: t('common.open'), onPress: () => router.push(routes.app(appId)) } });
    }
  };

  const install = async (mode: 'install' | 'remix') => {
    setBusy(mode);
    const r = await bazaar.install(listing, mode);
    setBusy(null);
    await finish(r, mode);
  };

  const startPurchase = () => {
    if (!user || user.isAnonymous) {
      setSignIn({ reason: t('bazaar.listing.buyNeedsAccount'), then: () => undefined });
      return;
    }
    void bazaar.wallet().then((w) => setBuying({ credits: w.wallet?.credits }));
  };

  const toggleLike = () => requireUser(t('bazaar.listing.likeNeedsAccount'), async () => {
    setBusy('like');
    const next = !liked;
    const r = await bazaar.setLiked(listing.id, next);
    setBusy(null);
    if (r.ok) { setLiked(next); setLikes((n) => Math.max(0, n + (next ? 1 : -1))); }
    else toast.show({ message: r.message ?? t('errors.generic'), tone: 'danger' });
  });

  // A paid app cannot be added while payments are off; it says so plainly and never mentions credits.
  const locked = paid && !isMaker && !owned && !installed;
  const primary = installed ? (
    <Button label={t('bazaar.listing.openCopy')} icon={Play} onPress={() => router.push(routes.app(installed.id))} />
  ) : locked && payments ? (
    <Button
      label={t('bazaar.listing.buy', { price: priceText(t, listing.price) })}
      icon={ShoppingBag}
      loading={busy === 'buy'}
      disabled={!!busy || !online || !compatible}
      onPress={startPurchase}
      accessibilityHint={t('bazaar.listing.buyHint')}
    />
  ) : (
    <Button label={t('bazaar.listing.add')} icon={Download} loading={busy === 'install'} disabled={!!busy || !compatible || locked} onPress={() => install('install')} testID="bazaar-add" />
  );

  const actions = (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {primary}
        {installed ? (
          <Button label={t('bazaar.listing.addAnother')} variant="outline" icon={Download} loading={busy === 'install'} disabled={!!busy} onPress={() => install('install')} />
        ) : null}
        {canRemix && (!paid || owned || isMaker) ? (
          <Button label={t('bazaar.listing.remix')} variant="outline" icon={GitFork} loading={busy === 'remix'} disabled={!!busy || !compatible} onPress={() => install('remix')}
            accessibilityHint={t('bazaar.listing.remixHint')} />
        ) : null}
        <Button
          label={t(liked ? 'bazaar.listing.liked' : 'bazaar.listing.like', { count: likes })}
          variant={liked ? 'secondary' : 'ghost'}
          icon={Heart}
          loading={busy === 'like'}
          disabled={!!busy || !online}
          onPress={toggleLike}
        />
        <Button label={t('bazaar.listing.report')} variant="ghost" icon={Flag} disabled={!online} onPress={() => requireUser(t('bazaar.listing.reportNeedsAccount'), () => setReporting(true))} />
      </View>
      {locked && !payments ? <Text variant="bodySmall" tone="muted">{t('bazaar.listing.paidOff')}</Text> : null}
      {!compatible ? <Text variant="bodySmall" tone="warning">{t('bazaar.listing.needsNewer')}</Text> : null}
    </View>
  );

  const preview = (
    <Preview key={previewKey} listing={listing} spec={spec} online={online} payments={payments} onReset={() => setPreviewKey((k) => k + 1)} />
  );
  const cover = (
    <Register
      cloth={clothForColor(listing.appColor)}
      name={listing.title}
      lang={listing.lang}
      subtitle={t('bazaar.by', { name: listing.makerName })}
      stat={t('bazaar.installs', { count: listing.installs })}
      height={isDesktop ? 440 : 320}
      footer={listing.status === 'published' ? <Stamp kind="checked" label={statusText(t, listing)} size="sm" wash={coverWash} /> : null}
    />
  );

  return (
    <AppShell active="bazaar">
      <Screen maxWidth={1180}>
        <BackToBazaar t={t} />
        {fromCache ? <OfflineNote>{t('bazaar.listing.savedCopy')}</OfflineNote> : null}
        {update ? (
          <Surface tone="primarySoft" padded={14} style={{ flexDirection: 'row', gap: 10, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }} role="status">
            <RefreshCw size={18} color={theme.colors.primary} />
            <Text style={{ flex: 1, minWidth: 200 }}>{t('bazaar.update.available', { next: update.listing?.specVersion ?? '', mine: update.installedVersion ?? '' })}</Text>
            <Button label={t('bazaar.update.review')} size="sm" variant="outline" onPress={() => setShowUpdate(true)} />
          </Surface>
        ) : null}

        <View style={{ flexDirection: isDesktop ? 'row' : 'column', gap: isDesktop ? 48 : 28, alignItems: 'flex-start' }}>
          <View style={{ width: isDesktop ? 380 : '100%', gap: 20 }}>
            <View style={{ width: isDesktop ? 300 : 230, alignSelf: isDesktop ? 'flex-start' : 'center' }}>{cover}</View>
            {isDesktop || showPreview ? preview : (
              <Button label={t('bazaar.preview.try')} variant="outline" icon={Play} onPress={() => setShowPreview(true)} accessibilityHint={t('bazaar.preview.tryHint')} />
            )}
          </View>

          <View style={{ flex: 1, minWidth: 0, gap: 28, width: isDesktop ? undefined : '100%' }}>
            <View style={{ gap: 6 }}>
              <Text variant="h1" {...({ lang: listing.lang } as object)}>{listing.title}</Text>
              <Text mono tone="secondary">{t('bazaar.by', { name: listing.makerName })}</Text>
            </View>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {listing.status === 'published'
                ? <Stamp kind="checked" label={statusText(t, listing)} />
                : <Stamp kind="needs" label={statusText(t, listing)} />}
              {listing.featured ? <Stamp kind="plain" label={t('bazaar.featuredByTeam')} /> : null}
              {listing.disclosure.aiFeatures.length ? null : <Stamp kind="template" icon={OfflineIcon} label={t('bazaar.listing.fullyOffline')} />}
              <Stamp kind="plain" icon={null} label={t(CATEGORY[listing.category])} />
              <Stamp kind="plain" icon={null} label={language.native} />
              {payments ? <Stamp kind="plain" icon={null} label={priceText(t, listing.price)} /> : null}
            </View>

            {actions}

            <Text variant="bodyLarge">{listing.description}</Text>
            {SENSITIVE_CATEGORIES.has(listing.category) ? (
              <Text variant="bodySmall" tone="muted">{t(listing.category === 'health' ? 'bazaar.listing.health' : 'bazaar.listing.finance')}</Text>
            ) : null}

            {shots.length ? <Screenshots shots={shots} /> : null}

            <Section title={t('bazaar.listing.does')}>
              {listing.capabilities.length
                ? listing.capabilities.map((c) => <Bullet key={c}>{c}</Bullet>)
                : <Text tone="secondary">{t('bazaar.listing.doesNothing')}</Text>}
            </Section>

            <Section title={t('bazaar.listing.data')}>
              <Bullet>
                {listing.disclosure.stores.length
                  ? t('bazaar.listing.keeps', { what: listing.disclosure.stores.join(', ').toLowerCase() })
                  : t('bazaar.listing.keepsNothing')}
              </Bullet>
              <Bullet>{t('bazaar.listing.makerCannotSee')}</Bullet>
              {listing.disclosure.usesPhotos ? <Bullet>{t('bazaar.listing.photos')}</Bullet> : null}
            </Section>

            {listing.disclosure.permissions?.length ? (
              <Section title={t('bazaar.listing.permissions')}>
                {listing.disclosure.permissions.map((line) => <Bullet key={line}>{line}</Bullet>)}
              </Section>
            ) : null}

            <Section title={t('bazaar.listing.ai')}>
              {listing.disclosure.aiFeatures.length ? (
                <>
                  {listing.disclosure.aiFeatures.map((f) => (
                    <View key={f} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                      <Sparkles size={16} color={theme.colors.primary} style={{ marginTop: 3 }} />
                      <Text style={{ flex: 1 }}>{f}</Text>
                    </View>
                  ))}
                  <Text tone="secondary">{t('bazaar.listing.aiExplain')}</Text>
                </>
              ) : <Text tone="secondary">{t('bazaar.listing.aiNone')}</Text>}
            </Section>

            <Section title={t('bazaar.listing.access')}>
              <Bullet>{t('bazaar.listing.accessModes')}</Bullet>
              <Bullet>{t('bazaar.listing.labelsIn', { language: language.code === 'en' ? language.english : `${language.native} (${language.english})` })}</Bullet>
            </Section>

            <Section title={t('bazaar.listing.safety')}>
              <Text tone="secondary">
                {t(listing.reviewed ? 'bazaar.listing.safetyReviewed' : 'bazaar.listing.safetyAuto')} {t('bazaar.listing.safetyData')}
              </Text>
            </Section>

            <ReviewsSection listing={{ ...listing, ...rating }} user={user} online={online && !fromCache} onTotals={setTotals} />

            <Section title={t('bazaar.listing.details')}>
              <Detail label={t('shelf.details.version')} value={`${listing.specVersion}${listing.changeSummary ? `. ${listing.changeSummary}` : ''}`} />
              <Detail label={t('bazaar.listing.updated')} value={relativeTime(listing.updatedAt)} />
              <Detail label={t('bazaar.listing.rating')} value={ratingText(t, rating)} />
              <Detail label={t('bazaar.listing.installsLabel')} value={t('bazaar.installs', { count: listing.installs })} />
              <Detail label={t('bazaar.listing.worksWith')} value={compatible ? t('bazaar.listing.worksWithKalam', { major: listing.kalamSpecVersion.split('.')[0] ?? '1' }) : t('bazaar.listing.newerKalam')} />
              <Detail label={t('bazaar.listing.license')} value={t(LICENSE[listing.license])} />
              {listing.basedOn ? (
                <Detail
                  label={t('bazaar.listing.basedOn')}
                  value={listing.basedOn.title ? t('bazaar.listing.basedOnBy', { title: listing.basedOn.title, name: listing.basedOn.makerName }) : t('bazaar.listing.basedOnOther')}
                  onPress={() => router.push(bazaarRoutes.listing(listing.basedOn!.listingId))}
                  mono
                />
              ) : null}
            </Section>
          </View>
        </View>
      </Screen>

      <SignInSheet
        visible={!!signIn}
        reason={signIn?.reason ?? ''}
        onClose={() => setSignIn(null)}
        onDone={(u) => { const next = signIn?.then; setSignIn(null); next?.(u); }}
      />
      <ReportSheet
        visible={reporting}
        title={listing.title}
        onClose={() => setReporting(false)}
        onSend={async (reason, note) => {
          const r = await bazaar.report(listing.id, reason, note);
          setReporting(false);
          toast.show({ message: r.message, tone: r.ok ? 'success' : 'danger' });
        }}
      />
      {buying && payments ? (
        <PurchaseSheet
          visible
          listing={listing}
          credits={buying.credits}
          onClose={() => setBuying(null)}
          onConfirm={async () => {
            setBusy('buy');
            const r = await bazaar.purchase(listing);
            setBusy(null);
            setBuying(null);
            if (r.ok) setOwned(true);
            await finish(r, 'install');
          }}
        />
      ) : null}
      {update && installed ? (
        <UpdateSheet
          visible={showUpdate}
          check={update}
          onClose={() => setShowUpdate(false)}
          onApply={async (mode) => {
            const r = await bazaar.applyUpdate(installed.id, mode);
            setShowUpdate(false);
            await refreshApps().catch(() => undefined);
            toast.show({ message: r.message, tone: r.ok ? 'success' : 'danger' });
            if (r.ok) setUpdate(null);
          }}
        />
      ) : null}
    </AppShell>
  );
}

function Screenshots({ shots }: { shots: Screenshot[] }) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }} accessibilityLabel={t('bazaar.listing.screenshots')}>
      {shots.map((s, i) => (
        <Image
          key={i}
          source={{ uri: `data:${s.mimeType};base64,${s.base64}` }}
          accessibilityLabel={t('bazaar.listing.screenshot', { n: i + 1, total: shots.length })}
          style={{
            width: Math.round((s.width / s.height) * 320), height: 320, borderRadius: theme.radius.paper,
            borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceAlt,
          }}
        />
      ))}
    </ScrollView>
  );
}

/** Sandbox preview (docs/12 §8): synthetic records in memory, AI blocks off, nothing saved or sent. */
function Preview({ listing, spec, online, payments, onReset }: {
  listing: BazaarListing;
  spec: SpecState;
  online: boolean;
  payments: boolean;
  onReset: () => void;
}) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const accessModes = useAccessModes();
  const previewId = `preview_${listing.id}`.slice(0, 63);
  useEffect(() => { void recordListingEvent(listing.id, 'preview'); }, [listing.id]);
  const seed = spec.kind === 'ready' ? spec.spec : undefined;
  const services = useMemo(() => ({
    // Synthetic demo records only (docs/12 §8.3); nothing here touches the device database.
    ...createMemoryRuntimeServices(previewId, seed ? { records: sampleRecords(seed, previewId, Date.now()) } : undefined),
    runAIBlock: async (): Promise<AIExecutionResult<Record<string, RecordValue>>> => ({
      success: false, provider: 'none', source: 'deterministic', latencyMs: 0, fallbackUsed: false, errorCode: 'not_configured',
    }),
  }), [previewId, seed]);

  return (
    <Surface padded={0} style={{ overflow: 'hidden' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderBottomWidth: 1, borderColor: theme.colors.border }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text weight="semibold">{t('bazaar.preview.title')}</Text>
          <Text variant="bodySmall" tone="muted">{t('bazaar.preview.hint')}</Text>
        </View>
        {spec.kind === 'ready' ? <Button label={t('bazaar.preview.reset')} size="sm" variant="ghost" icon={RotateCcw} onPress={onReset} /> : null}
      </View>
      <View style={{ height: 600, backgroundColor: theme.colors.background }}>
        {spec.kind === 'ready' ? (
          <KalamRuntime spec={spec.spec} appId={previewId} services={services} mode="preview" accessModes={accessModes} />
        ) : spec.kind === 'loading' ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 }}>
            <ActivityIndicator color={theme.colors.primary} />
            <Text tone="secondary">{t('bazaar.preview.loading')}</Text>
          </View>
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 }}>
            <ShieldAlert size={28} color={theme.colors.textMuted} />
            <Text align="center" tone="secondary">
              {listing.price > 0 ? t(payments ? 'bazaar.preview.paid' : 'bazaar.preview.paidOff') : online ? spec.message : t('bazaar.preview.needsInternet')}
            </Text>
          </View>
        )}
      </View>
    </Surface>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 10 }}>
      <Text variant="h4">{title}</Text>
      <View style={{ gap: 8 }}>{children}</View>
    </View>
  );
}

function Bullet({ children }: { children: ReactNode }) {
  const theme = useKalamTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      <View style={{ width: 6, height: 6, borderRadius: 1, backgroundColor: theme.colors.mark, marginTop: 9 }} />
      <Text style={{ flex: 1 }}>{children}</Text>
    </View>
  );
}

function Detail({ label, value, onPress, mono }: { label: string; value: string; onPress?: () => void; mono?: boolean }) {
  const theme = useKalamTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 16, paddingVertical: 8, borderBottomWidth: 1, borderColor: theme.colors.border, flexWrap: 'wrap' }}>
      <Text tone="secondary" style={{ width: 120 }}>{label}</Text>
      {onPress ? <Button label={value} variant="link" size="sm" onPress={onPress} /> : <Text mono={mono} style={{ flex: 1, minWidth: 160 }}>{value}</Text>}
    </View>
  );
}
