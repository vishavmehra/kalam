import { router, useFocusEffect } from 'expo-router';
import { Download, Play, RefreshCw } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { View } from 'react-native';

import { routes } from '@/components/shell/routes';
import { AppShell } from '@/components/shell/AppShell';
import { useOnline } from '@/components/status/useHybridStatus';
import type { BazaarLibraryItem, BazaarUpdateCheck } from '@/core/contracts';
import { Button, EmptyState, Screen, Slip, Stamp, Text, useKalamTheme, useToast } from '@/design';
import { useT } from '@/i18n/react';
import { getServices } from '@/services';
import { useAppsStore } from '@/state/apps-store';

import { ListingIcon } from './ListingIcon';
import { BackToBazaar, Busy, OfflineNote, PageHead, priceText, Section } from './parts';
import { bazaarRoutes } from './routes';
import { UpdateSheet } from './sheets';

/**
 * My Library (docs/12 §4.1, §11.4, §19.1): apps installed from Kalam Bazaar on this device, plus
 * apps this account installed or bought elsewhere. Works offline for the local part.
 */
export function LibraryScreen() {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const toast = useToast();
  const online = useOnline();
  const bazaar = getServices().bazaar;
  const payments = bazaar.paymentsEnabled();
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
    else toast.show({ message: check.message ?? t('bazaar.library.newest'), tone: 'info' });
  };

  const onDevice = (items ?? []).filter((i) => i.localAppId);
  const elsewhere = (items ?? []).filter((i) => !i.localAppId);

  return (
    <AppShell active="bazaar">
      <Screen maxWidth={900}>
        <BackToBazaar t={t} />
        <PageHead title={t('bazaar.library.title')} lede={t('bazaar.library.lede')} />
        {!online ? <OfflineNote>{t('bazaar.library.offline')}</OfflineNote> : null}

        {!items ? <Busy text={t('bazaar.library.loading')} /> : !items.length ? (
          <EmptyState
            title={t('bazaar.library.emptyTitle')}
            description={t('bazaar.library.emptyBody')}
            action={<Button label={t('bazaar.library.browse')} variant="outline" onPress={() => router.push(bazaarRoutes.home)} />}
          />
        ) : (
          <View style={{ gap: 32 }}>
            <View style={{ gap: 14 }} role="list">
              {onDevice.map((item) => (
                <View key={`${item.listingId}:${item.localAppId}`} role="listitem">
                  <Slip tint="carbon">
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                      {item.listing ? <ListingIcon listing={item.listing} size={44} /> : null}
                      <View style={{ flex: 1, gap: 4 }}>
                        <Text variant="h4" numberOfLines={1}>{item.localName ?? item.listing?.title ?? t('bazaar.library.installedApp')}</Text>
                        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                          {item.listing ? <Text variant="caption" tone="muted" mono>{t('bazaar.by', { name: item.listing.makerName })}</Text> : null}
                          {item.installedVersion ? <Text variant="caption" tone="muted" mono>{t('edit.version', { version: item.installedVersion })}</Text> : null}
                          {payments && item.entitlement && item.entitlement.pricePaid > 0 ? (
                            <Stamp kind="plain" icon={null} size="sm" label={t('bazaar.library.bought', { price: priceText(t, item.entitlement.pricePaid) })} />
                          ) : null}
                          {item.updateAvailable ? <Stamp kind="cloud" icon={RefreshCw} size="sm" label={t('bazaar.library.update')} /> : null}
                        </View>
                      </View>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                      <Button label={t('common.open')} size="sm" icon={Play} onPress={() => router.push(routes.app(item.localAppId!))} />
                      {item.updateAvailable ? (
                        <Button label={t('bazaar.update.review')} size="sm" variant="outline" icon={RefreshCw} loading={busy === item.localAppId} onPress={() => review(item)} />
                      ) : null}
                      {item.listing ? <Button label={t('bazaar.library.listing')} size="sm" variant="ghost" onPress={() => router.push(bazaarRoutes.listing(item.listingId))} /> : null}
                    </View>
                  </Slip>
                </View>
              ))}
            </View>
            {elsewhere.length ? (
              <Section title={t('bazaar.library.elsewhere')} note={t('bazaar.library.elsewhereNote')}>
                {elsewhere.map((item) => (
                  <View key={item.listingId} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap', paddingVertical: 10, borderBottomWidth: 1, borderColor: theme.colors.border }}>
                    {item.listing ? <ListingIcon listing={item.listing} size={40} /> : null}
                    <Text weight="semibold" style={{ flex: 1, minWidth: 160 }} numberOfLines={1}>{item.listing?.title ?? t('bazaar.library.fromBazaar')}</Text>
                    {item.listing ? (
                      <Button label={t('bazaar.library.again')} size="sm" variant="outline" icon={Download} loading={busy === item.listingId} disabled={!online} onPress={() => installAgain(item)} />
                    ) : (
                      <Button label={t('bazaar.library.openListing')} size="sm" variant="ghost" onPress={() => router.push(bazaarRoutes.listing(item.listingId))} />
                    )}
                  </View>
                ))}
              </Section>
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
