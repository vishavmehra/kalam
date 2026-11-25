import { router, useFocusEffect } from 'expo-router';
import { ArrowLeft, CloudOff, Download, Play, RefreshCw } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { routes } from '@/components/shell/routes';
import { AppShell } from '@/components/shell/AppShell';
import { useOnline } from '@/components/status/useHybridStatus';
import { priceLabel } from '@/core/bazaar';
import type { BazaarLibraryItem, BazaarUpdateCheck } from '@/core/contracts';
import { Button, Chip, EmptyState, Screen, Surface, Text, useKalamTheme, useToast } from '@/design';
import { getServices } from '@/services';
import { useAppsStore } from '@/state/apps-store';

import { ListingIcon } from './ListingIcon';
import { bazaarRoutes } from './routes';
import { UpdateSheet } from './sheets';

/**
 * My Library (docs/12 §4.1, §11.4, §19.1): apps installed from Kalam Bazaar on this device, plus
 * apps this account installed or bought elsewhere. Works offline for the local part.
 */
export function LibraryScreen() {
  const theme = useKalamTheme();
  const toast = useToast();
  const online = useOnline();
  const bazaar = getServices().bazaar;
  const refreshApps = useAppsStore((s) => s.refresh);
  const [items, setItems] = useState<BazaarLibraryItem[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [update, setUpdate] = useState<{ appId: string; check: BazaarUpdateCheck } | null>(null);

  const load = useCallback(async () => {
    setItems(await bazaar.library().catch(() => []));
  }, [bazaar, online]); // eslint-disable-line react-hooks/exhaustive-deps
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const installAgain = async (item: BazaarLibraryItem) => {
    if (!item.listing) return;
    setBusy(item.listingId);
    const r = await bazaar.install(item.listing, 'install');
    setBusy(null);
    await refreshApps().catch(() => undefined);
    toast.show({ message: r.message, tone: r.ok ? 'success' : 'danger' });
    await load();
  };
  const review = async (item: BazaarLibraryItem) => {
    if (!item.localAppId) return;
    setBusy(item.localAppId);
    const check = await bazaar.checkUpdate(item.localAppId);
    setBusy(null);
    if (check.available) setUpdate({ appId: item.localAppId, check });
    else toast.show({ message: check.message ?? 'You have the newest version.', tone: 'info' });
  };

  const onDevice = (items ?? []).filter((i) => i.localAppId);
  const elsewhere = (items ?? []).filter((i) => !i.localAppId);

  return (
    <AppShell active="bazaar">
      <Screen maxWidth={900}>
        <View style={{ alignSelf: 'flex-start', marginLeft: -8, marginBottom: 8 }}>
          <Button label="Kalam Bazaar" variant="ghost" size="sm" icon={ArrowLeft}
            onPress={() => (router.canGoBack() ? router.back() : router.replace(bazaarRoutes.home))} />
        </View>
        <View style={{ gap: 6, marginBottom: 24 }}>
          <Text variant="h1">My library</Text>
          <Text tone="secondary">Apps you installed from Kalam Bazaar. They are yours and keep working offline.</Text>
        </View>
        {!online ? (
          <Surface tone="alt" padded={14} style={{ flexDirection: 'row', gap: 10, alignItems: 'center', marginBottom: 20 }} role="status">
            <CloudOff size={18} color={theme.colors.warning} />
            <Text style={{ flex: 1 }}>You are offline. Your installed apps still open. Updates and apps bought on other devices show when you are back online.</Text>
          </Surface>
        ) : null}

        {!items ? (
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 24 }}>
            <ActivityIndicator color={theme.colors.primary} />
            <Text tone="secondary">Loading your library</Text>
          </View>
        ) : !items.length ? (
          <EmptyState
            title="Nothing installed from Kalam Bazaar yet"
            description="Apps you install from Kalam Bazaar show here, with updates when their makers publish them."
            action={<Button label="Browse Kalam Bazaar" variant="outline" onPress={() => router.push(bazaarRoutes.home)} />}
          />
        ) : (
          <View style={{ gap: 28 }}>
            <View style={{ gap: 12 }} role="list">
              {onDevice.map((item) => (
                <Surface key={`${item.listingId}:${item.localAppId}`} padded={16} style={{ gap: 12 }} role="listitem">
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                    {item.listing ? <ListingIcon listing={item.listing} size={44} /> : null}
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text variant="h4" numberOfLines={1}>{item.localName ?? item.listing?.title ?? 'Installed app'}</Text>
                      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        {item.listing ? <Text variant="caption" tone="muted">by {item.listing.makerName}</Text> : null}
                        {item.installedVersion ? <Text variant="caption" tone="muted">Version {item.installedVersion}</Text> : null}
                        {item.entitlement && item.entitlement.pricePaid > 0 ? <Chip label={`Bought for ${priceLabel(item.entitlement.pricePaid)}`} tone="neutral" /> : null}
                        {item.updateAvailable ? <Chip label="Update available" tone="info" /> : null}
                      </View>
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                    <Button label="Open" size="sm" icon={Play} onPress={() => router.push(routes.app(item.localAppId!))} />
                    {item.updateAvailable ? (
                      <Button label="Review the update" size="sm" variant="outline" icon={RefreshCw} loading={busy === item.localAppId} onPress={() => review(item)} />
                    ) : null}
                    {item.listing ? <Button label="Listing" size="sm" variant="ghost" onPress={() => router.push(bazaarRoutes.listing(item.listingId))} /> : null}
                  </View>
                </Surface>
              ))}
            </View>
            {elsewhere.length ? (
              <View style={{ gap: 12 }}>
                <View style={{ gap: 2 }}>
                  <Text variant="h3">Not on this device</Text>
                  <Text variant="bodySmall" tone="muted">Apps your account installed or bought before. Install them again here at no cost.</Text>
                </View>
                {elsewhere.map((item) => (
                  <Surface key={item.listingId} padded={16} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    {item.listing ? <ListingIcon listing={item.listing} size={40} /> : null}
                    <Text weight="semibold" style={{ flex: 1, minWidth: 160 }} numberOfLines={1}>{item.listing?.title ?? 'An app from Kalam Bazaar'}</Text>
                    {item.listing ? (
                      <Button label="Install again" size="sm" variant="outline" icon={Download} loading={busy === item.listingId} disabled={!online} onPress={() => installAgain(item)} />
                    ) : (
                      <Button label="Open listing" size="sm" variant="ghost" onPress={() => router.push(bazaarRoutes.listing(item.listingId))} />
                    )}
                  </Surface>
                ))}
              </View>
            ) : null}
          </View>
        )}
      </Screen>
      {update ? (
        <UpdateSheet
          visible
          check={update.check}
          onClose={() => setUpdate(null)}
          onApply={async (mode) => {
            const r = await bazaar.applyUpdate(update.appId, mode);
            setUpdate(null);
            await refreshApps().catch(() => undefined);
            toast.show({ message: r.message, tone: r.ok ? 'success' : 'danger' });
            await load();
          }}
        />
      ) : null}
    </AppShell>
  );
}
