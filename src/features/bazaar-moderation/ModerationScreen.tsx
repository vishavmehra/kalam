import { router, useFocusEffect } from 'expo-router';
import { ArrowLeft, RefreshCw } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { AppShell } from '@/components/shell/AppShell';
import { Button, EmptyState, LedgerRule, Screen, SegmentedControl, Slip, Stamp, Text, useKalamTheme } from '@/design';
import { useAuthUser } from '@/features/auth/use-auth';
import { useFormat, useT } from '@/i18n/react';

import { useIsModerator } from './claim';
import { moderationApi } from './client';
import { ModerationItemSheet } from './ModerationItemSheet';
import { ERROR_KEY, filterQueue, statusKeyFor, stampFor, tintFor, type ModErrorKind, type QueueFilter, type QueueItem } from './model';

/**
 * Moderator queue (docs/12 §14.5, §18.2-18.4): listings waiting for a review and listings people reported
 * since the last decision. Reached only from the moderator link, and open only to accounts with the
 * `kalamModerator` claim; the trusted functions check the claim on every call, so this page is a courtesy.
 */
export function ModerationScreen() {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const { relativeTime } = useFormat(theme.uiLanguage);
  const { user, restoring } = useAuthUser();
  const { moderator, checking } = useIsModerator(user?.uid, true);
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [error, setError] = useState<ModErrorKind | null>(null);
  const [filter, setFilter] = useState<QueueFilter>('all');
  const [open, setOpen] = useState<QueueItem | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const r = await moderationApi.queue();
    if (r.ok) setItems(r.data);
    else { setItems([]); setError(r.kind); }
  }, []);
  useFocusEffect(useCallback(() => { if (moderator) void load(); }, [moderator, load]));

  const back = (
    <View style={{ alignSelf: 'flex-start', marginStart: -8, marginBottom: 12 }}>
      <Button label={t('bazaar.title')} variant="ghost" size="sm" icon={ArrowLeft}
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/bazaar' as never))} />
    </View>
  );

  if (restoring || checking) {
    return <AppShell active="bazaar"><Screen maxWidth={760}>{back}<ActivityIndicator color={theme.colors.primary} /></Screen></AppShell>;
  }
  if (!user || !moderator) {
    return (
      <AppShell active="bazaar">
        <Screen maxWidth={760}>
          {back}
          <EmptyState title={t('bazaar.mod.notAllowed.title')} description={t('bazaar.mod.notAllowed.body')} />
        </Screen>
      </AppShell>
    );
  }

  const shown = items ? filterQueue(items, filter) : [];
  const count = (f: QueueFilter) => (items ? filterQueue(items, f).length : 0);

  return (
    <AppShell active="bazaar">
      <Screen maxWidth={760}>
        {back}
        <View style={{ gap: 6, marginBottom: 20 }}>
          <Text variant="h1" accessibilityRole="header">{t('bazaar.mod.title')}</Text>
          <LedgerRule />
          <Text tone="secondary" style={{ marginTop: 10 }}>{t('bazaar.mod.lede')}</Text>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <View style={{ flex: 1, minWidth: 240 }}>
            <SegmentedControl<QueueFilter>
              label={t('bazaar.mod.title')}
              labelHidden
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: t('bazaar.mod.filter.all', { count: count('all') }) },
                { value: 'pending', label: t('bazaar.mod.filter.pending', { count: count('pending') }) },
                { value: 'reported', label: t('bazaar.mod.filter.reported', { count: count('reported') }) },
              ]}
            />
          </View>
          <Button label={t('common.refresh')} variant="outline" size="sm" icon={RefreshCw} onPress={() => void load()} />
        </View>

        {error ? <View role="alert" style={{ marginBottom: 12 }}><Text tone="danger">{t(ERROR_KEY[error])}</Text></View> : null}
        {items === null ? <Text tone="secondary">{t('bazaar.mod.loading')}</Text> : null}
        {items && shown.length === 0 && !error ? <EmptyState title={t('bazaar.mod.empty')} description={t('bazaar.mod.emptyBody')} /> : null}

        <View role="list" style={{ gap: 14 }}>
          {shown.map((item, n) => (
            <View key={item.listingId} role="listitem">
              <Pressable accessibilityRole="button" accessibilityLabel={`${item.title}, ${t(statusKeyFor(item))}`} onPress={() => setOpen(item)}>
                <Slip tint={tintFor(item)} number={n + 1} style={{ gap: 8 }}>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
                    <Text variant="h4" style={{ flexShrink: 1 }}>{item.title}</Text>
                    <Stamp kind={stampFor(item)} label={t(statusKeyFor(item))} size="sm" />
                  </View>
                  <Text variant="bodySmall" tone="secondary">{t('bazaar.by', { name: item.makerName })} · {relativeTime(item.updatedAtMs)}</Text>
                  {item.reports.total > 0 ? <Text variant="bodySmall" weight="semibold">{t('bazaar.mod.reports', { count: item.reports.total })}</Text> : null}
                </Slip>
              </Pressable>
            </View>
          ))}
        </View>
      </Screen>
      <ModerationItemSheet item={open} onClose={() => setOpen(null)} onChanged={() => void load()} />
    </AppShell>
  );
}
