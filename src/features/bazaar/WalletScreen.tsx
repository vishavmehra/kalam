import { router, useFocusEffect } from 'expo-router';
import { ArrowLeft, Coins } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { relativeTime } from '@/components/format';
import { AppShell } from '@/components/shell/AppShell';
import type { BazaarWalletView } from '@/core/contracts';
import { Button, EmptyState, Screen, Surface, Text, useKalamTheme, useToast } from '@/design';
import { SignInPanel } from '@/features/auth/SignInPanel';
import { useAuthUser } from '@/features/auth/use-auth';
import { getServices } from '@/services';

import { bazaarRoutes } from './routes';

/**
 * Credits (docs/12 §12): balance and the full history. Credits are a test currency for the
 * hackathon, never money. Only the trusted functions change them; this screen only reads.
 */
export function WalletScreen() {
  const theme = useKalamTheme();
  const toast = useToast();
  const { user } = useAuthUser();
  const bazaar = getServices().bazaar;
  const [view, setView] = useState<BazaarWalletView | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => { setView(await bazaar.wallet()); }, [bazaar, user]); // eslint-disable-line react-hooks/exhaustive-deps
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const describe = (t: BazaarWalletView['transactions'][number]) => {
    if (t.type === 'grant') return { text: 'Starting credits', amount: `+${t.amount}` };
    const sold = t.sellerUid === user?.uid;
    if (t.type === 'reversal') return { text: sold ? 'Refund to a buyer' : 'Refund', amount: `${sold ? '-' : '+'}${t.amount}` };
    return { text: sold ? 'Someone bought your app' : 'You bought an app', amount: `${sold ? '+' : '-'}${t.amount}`, reversed: t.status === 'reversed' };
  };

  let body;
  if (!view) {
    body = (
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 24 }}>
        <ActivityIndicator color={theme.colors.primary} />
        <Text tone="secondary">Loading your credits</Text>
      </View>
    );
  } else if (!view.enabled) {
    body = <EmptyState title="Credits are not switched on yet" description="Every app in Kalam Bazaar is free for now. Paid apps need the purchase service, which is not running in this build." />;
  } else if (!view.signedIn) {
    body = (
      <Surface padded={24} style={{ gap: 16, maxWidth: 520 }}>
        <Text variant="h3">Sign in to use credits</Text>
        <SignInPanel />
      </Surface>
    );
  } else {
    body = (
      <View style={{ gap: 24 }}>
        <Surface padded={24} style={{ flexDirection: 'row', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <Coins size={28} color={theme.colors.accent} />
          <View style={{ flex: 1, minWidth: 180 }}>
            <Text variant="caption" tone="muted">Your credits</Text>
            <Text variant="display" numeric>{view.wallet ? view.wallet.credits : 0}</Text>
          </View>
          {!view.wallet ? (
            <Button
              label="Get 100 starting credits"
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
        </Surface>
        {view.message ? <Text tone="secondary">{view.message}</Text> : null}
        <View style={{ gap: 10 }}>
          <Text variant="h3">History</Text>
          {view.transactions.length ? view.transactions.map((t) => {
            const d = describe(t);
            return (
              <Surface key={t.id} padded={14} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text>{d.text}{d.reversed ? ' (refunded)' : ''}</Text>
                  <Text variant="caption" tone="muted">{relativeTime(t.createdAt)}</Text>
                </View>
                <Text weight="semibold" numeric>{d.amount}</Text>
              </Surface>
            );
          }) : <Text tone="secondary">No credit activity yet.</Text>}
        </View>
        <Text variant="bodySmall" tone="muted">
          Credits are a test currency inside Kalam, not money. Purchases cannot be undone from the app. If something went wrong, report the app and the Kalam team can refund it.
        </Text>
      </View>
    );
  }

  return (
    <AppShell active="bazaar">
      <Screen maxWidth={760}>
        <View style={{ alignSelf: 'flex-start', marginLeft: -8, marginBottom: 8 }}>
          <Button label="Kalam Bazaar" variant="ghost" size="sm" icon={ArrowLeft}
            onPress={() => (router.canGoBack() ? router.back() : router.replace(bazaarRoutes.home))} />
        </View>
        <View style={{ gap: 6, marginBottom: 24 }}>
          <Text variant="h1">Credits</Text>
          <Text tone="secondary">Use credits to buy apps that their makers price. Makers receive the credits.</Text>
        </View>
        {body}
      </Screen>
    </AppShell>
  );
}
