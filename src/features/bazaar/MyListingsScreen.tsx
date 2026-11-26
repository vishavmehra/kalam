import { router, useFocusEffect } from 'expo-router';
import { Eye, EyeOff, FilePen, PenLine, RefreshCw, Upload } from 'lucide-react-native';
import { type ReactNode, useCallback, useState } from 'react';
import { View } from 'react-native';

import { AppShell } from '@/components/shell/AppShell';
import { useOnline } from '@/components/status/useHybridStatus';
import { makerActions, type BazaarListing, type ListingStatus, type MakerAction } from '@/core/bazaar';
import type { BazaarCreatorStats, BazaarDraft } from '@/core/contracts';
import { Button, ConfirmSheet, EmptyState, Screen, Slip, Stamp, type StampKind, Text, useKalamTheme, useToast } from '@/design';
import { SignInPanel } from '@/features/auth/SignInPanel';
import { ListingCountsLine } from '@/features/bazaar-moderation/ListingCountsLine';
import { useAuthUser } from '@/features/auth/use-auth';
import type { TranslationKey } from '@/i18n/keys';
import { useFormat, useT } from '@/i18n/react';
import { getServices } from '@/services';
import { useAppsStore } from '@/state/apps-store';

import { ListingIcon } from './ListingIcon';
import { BackToBazaar, Busy, OfflineNote, PageHead, priceText, ratingText, Section, statusText } from './parts';
import { bazaarRoutes } from './routes';

const STAMP: Record<ListingStatus, StampKind> = {
  published: 'checked', pending_review: 'needs', rejected: 'needs', unpublished: 'plain', suspended: 'needs',
};

const ACTION: Record<MakerAction, { label: TranslationKey; icon: typeof Eye }> = {
  view: { label: 'bazaar.studio.action.view', icon: Eye },
  edit_details: { label: 'bazaar.studio.action.edit', icon: PenLine },
  new_version: { label: 'bazaar.studio.action.newVersion', icon: Upload },
  unpublish: { label: 'bazaar.studio.action.unpublish', icon: EyeOff },
  recheck: { label: 'bazaar.studio.action.recheck', icon: RefreshCw },
  show_again: { label: 'bazaar.studio.action.showAgain', icon: RefreshCw },
};

/** Creator Studio (docs/12 §13): dashboard, drafts, listings with their state and the actions it allows. */
export function MyListingsScreen() {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const { relativeTime } = useFormat(theme.uiLanguage);
  const toast = useToast();
  const online = useOnline();
  const { user, restoring, configured } = useAuthUser();
  const bazaar = getServices().bazaar;
  const payments = bazaar.paymentsEnabled();
  const apps = useAppsStore((s) => s.apps);
  const [listings, setListings] = useState<BazaarListing[] | null>(null);
  const [stats, setStats] = useState<BazaarCreatorStats | null>(null);
  const [drafts, setDrafts] = useState<BazaarDraft[]>([]);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [toHide, setToHide] = useState<BazaarListing | null>(null);

  const load = useCallback(async () => {
    setDrafts(await bazaar.drafts());
    if (!user || !online) return;
    try {
      const mine = await bazaar.myListings();
      setListings(mine);
      setStats(await bazaar.creatorStats(mine));
      setError(false);
    } catch {
      setError(true);
    }
  }, [bazaar, user, online]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const act = async (id: string, fn: () => Promise<{ ok: boolean; message: string }>) => {
    setBusy(id);
    const r = await fn().catch(() => ({ ok: false, message: t('errors.generic') }));
    setBusy(null);
    toast.show({ message: r.message, tone: r.ok ? 'success' : 'danger' });
    await load();
  };

  const run = (l: BazaarListing, a: MakerAction) => {
    switch (a) {
      case 'view': return router.push(bazaarRoutes.listing(l.id));
      case 'edit_details': return router.push(bazaarRoutes.publish({ listingId: l.id, mode: 'details' }));
      case 'new_version': return router.push(bazaarRoutes.publish({ listingId: l.id }));
      case 'unpublish': return setToHide(l);
      case 'recheck':
      case 'show_again': return void act(l.id, () => bazaar.recheck(l.id));
    }
  };

  const draftsBlock = drafts.length ? (
    <Section title={t('bazaar.studio.drafts')} note={t('bazaar.studio.draftsNote')}>
      {drafts.map((d) => {
        const app = apps.find((a) => a.id === d.appId);
        return (
          <View key={`${d.appId}${d.listingId ?? ''}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap', paddingVertical: 10, borderBottomWidth: 1, borderColor: theme.colors.border }}>
            <FilePen size={18} color={theme.colors.textMuted} />
            <View style={{ flex: 1, minWidth: 180 }}>
              <Text weight="semibold" numberOfLines={1}>{d.form.title || app?.spec.name || t('bazaar.studio.untitled')}</Text>
              <Text variant="caption" tone="muted">
                {t('bazaar.studio.saved', { when: relativeTime(d.savedAt) })}{app ? '' : ` ${t('bazaar.studio.appGone')}`}
              </Text>
            </View>
            {app ? <Button label={t('common.continue')} size="sm" variant="outline" onPress={() => router.push(bazaarRoutes.publish({ appId: d.appId, listingId: d.listingId }))} /> : null}
            <Button label={t('common.delete')} size="sm" variant="ghost" onPress={async () => { await bazaar.removeDraft(d.appId); setDrafts(await bazaar.drafts()); }} />
          </View>
        );
      })}
    </Section>
  ) : null;

  let body: ReactNode;
  if (!configured) body = <EmptyState title={t('bazaar.notSetUp.title')} description={t('bazaar.notSetUp.studio')} />;
  else if (restoring) body = <Busy text={t('bazaar.studio.checkingAccount')} />;
  else if (!user || user.isAnonymous) {
    body = (
      <View style={{ gap: 24 }}>
        {draftsBlock}
        <Slip tint="carbon" style={{ maxWidth: 520 }}>
          <Text variant="h3">{t('bazaar.studio.signIn')}</Text>
          <SignInPanel />
        </Slip>
      </View>
    );
  } else if (!online) {
    body = (
      <View style={{ gap: 24 }}>
        <OfflineNote>{t('bazaar.studio.offline')}</OfflineNote>
        {draftsBlock}
      </View>
    );
  } else if (error) {
    body = <EmptyState title={t('errors.generic')} description={t('bazaar.studio.loadFailed')} action={<Button label={t('common.tryAgain')} variant="outline" onPress={load} />} />;
  } else if (!listings) {
    body = <Busy text={t('bazaar.studio.loading')} />;
  } else {
    body = (
      <View style={{ gap: 32 }}>
        {stats && listings.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }} accessibilityRole="summary">
            <Stat label={t('bazaar.studio.stat.live')} value={String(stats.published)} />
            <Stat label={t('bazaar.studio.stat.waiting')} value={String(stats.waiting)} />
            <Stat label={t('bazaar.studio.stat.changes')} value={String(stats.needsChanges)} />
            <Stat label={t('bazaar.listing.installsLabel')} value={String(stats.installs)} />
            <Stat label={t('bazaar.studio.stat.likes')} value={String(stats.likes)} />
            <Stat label={t('bazaar.listing.rating')} value={stats.ratingCount ? `${stats.ratingAvg.toFixed(1)} (${stats.ratingCount})` : t('bazaar.studio.stat.noneYet')} />
            {payments ? <Stat label={t('bazaar.studio.stat.earned')} value={String(stats.creditsEarned)} /> : null}
          </View>
        ) : null}
        {draftsBlock}
        <Section title={t('bazaar.studio.listings')}>
          {!listings.length ? (
            <EmptyState
              title={t('bazaar.studio.emptyTitle')}
              description={t('bazaar.studio.emptyBody')}
              action={<Button label={t('bazaar.share')} icon={Upload} onPress={() => router.push(bazaarRoutes.publish())} />}
            />
          ) : (
            <View style={{ gap: 14 }} role="list">
              {listings.map((l) => (
                <View key={l.id} role="listitem">
                  <Slip tint="kraft">
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                      <ListingIcon listing={l} size={44} />
                      <View style={{ flex: 1, minWidth: 200, gap: 6 }}>
                        <Text variant="h4" numberOfLines={1}>{l.title}</Text>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                          <Stamp kind={STAMP[l.status]} label={statusText(t, l)} size="sm" />
                          {payments ? <Stamp kind="plain" icon={null} label={priceText(t, l.price)} size="sm" /> : null}
                          <Text variant="caption" tone="muted" mono>{t('bazaar.studio.versionUpdated', { version: l.specVersion, when: relativeTime(l.updatedAt) })}</Text>
                        </View>
                      </View>
                      <Text variant="caption" tone="muted" mono style={{ minWidth: 140 }}>
                        {`${t('bazaar.installs', { count: l.installs })}\n${t('bazaar.likes', { count: l.likes })}\n${ratingText(t, l)}`}
                      </Text>
                    </View>
                    {(l.status === 'rejected' || l.status === 'pending_review' || l.status === 'suspended') && l.safety.reasons.length ? (
                      <View style={{ gap: 4 }}>
                        {l.safety.reasons.map((r) => <Text key={r} variant="bodySmall" tone={l.status === 'pending_review' ? 'secondary' : 'danger'}>{r}</Text>)}
                      </View>
                    ) : null}
                    {l.status === 'suspended' ? <Text variant="bodySmall" tone="danger">{t('bazaar.studio.suspended')}</Text> : null}
                    {l.status === 'published' ? <ListingCountsLine listingId={l.id} /> : null}
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                      {makerActions(l.status).map((a) => (
                        <Button
                          key={a}
                          label={t(ACTION[a].label)}
                          icon={ACTION[a].icon}
                          size="sm"
                          variant={a === 'view' || a === 'recheck' || a === 'show_again' ? 'outline' : 'ghost'}
                          loading={busy === l.id && (a === 'recheck' || a === 'show_again')}
                          disabled={!!busy}
                          onPress={() => run(l, a)}
                        />
                      ))}
                    </View>
                  </Slip>
                </View>
              ))}
            </View>
          )}
        </Section>
      </View>
    );
  }

  return (
    <AppShell active="bazaar">
      <Screen maxWidth={900}>
        <BackToBazaar t={t} />
        <PageHead
          title={t('bazaar.studio.title')}
          lede={t('bazaar.studio.lede')}
          actions={user ? <Button label={t('bazaar.share')} icon={Upload} onPress={() => router.push(bazaarRoutes.publish())} /> : undefined}
        />
        {body}
      </Screen>
      <ConfirmSheet
        visible={!!toHide}
        title={t('bazaar.studio.unpublishTitle', { name: toHide?.title ?? '' })}
        message={t('bazaar.studio.unpublishBody')}
        confirmLabel={t('bazaar.studio.action.unpublish')}
        onCancel={() => setToHide(null)}
        onConfirm={async () => {
          const l = toHide;
          setToHide(null);
          if (l) await act(l.id, () => bazaar.unpublish(l.id));
        }}
      />
    </AppShell>
  );
}

/** A stat in wide, sturdy numerals (DIRECTION §1). */
function Stat({ label, value }: { label: string; value: string }) {
  const theme = useKalamTheme();
  return (
    <View style={{ minWidth: 124, gap: 2, paddingVertical: 12, paddingHorizontal: 14, borderRadius: theme.radius.paper, backgroundColor: theme.colors.surface }}>
      <Text variant="caption" tone="muted">{label}</Text>
      <Text variant="h3" money>{value}</Text>
    </View>
  );
}
