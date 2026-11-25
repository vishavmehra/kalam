import { router, useFocusEffect } from 'expo-router';
import {
  ArrowLeft, BadgeCheck, CloudOff, Download, Flag, GitFork, Heart, Play, RefreshCw, RotateCcw, ShieldAlert, ShoppingBag,
  Sparkles,
} from 'lucide-react-native';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, View } from 'react-native';

import { relativeTime } from '@/components/format';
import { AppShell } from '@/components/shell/AppShell';
import { routes } from '@/components/shell/routes';
import { useOnline } from '@/components/status/useHybridStatus';
import {
  BASED_ON_PREFIX, CATEGORY_LABELS, isCompatible, LICENSE_LABELS, priceLabel, sampleRecords, SENSITIVE_CATEGORIES,
  statusLabel, type BazaarListing, type Screenshot,
} from '@/core/bazaar';
import type { AIExecutionResult, BazaarUpdateCheck, KalamUser, RecordValue } from '@/core/contracts';
import { languageName } from '@/core/spec/describe';
import type { KalamSpec } from '@/core/spec/schema';
import { Button, Chip, EmptyState, Screen, Surface, Text, useBreakpoint, useKalamTheme, useToast } from '@/design';
import { useAuthUser } from '@/features/auth/use-auth';
import { KalamRuntime } from '@/runtime/KalamRuntime';
import { createMemoryRuntimeServices } from '@/runtime/memory-services';
import { useAccessModes } from '@/runtime/RunAppScreen';
import { getServices } from '@/services';
import { useAppsStore } from '@/state/apps-store';

import { countLabel, ratingLabel } from './ListingCard';
import { ListingIcon } from './ListingIcon';
import { ReviewsSection } from './ReviewsSection';
import { bazaarRoutes } from './routes';
import { PurchaseSheet, ReportSheet, SignInSheet, UpdateSheet } from './sheets';

type Load = { kind: 'loading' } | { kind: 'missing' } | { kind: 'ready'; listing: BazaarListing; fromCache: boolean };
type SpecState = { kind: 'loading' } | { kind: 'ready'; spec: KalamSpec } | { kind: 'error'; message: string };

/**
 * Listing details, safe preview, install or purchase, remix, updates, likes, reviews and reports
 * (docs/12 §7, §8, §10.3, §11, §12.3, §14, §15).
 */
export function ListingScreen({ id }: { id: string }) {
  const theme = useKalamTheme();
  const { isDesktop } = useBreakpoint();
  const toast = useToast();
  const online = useOnline();
  const { user } = useAuthUser();
  const bazaar = getServices().bazaar;
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

  if (state.kind !== 'ready') {
    return (
      <AppShell active="bazaar">
        <Screen maxWidth={1100}>
          <BackLink />
          {state.kind === 'loading' ? (
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 24 }}>
              <ActivityIndicator color={theme.colors.primary} />
              <Text tone="secondary">Loading app details</Text>
            </View>
          ) : (
            <EmptyState
              title="This app is not available"
              description={online ? 'It may have been removed by its maker.' : 'You are offline, and this app was not saved on this device.'}
              action={<Button label="Back to Kalam Bazaar" variant="outline" onPress={() => router.replace(bazaarRoutes.home)} />}
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
      toast.show({ message: r.message, tone: 'success', action: { label: 'Open', onPress: () => router.push(routes.app(appId)) } });
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
      setSignIn({ reason: 'Buying apps needs an account with email or Google.', then: () => undefined });
      return;
    }
    void bazaar.wallet().then((w) => setBuying({ credits: w.wallet?.credits }));
  };

  const toggleLike = () => requireUser('Sign in to like apps. A guest account is enough.', async () => {
    setBusy('like');
    const next = !liked;
    const r = await bazaar.setLiked(listing.id, next);
    setBusy(null);
    if (r.ok) { setLiked(next); setLikes((n) => Math.max(0, n + (next ? 1 : -1))); }
    else toast.show({ message: r.message ?? 'Could not save that.', tone: 'danger' });
  });

  const primary = installed ? (
    <Button label="Open your copy" icon={Play} onPress={() => router.push(routes.app(installed.id))} />
  ) : paid && !isMaker && !owned ? (
    <Button
      label={`Buy for ${priceLabel(listing.price)}`}
      icon={ShoppingBag}
      loading={busy === 'buy'}
      disabled={!!busy || !online || !bazaar.paymentsEnabled() || !compatible}
      onPress={startPurchase}
      accessibilityHint="Shows the price and your balance before anything is charged."
    />
  ) : (
    <Button label="Install" icon={Download} loading={busy === 'install'} disabled={!!busy || !compatible} onPress={() => install('install')} />
  );

  const actions = (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {primary}
        {installed ? (
          <Button label="Install another copy" variant="outline" icon={Download} loading={busy === 'install'} disabled={!!busy} onPress={() => install('install')} />
        ) : null}
        {canRemix && (!paid || owned || isMaker) ? (
          <Button label="Remix" variant="outline" icon={GitFork} loading={busy === 'remix'} disabled={!!busy || !compatible} onPress={() => install('remix')}
            accessibilityHint="Makes your own copy to change. The original maker stays credited." />
        ) : null}
        <Button
          label={`${liked ? 'Liked' : 'Like'} (${likes})`}
          variant={liked ? 'secondary' : 'ghost'}
          icon={Heart}
          loading={busy === 'like'}
          disabled={!!busy || !online}
          onPress={toggleLike}
        />
        <Button label="Report" variant="ghost" icon={Flag} disabled={!online} onPress={() => requireUser('Sign in to report an app. A guest account is enough.', () => setReporting(true))} />
      </View>
      {paid && !bazaar.paymentsEnabled() && !installed && !owned ? (
        <Text variant="bodySmall" tone="muted">Paid apps cannot be bought yet. Credits are not switched on in this build.</Text>
      ) : null}
      {!compatible ? <Text variant="bodySmall" tone="warning">This app needs a newer version of Kalam. Update Kalam to install it.</Text> : null}
    </View>
  );

  const preview = (
    <Preview key={previewKey} listing={listing} spec={spec} online={online} onReset={() => setPreviewKey((k) => k + 1)} />
  );

  return (
    <AppShell active="bazaar">
      <Screen maxWidth={1180}>
        <BackLink />
        {fromCache ? (
          <Surface tone="alt" padded={14} style={{ flexDirection: 'row', gap: 10, alignItems: 'center', marginBottom: 20 }} role="status">
            <CloudOff size={18} color={theme.colors.warning} />
            <Text style={{ flex: 1 }}>You are offline. This is a saved copy of the listing. Buying, likes, reviews and reports need a connection.</Text>
          </Surface>
        ) : null}
        {update ? (
          <Surface tone="primarySoft" padded={14} style={{ flexDirection: 'row', gap: 10, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }} role="status">
            <RefreshCw size={18} color={theme.colors.primary} />
            <Text style={{ flex: 1, minWidth: 200 }}>
              Version {update.listing?.specVersion} is available. You have version {update.installedVersion}.
            </Text>
            <Button label="Review the update" size="sm" variant="outline" onPress={() => setShowUpdate(true)} />
          </Surface>
        ) : null}

        <View style={{ flexDirection: isDesktop ? 'row' : 'column', gap: 40, alignItems: 'flex-start' }}>
          <View style={{ flex: 1, minWidth: 0, gap: 28, width: isDesktop ? undefined : '100%' }}>
            <View style={{ flexDirection: 'row', gap: 18, alignItems: 'center' }}>
              <ListingIcon listing={listing} size={72} />
              <View style={{ flex: 1, gap: 4 }}>
                <Text variant="h1">{listing.title}</Text>
                <Text tone="secondary">by {listing.makerName}</Text>
              </View>
            </View>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Chip label={priceLabel(listing.price)} tone={paid ? 'accent' : 'success'} />
              <Chip label={CATEGORY_LABELS[listing.category]} tone="neutral" />
              <Chip label={languageName(listing.lang)} tone="neutral" />
              {listing.featured ? <Chip label="Featured by the Kalam team" tone="info" /> : null}
              <Chip
                label={statusLabel(listing)}
                tone={listing.status !== 'published' ? 'warning' : listing.reviewed ? 'success' : 'info'}
                icon={listing.status === 'published' ? BadgeCheck : undefined}
              />
            </View>

            {actions}

            <Text variant="bodyLarge">{listing.description}</Text>
            {SENSITIVE_CATEGORIES.has(listing.category) ? (
              <Text variant="bodySmall" tone="muted">
                {listing.category === 'health'
                  ? 'This app is for keeping your own notes. It is not medical advice and has not been checked by a doctor.'
                  : 'This app is for keeping your own records. It is not financial advice.'}
              </Text>
            ) : null}

            {shots.length ? <Screenshots shots={shots} /> : null}

            {!isDesktop ? (
              showPreview ? preview : (
                <Button label="Try it first" variant="outline" icon={Play} onPress={() => setShowPreview(true)}
                  accessibilityHint="Opens a preview with made-up entries. Nothing you type is saved." />
              )
            ) : null}

            <Section title="What it does">
              {listing.capabilities.length
                ? listing.capabilities.map((c) => <Bullet key={c}>{c}</Bullet>)
                : <Text tone="secondary">Shows information. It has no buttons that save or change data.</Text>}
            </Section>

            <Section title="Your data">
              <Bullet>
                {listing.disclosure.stores.length
                  ? `Keeps ${listing.disclosure.stores.join(', ').toLowerCase()} on your device.`
                  : 'Does not keep any records.'}
              </Bullet>
              <Bullet>The maker cannot see anything you enter. Your copy is yours.</Bullet>
              {listing.disclosure.usesPhotos ? <Bullet>Can use photos you choose.</Bullet> : null}
              <Bullet>No account is needed to use it.</Bullet>
            </Section>

            <Section title="AI features">
              {listing.disclosure.aiFeatures.length ? (
                <>
                  {listing.disclosure.aiFeatures.map((f) => (
                    <View key={f} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                      <Sparkles size={16} color={theme.colors.accent} style={{ marginTop: 3 }} />
                      <Text style={{ flex: 1 }}>{f}</Text>
                    </View>
                  ))}
                  <Text tone="secondary">
                    These try the AI on your device first. If that is not possible, they may use Firebase cloud AI, which needs the internet. The text or photo you give them is sent for that one task. Each AI feature is checked again on your device before it runs offline.
                  </Text>
                </>
              ) : <Text tone="secondary">This app has no AI features. Everything works offline.</Text>}
            </Section>

            <Section title="Accessibility and languages">
              <Bullet>Works with Kalam's Large, High contrast, Simple and Read aloud modes.</Bullet>
              <Bullet>Labels are in {languageName(listing.lang)}.</Bullet>
            </Section>

            <Section title="Safety">
              <Text tone="secondary">
                {listing.reviewed
                  ? 'This app was reviewed by the Kalam team.'
                  : 'This app passed automatic checks when it was shared. It has not been reviewed by a person.'}{' '}
                Kalam checks the app design again on your device before installing it. Apps in Kalam are data, not code, so they cannot run programs on your device.
              </Text>
            </Section>

            <ReviewsSection listing={{ ...listing, ...rating }} user={user} online={online && !fromCache} onTotals={setTotals} />

            <Section title="Details">
              <Detail label="Version" value={`${listing.specVersion}${listing.changeSummary ? `. ${listing.changeSummary}` : ''}`} />
              <Detail label="Updated" value={relativeTime(listing.updatedAt)} />
              <Detail label="Rating" value={ratingLabel(rating)} />
              <Detail label="Installs" value={countLabel(listing.installs, 'install', 'installs')} />
              <Detail label="Works with" value={compatible ? `Kalam ${listing.kalamSpecVersion.split('.')[0]}.x and this device` : 'A newer version of Kalam'} />
              <Detail label="Licence" value={LICENSE_LABELS[listing.license]} />
              {listing.basedOn ? (
                <Detail
                  label="Based on"
                  value={listing.basedOn.title ? `${listing.basedOn.title} by ${listing.basedOn.makerName}` : 'Another Kalam Bazaar app'}
                  onPress={() => router.push(bazaarRoutes.listing(listing.basedOn!.listingId))}
                />
              ) : null}
            </Section>
          </View>

          {isDesktop ? <View style={{ width: 400, gap: 12 }}>{preview}</View> : null}
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
      {buying ? (
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
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }} accessibilityLabel="Screenshots">
      {shots.map((s, i) => (
        <Image
          key={i}
          source={{ uri: `data:${s.mimeType};base64,${s.base64}` }}
          accessibilityLabel={`Screenshot ${i + 1} of ${shots.length}`}
          style={{
            width: Math.round((s.width / s.height) * 320), height: 320, borderRadius: theme.radius.md,
            borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceAlt,
          }}
        />
      ))}
    </ScrollView>
  );
}

/** Sandbox preview (docs/12 §8): synthetic records in memory, AI blocks off, nothing saved or sent. */
function Preview({ listing, spec, online, onReset }: {
  listing: BazaarListing;
  spec: SpecState;
  online: boolean;
  onReset: () => void;
}) {
  const theme = useKalamTheme();
  const accessModes = useAccessModes();
  const previewId = `preview_${listing.id}`.slice(0, 63);
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
          <Text weight="semibold">Preview</Text>
          <Text variant="bodySmall" tone="muted">Try it with made-up sample entries. AI features are off in the preview.</Text>
        </View>
        {spec.kind === 'ready' ? <Button label="Start over" size="sm" variant="ghost" icon={RotateCcw} onPress={onReset} /> : null}
      </View>
      <View style={{ height: 600, backgroundColor: theme.colors.background }}>
        {spec.kind === 'ready' ? (
          <KalamRuntime spec={spec.spec} appId={previewId} services={services} mode="preview" accessModes={accessModes} />
        ) : spec.kind === 'loading' ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 }}>
            <ActivityIndicator color={theme.colors.primary} />
            <Text tone="secondary">Getting the app</Text>
          </View>
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 }}>
            <ShieldAlert size={28} color={theme.colors.textMuted} />
            <Text align="center" tone="secondary">
              {listing.price > 0 ? 'Buy this app to try it. Paid apps have no free preview yet.' : online ? spec.message : 'The preview needs the internet the first time.'}
            </Text>
          </View>
        )}
      </View>
    </Surface>
  );
}

function BackLink() {
  return (
    <View style={{ alignSelf: 'flex-start', marginBottom: 16, marginLeft: -8 }}>
      <Button label="Kalam Bazaar" variant="ghost" size="sm" icon={ArrowLeft}
        onPress={() => (router.canGoBack() ? router.back() : router.replace(bazaarRoutes.home))} />
    </View>
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
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: theme.colors.textMuted, marginTop: 8 }} />
      <Text style={{ flex: 1 }}>{children}</Text>
    </View>
  );
}

function Detail({ label, value, onPress }: { label: string; value: string; onPress?: () => void }) {
  const theme = useKalamTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 16, paddingVertical: 8, borderBottomWidth: 1, borderColor: theme.colors.border, flexWrap: 'wrap' }}>
      <Text tone="secondary" style={{ width: 120 }}>{label}</Text>
      {onPress ? <Button label={value} variant="link" size="sm" onPress={onPress} /> : <Text style={{ flex: 1, minWidth: 160 }}>{value}</Text>}
    </View>
  );
}
