/**
 * /import: "Open in Kalam" links (docs/18 section 5). The whole app travels in the part of the link after `#`, so it
 * never reaches a server. It is decoded and fully validated on this device before anything is shown, then tried in
 * a preview that keeps its data in memory. Nothing is saved until the person chooses to.
 */
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { StoredApp } from '@/core/contracts';
import { decodeImportLink } from '@/core/import-link';
import { Button, ConfirmSheet, EmptyState, IconButton, Slip, Stamp, Text, useBreakpoint, useKalamTheme, useToast } from '@/design';
import { RecoveryCard } from '@/features/recovery';
import { useT } from '@/i18n/react';
import { KalamRuntime } from '@/runtime/KalamRuntime';
import { createMemoryRuntimeServices } from '@/runtime/memory-services';
import { useAccessModes } from '@/runtime/RunAppScreen';
import { getServices } from '@/services';

/**
 * The address this page was opened with. On the web, opening another link while this page is already open only
 * changes the part after the `#`, which `Linking.useURL()` may not report, so the browser's own events are read too.
 */
function useImportUrl(): string | null {
  const linked = Linking.useURL();
  const [live, setLive] = useState<string | undefined>();
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return undefined;
    const read = () => setLive(window.location.href);
    window.addEventListener('hashchange', read);
    window.addEventListener('popstate', read);
    return () => {
      window.removeEventListener('hashchange', read);
      window.removeEventListener('popstate', read);
    };
  }, []);
  return live ?? linked;
}

export default function ImportLinkScreen() {
  const router = useRouter();
  const url = useImportUrl();
  const toast = useToast();
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const insets = useSafeAreaInsets();
  const { isPhone } = useBreakpoint();
  const accessModes = useAccessModes();
  const decoded = useMemo(() => (url ? decodeImportLink(url) : undefined), [url]);
  const spec = decoded?.ok ? decoded.spec : undefined;
  const services = useMemo(() => (spec ? createMemoryRuntimeServices(spec.id) : undefined), [spec]);
  const [existing, setExisting] = useState<StoredApp>();
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [saving, setSaving] = useState(false);

  const toShelf = () => router.replace('/');
  const bar = (
    <View
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: insets.top + 4, paddingBottom: 4, paddingHorizontal: isPhone ? 4 : 12,
        borderBottomWidth: 1, borderBottomColor: theme.colors.border, backgroundColor: theme.colors.surface,
      }}
    >
      <IconButton icon={ArrowLeft} label={t('run.back')} onPress={toShelf} />
      <Text variant="h4" numberOfLines={1} style={{ flex: 1 }} {...(spec ? ({ lang: spec.lang } as object) : {})}>{spec?.name ?? ''}</Text>
    </View>
  );

  // Before the address is known the page stays blank, so a good link never flashes the error.
  if (!url) return <View style={{ flex: 1, backgroundColor: theme.colors.background }}>{bar}</View>;
  if (!decoded?.ok || !spec || !services) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        {bar}
        <View style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 20 }}>
          <EmptyState
            title={t('importLink.badTitle')}
            description={decoded && !decoded.ok ? decoded.message : t('importLink.badEmpty')}
            action={<Button label={t('run.missing.cta')} onPress={toShelf} />}
          />
          {/* A link that decodes but fails the checks says what was kept; nothing was saved or changed. */}
          {decoded && !decoded.ok && decoded.errors[0]?.code ? <RecoveryCard error={decoded.errors[0].code} origin="import" /> : null}
        </View>
      </View>
    );
  }

  const store = async (app: StoredApp, summary: string) => {
    setSaving(true);
    try {
      await getServices().db.apps.save(app, { summary, source: 'import' });
      toast.show({ message: t('importLink.saved', { name: app.spec.name }), tone: 'success' });
      router.replace(`/app/${app.id}`);
    } catch {
      toast.show({ message: t('importLink.saveFailed'), tone: 'danger' });
      setSaving(false);
    }
  };
  const save = async () => {
    const found = await getServices().db.apps.get(spec.id);
    if (found) return setExisting(found);
    const now = Date.now();
    await store({ id: spec.id, spec, createdAt: now, updatedAt: now, origin: { route: 'import' } }, t('importLink.summaryOpened'));
  };
  const replace = async () => {
    setConfirmReplace(false);
    if (existing) await store({ ...existing, spec, updatedAt: Date.now(), origin: { route: 'import' } }, t('importLink.summaryReplaced'));
  };
  const keepBoth = () => {
    const id = `${spec.id.slice(0, 56)}-${Date.now().toString(36).slice(-6)}`;
    const now = Date.now();
    return store({ id, spec: { ...spec, id }, createdAt: now, updatedAt: now, origin: { route: 'import' } }, t('importLink.summaryOpened'));
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      {bar}
      <View style={{ flex: 1, flexDirection: isPhone ? 'column' : 'row' }}>
        <View style={{ padding: 16, width: isPhone ? '100%' : 380 }}>
          <Slip tint="kraft" behind={theme.colors.background}>
            <Stamp kind="checked" label={t('stamp.checked')} size="sm" accessibilityLabel={t('importLink.checkedHint')} />
            <Text tone="secondary">{t('importLink.intro')}</Text>
            {existing ? (
              <View style={{ gap: 10 }}>
                <Text>{t('importLink.exists')}</Text>
                <Button label={t('importLink.replace')} variant="outline" onPress={() => setConfirmReplace(true)} disabled={saving} />
                <Button label={t('importLink.keepBoth')} onPress={() => void keepBoth()} loading={saving} />
              </View>
            ) : (
              <Button label={t('importLink.save')} onPress={() => void save()} loading={saving} testID="import-save" />
            )}
          </Slip>
        </View>
        <View style={{ flex: 1, minHeight: isPhone ? 420 : undefined }}>
          <KalamRuntime spec={spec} appId={spec.id} services={services} mode="preview" accessModes={accessModes} />
        </View>
      </View>
      <ConfirmSheet
        visible={confirmReplace}
        title={t('importLink.replaceTitle', { name: existing?.spec.name ?? spec.name })}
        message={t('importLink.replaceMessage')}
        confirmLabel={t('importLink.replace')}
        destructive
        onConfirm={replace}
        onCancel={() => setConfirmReplace(false)}
      />
    </View>
  );
}
