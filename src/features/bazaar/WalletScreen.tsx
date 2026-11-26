import { router, useFocusEffect } from 'expo-router';
import { Coins } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { View } from 'react-native';

import { AppShell } from '@/components/shell/AppShell';
import type { BazaarWalletView } from '@/core/contracts';
import { Button, EmptyState, Screen, Slip, Text, useKalamTheme, useToast } from '@/design';
import { SignInPanel } from '@/features/auth/SignInPanel';
import { useAuthUser } from '@/features/auth/use-auth';
import { useFormat, useT } from '@/i18n/react';
import { getServices } from '@/services';

import { BackToBazaar, Busy, PageHead, Section } from './parts';
import { bazaarRoutes } from './routes';

/**
 * Credits (docs/12 §12): balance and the full history. Credits are a test currency for the hackathon, never
 * money. Only the trusted functions change them; this screen only reads. With payments off (the default),
 * the page says it is not available and points back to the Bazaar, without mentioning credits.
 */
export function WalletScreen() {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const { relativeTime } = useFormat(theme.uiLanguage);
  const toast = useToast();
  const { user } = useAuthUser();
  const bazaar = getServices().bazaar;
  const payments = bazaar.paymentsEnabled();
  const [view, setView] = useState<BazaarWalletView | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => { if (payments) setView(await bazaar.wallet()); }, [bazaar, user, payments]); // eslint-disable-line react-hooks/exhaustive-deps
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (!payments) {
    return (
      <AppShell active="bazaar">
        <Screen maxWidth={760}>
          <BackToBazaar t={t} />
          <EmptyState
            title={t('bazaar.wallet.offTitle')}
            description={t('bazaar.wallet.offBody')}
            action={<Button label={t('bazaar.library.browse')} variant="outline" onPress={() => router.replace(bazaarRoutes.home)} />}
          />
        </Screen>
      </AppShell>
    );
  }

  const describe = (tx: BazaarWalletView['transactions'][number]) => {
    if (tx.type === 'grant') return { text: t('bazaar.wallet.grant'), amount: `+${tx.amount}` };
    const sold = tx.sellerUid === user?.uid;
    if (tx.type === 'reversal') return { text: t(sold ? 'bazaar.wallet.refundOut' : 'bazaar.wallet.refundIn'), amount: `${sold ? '-' : '+'}${tx.amount}` };
    return { text: t(sold ? 'bazaar.wallet.sold' : 'bazaar.wallet.bought'), amount: `${sold ? '+' : '-'}${tx.amount}`, reversed: tx.status === 'reversed' };
  };

  let body;
  if (!view) body = <Busy text={t('bazaar.wallet.loading')} />;
  else if (!view.enabled) body = <EmptyState title={t('bazaar.wallet.offTitle')} description={t('bazaar.wallet.offBody')} />;
  else if (!view.signedIn) {
    body = (
      <Slip tint="carbon" style={{ maxWidth: 520 }}>
        <Text variant="h3">{t('bazaar.wallet.signIn')}</Text>
        <SignInPanel />
      </Slip>
    );
  } else {
    body = (
      <View style={{ gap: 28 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, flexWrap: 'wrap', padding: 24, borderRadius: theme.radius.paper, backgroundColor: theme.colors.surface }}>
          <Coins size={28} color={theme.colors.accentInk} />
          <View style={{ flex: 1, minWidth: 180 }}>
            <Text variant="caption" tone="muted">{t('bazaar.wallet.yours')}</Text>
            <Text variant="display" money>{view.wallet ? view.wallet.credits : 0}</Text>
          </View>
          {!view.wallet ? (
            <Button
              label={t('bazaar.wallet.claim')}
              loading={busy}
              onPress={async () => {
                setBusy(true);
                const r = await bazaar.claimStarterCredits();
                setBusy(false);
                toast.show({ message: r.message, tone: r.ok ? 'success' : 'danger' });
                await load();
              }}
            />
          ) : null}
        </View>
        {view.message ? <Text tone="secondary">{view.message}</Text> : null}
        <Section title={t('bazaar.wallet.history')}>
          {view.transactions.length ? view.transactions.map((tx) => {
            const d = describe(tx);
            return (
              <View key={tx.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderColor: theme.colors.border }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text>{d.reversed ? t('bazaar.wallet.refunded', { what: d.text }) : d.text}</Text>
                  <Text variant="caption" tone="muted" mono>{relativeTime(tx.createdAt)}</Text>
                </View>
                <Text weight="semibold" money>{d.amount}</Text>
              </View>
            );
          }) : <Text tone="secondary">{t('bazaar.wallet.none')}</Text>}
        </Section>
        <Text variant="bodySmall" tone="muted">{t('bazaar.wallet.note')}</Text>
      </View>
    );
  }

  return (
    <AppShell active="bazaar">
      <Screen maxWidth={760}>
        <BackToBazaar t={t} />
        <PageHead title={t('bazaar.wallet.title')} lede={t('bazaar.wallet.lede')} />
        {body}
      </Screen>
    </AppShell>
  );
}
