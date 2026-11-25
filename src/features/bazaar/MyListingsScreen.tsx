import { router, useFocusEffect } from 'expo-router';
import { ArrowLeft, CloudOff, Download, Eye, EyeOff, FilePen, Heart, PenLine, RefreshCw, Star, Upload } from 'lucide-react-native';
import { type ReactNode, useCallback, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { relativeTime } from '@/components/format';
import { AppShell } from '@/components/shell/AppShell';
import { useOnline } from '@/components/status/useHybridStatus';
import { makerActions, priceLabel, statusLabel, type BazaarListing, type ListingStatus, type MakerAction } from '@/core/bazaar';
import type { BazaarCreatorStats, BazaarDraft } from '@/core/contracts';
import {
  Button, Chip, type ChipTone, ConfirmSheet, EmptyState, Screen, Surface, Text, useKalamTheme, useToast,
} from '@/design';
import { SignInPanel } from '@/features/auth/SignInPanel';
import { useAuthUser } from '@/features/auth/use-auth';
import { getServices } from '@/services';
import { useAppsStore } from '@/state/apps-store';

import { countLabel } from './ListingCard';
import { ListingIcon } from './ListingIcon';
import { bazaarRoutes } from './routes';

const TONES: Record<ListingStatus, ChipTone> = {
  published: 'success', pending_review: 'warning', rejected: 'danger', unpublished: 'neutral', suspended: 'danger',
};

/** Creator Studio (docs/12 §13): dashboard, drafts, listings with their state and the actions it allows. */
export function MyListingsScreen() {
  const theme = useKalamTheme();
  const toast = useToast();
  const online = useOnline();
  const { user, restoring, configured } = useAuthUser();
  const bazaar = getServices().bazaar;
  const apps = useAppsStore((s) => s.apps);
  const [listings, setListings] = useState<BazaarListing[] | null>(null);
  const [stats, setStats] = useState<BazaarCreatorStats | null>(null);
  const [drafts, setDrafts] = useState<BazaarDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toHide, setToHide] = useState<BazaarListing | null>(null);

  const load = useCallback(async () => {
    setDrafts(await bazaar.drafts());
    if (!user || !online) return;
    try {
      const mine = await bazaar.myListings();
      setListings(mine);
      setStats(await bazaar.creatorStats(mine));
      setError(null);
    } catch {
      setError('Could not load your listings. Please try again.');
    }
  }, [bazaar, user, online]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const act = async (id: string, fn: () => Promise<{ ok: boolean; message: string }>) => {
    setBusy(id);
    const r = await fn().catch(() => ({ ok: false, message: 'Something went wrong. Please try again.' }));
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
  const LABELS: Record<MakerAction, { label: string; icon: typeof Eye }> = {
    view: { label: 'View', icon: Eye },
    edit_details: { label: 'Edit details', icon: PenLine },
    new_version: { label: 'Publish a new version', icon: Upload },
    unpublish: { label: 'Unpublish', icon: EyeOff },
    recheck: { label: 'Run the checks again', icon: RefreshCw },
    show_again: { label: 'Show it again', icon: RefreshCw },
  };

  const draftsBlock = drafts.length ? (
    <Section title="Drafts" note="Kept on this device until you share them.">
      {drafts.map((d) => {
        const app = apps.find((a) => a.id === d.appId);
        return (
          <Surface key={`${d.appId}${d.listingId ?? ''}`} padded={16} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <FilePen size={18} color={theme.colors.textMuted} />
            <View style={{ flex: 1, minWidth: 180 }}>
              <Text weight="semibold" numberOfLines={1}>{d.form.title || app?.spec.name || 'Untitled'}</Text>
              <Text variant="caption" tone="muted">Saved {relativeTime(d.savedAt).toLowerCase()}{app ? '' : '. The app is no longer on this device.'}</Text>
            </View>
            {app ? <Button label="Continue" size="sm" variant="outline" onPress={() => router.push(bazaarRoutes.publish({ appId: d.appId, listingId: d.listingId }))} /> : null}
            <Button label="Delete" size="sm" variant="ghost" onPress={async () => { await bazaar.removeDraft(d.appId); setDrafts(await bazaar.drafts()); }} />
          </Surface>
        );
      })}
    </Section>
  ) : null;

  let body: ReactNode;
  if (!configured) body = <EmptyState title="Kalam Bazaar is not set up in this build" description="Sharing needs Firebase to be configured." />;
  else if (restoring) body = <Busy text="Checking your account" />;
  else if (!user) {
    body = (
      <View style={{ gap: 24 }}>
        {draftsBlock}
        <Surface padded={24} style={{ gap: 16, maxWidth: 520 }}>
          <Text variant="h3">Sign in to see your listings</Text>
          <SignInPanel />
        </Surface>
      </View>
    );
  } else if (!online) {
    body = (
      <View style={{ gap: 24 }}>
        <Surface tone="alt" padded={16} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }} role="status">
          <CloudOff size={18} color={theme.colors.warning} />
          <Text style={{ flex: 1 }}>You are offline. Your listings will show when you are back online. Your drafts and apps still work.</Text>
        </Surface>
        {draftsBlock}
      </View>
    );
  } else if (error) {
    body = <EmptyState title="Something went wrong" description={error} action={<Button label="Try again" variant="outline" onPress={load} />} />;
  } else if (!listings) {
    body = <Busy text="Loading your listings" />;
  } else {
    body = (
      <View style={{ gap: 28 }}>
        {stats && listings.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }} accessibilityRole="summary">
            <Stat label="Live" value={String(stats.published)} />
            <Stat label="Waiting" value={String(stats.waiting)} />
            <Stat label="Needs changes" value={String(stats.needsChanges)} />
            <Stat label="Installs" value={String(stats.installs)} />
            <Stat label="Likes" value={String(stats.likes)} />
            <Stat label="Rating" value={stats.ratingCount ? `${stats.ratingAvg.toFixed(1)} (${stats.ratingCount})` : 'None yet'} />
            {bazaar.paymentsEnabled() ? <Stat label="Credits earned" value={String(stats.creditsEarned)} /> : null}
          </View>
        ) : null}
        {draftsBlock}
        <Section title="Listings">
          {!listings.length ? (
            <EmptyState
              title="You have not shared any apps yet"
              description={user.isAnonymous ? 'Guest accounts cannot share apps. Add an email on the Account page first.' : 'Share an app you made so other people can install their own copy.'}
              action={user.isAnonymous ? undefined : <Button label="Share an app" icon={Upload} onPress={() => router.push(bazaarRoutes.publish())} />}
            />
          ) : (
            <View style={{ gap: 12 }} role="list">
              {listings.map((l) => (
                <Surface key={l.id} padded={18} style={{ gap: 12 }} role="listitem">
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                    <ListingIcon listing={l} size={44} />
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text variant="h4" numberOfLines={1}>{l.title}</Text>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                        <Chip label={statusLabel(l)} tone={TONES[l.status]} />
                        <Chip label={priceLabel(l.price)} tone="neutral" />
                        <Text variant="caption" tone="muted">Version {l.specVersion}. Updated {relativeTime(l.updatedAt).toLowerCase()}.</Text>
                      </View>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 4 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                      <Mini icon={<Download size={14} color={theme.colors.textMuted} />} text={countLabel(l.installs, 'install', 'installs')} />
                      <Mini icon={<Heart size={14} color={theme.colors.textMuted} />} text={countLabel(l.likes, 'like', 'likes')} />
                      <Mini icon={<Star size={14} color={theme.colors.textMuted} />} text={l.ratingCount ? `${l.ratingAvg.toFixed(1)} (${l.ratingCount})` : 'No reviews'} />
                    </View>
                  </View>
                  {(l.status === 'rejected' || l.status === 'pending_review' || l.status === 'suspended') && l.safety.reasons.length ? (
                    <View style={{ gap: 4 }}>
                      {l.safety.reasons.map((r) => <Text key={r} variant="bodySmall" tone={l.status === 'pending_review' ? 'secondary' : 'danger'}>{r}</Text>)}
                    </View>
                  ) : null}
                  {l.status === 'suspended' ? (
                    <Text variant="bodySmall" tone="danger">This listing was suspended by the Kalam team. Copies people installed keep working.</Text>
                  ) : null}
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {makerActions(l.status).map((a) => (
                      <Button
                        key={a}
                        label={LABELS[a].label}
                        icon={LABELS[a].icon}
                        size="sm"
                        variant={a === 'view' || a === 'recheck' || a === 'show_again' ? 'outline' : 'ghost'}
                        loading={busy === l.id && (a === 'recheck' || a === 'show_again')}
                        disabled={!!busy}
                        onPress={() => run(l, a)}
                      />
                    ))}
                  </View>
                </Surface>
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
        <View style={{ alignSelf: 'flex-start', marginLeft: -8, marginBottom: 8 }}>
          <Button label="Kalam Bazaar" variant="ghost" size="sm" icon={ArrowLeft}
            onPress={() => (router.canGoBack() ? router.back() : router.replace(bazaarRoutes.home))} />
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: 16, marginBottom: 24 }}>
          <View style={{ flex: 1, minWidth: 240, gap: 6 }}>
            <Text variant="h1">Creator Studio</Text>
            <Text tone="secondary">Apps you shared in Kalam Bazaar. Hiding a listing never removes copies people already installed.</Text>
          </View>
          {user && !user.isAnonymous ? <Button label="Share an app" icon={Upload} onPress={() => router.push(bazaarRoutes.publish())} /> : null}
        </View>
        {body}
      </Screen>
      <ConfirmSheet
        visible={!!toHide}
        title={`Unpublish ${toHide?.title ?? ''}?`}
        message="It will no longer show in Kalam Bazaar. People who installed it keep their copy. You can show it again later."
        confirmLabel="Unpublish"
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

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Surface padded={14} style={{ minWidth: 120, gap: 2 }}>
      <Text variant="caption" tone="muted">{label}</Text>
      <Text variant="h4" numeric>{value}</Text>
    </Surface>
  );
}

function Mini({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      {icon}
      <Text variant="caption" tone="muted">{text}</Text>
    </View>
  );
}

function Busy({ text }: { text: string }) {
  const theme = useKalamTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 24 }}>
      <ActivityIndicator color={theme.colors.primary} />
      <Text tone="secondary">{text}</Text>
    </View>
  );
}
