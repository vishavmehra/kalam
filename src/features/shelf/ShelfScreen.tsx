import { Link, router, useFocusEffect } from 'expo-router';
import { Copy, FileDown, Info, PenLine, Pin, PinOff, Play, Plus, RefreshCw, Search, Smartphone, TextCursorInput, Trash2, Upload, Wifi } from 'lucide-react-native';
import { type ComponentRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { safeFilename, saveJsonFile } from '@/components/files/json-file';
import { AppShell } from '@/components/shell/AppShell';
import { routes } from '@/components/shell/routes';
import { describeOnDevice, useAIStatus, useOnline } from '@/components/status/useHybridStatus';
import type { StoredApp } from '@/core/contracts';
import {
  Button, Chip, ConfirmSheet, Logo, Menu, type MenuAnchor, Screen, SegmentedControl, SourceBadge, Surface, Text, TextField,
  useBreakpoint, useKalamTheme, useReducedMotion, useToast,
} from '@/design';
import { bazaarRoutes } from '@/features/bazaar/routes';
import { useT } from '@/i18n/react';
import { speakText } from '@/runtime/platform';
import { useAppsStore } from '@/state/apps-store';
import { useSettingsStore } from '@/state/settings-store';

import { AppCard } from './AppCard';
import { useCardEntrance } from './card-entrance';
import { AppDetailsSheet, RenameSheet } from './AppSheets';
import { ShelfEmpty } from './ShelfEmpty';

const GAP = 16;
const MIN_CARD = 236;

/** App Shelf (docs/02 §11.2, docs/03 §5): every app on this device, offline. */
export function ShelfScreen() {
  const theme = useKalamTheme();
  const reduced = useReducedMotion();
  const { isPhone, hasRail } = useBreakpoint();
  const toast = useToast();
  const t = useT(theme.uiLanguage);
  const apps = useAppsStore((s) => s.apps);
  const loading = useAppsStore((s) => s.loading);
  const refresh = useAppsStore((s) => s.refresh);
  const remove = useAppsStore((s) => s.remove);
  const pin = useAppsStore((s) => s.pin);
  const duplicate = useAppsStore((s) => s.duplicate);
  const onDeviceCount = useSettingsStore((s) => s.settings.onDeviceActionCount);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState('');
  const [gridW, setGridW] = useState(0);
  const [menu, setMenu] = useState<{ app: StoredApp; anchor: MenuAnchor | null } | null>(null);
  const [toDelete, setToDelete] = useState<StoredApp | null>(null);
  const [toRename, setToRename] = useState<StoredApp | null>(null);
  const [details, setDetails] = useState<StoredApp | null>(null);
  const [sort, setSort] = useState<'recent' | 'name'>('recent');
  const [loadError, setLoadError] = useState(false);
  const readAloud = useSettingsStore((s) => s.settings.accessModes.readAloud);
  const grid = useRef<ComponentRef<typeof View>>(null);

  const load = useCallback(() => {
    setLoadError(false);
    refresh()
      .catch(() => setLoadError(true))
      .finally(() => setLoaded(true));
  }, [refresh]);
  useFocusEffect(load);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const found = q ? apps.filter((a) => `${a.spec.name} ${a.spec.description ?? ''}`.toLowerCase().includes(q)) : apps;
    if (sort === 'recent') return found; // the store keeps pinned first, then most recently used
    return [...found].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || a.spec.name.localeCompare(b.spec.name));
  }, [apps, query, sort]);

  useCardEntrance(grid, visible.length > 0 && gridW > 0, reduced);

  // Large mode on a phone: one card per row so names and descriptions are not cut short.
  const cols = isPhone ? (theme.fontScale > 1.2 ? 1 : 2) : Math.max(1, Math.min(5, Math.floor((gridW + GAP) / (MIN_CARD * theme.fontScale + GAP))));
  const cardW = gridW > 0 ? Math.floor((gridW - GAP * (cols - 1)) / cols) : 0;

  const run = async (label: string, fn: () => Promise<unknown>) => {
    try { await fn(); toast.show({ message: label, tone: 'success' }); }
    catch (e) { toast.show({ message: e instanceof Error ? e.message : 'Something went wrong.', tone: 'danger' }); }
  };

  const menuItems = menu ? [
    { key: 'open', label: 'Open', icon: Play, onSelect: () => router.push(routes.app(menu.app.id)) },
    { key: 'edit', label: 'Edit', icon: PenLine, onSelect: () => router.push(routes.editApp(menu.app.id)) },
    menu.app.pinned
      ? { key: 'unpin', label: 'Unpin', icon: PinOff, onSelect: () => void run('Unpinned', () => pin(menu.app.id, false)) }
      : { key: 'pin', label: 'Pin to top', icon: Pin, onSelect: () => void run('Pinned to the top of your shelf', () => pin(menu.app.id, true)) },
    { key: 'rename', label: 'Rename', icon: TextCursorInput, onSelect: () => setToRename(menu.app) },
    { key: 'details', label: 'Details', icon: Info, onSelect: () => setDetails(menu.app) },
    { key: 'dup', label: 'Duplicate', icon: Copy, onSelect: () => void run(`Made a copy of ${menu.app.spec.name}. Records were not copied.`, () => duplicate(menu.app.id)) },
    { key: 'share', label: 'Share in Kalam Bazaar', icon: Upload, onSelect: () => router.push(bazaarRoutes.publish({ appId: menu.app.id })) },
    { key: 'export', label: 'Export as JSON', icon: FileDown, onSelect: () => void run(`Exported ${menu.app.spec.name}`, () => saveJsonFile(safeFilename(menu.app.spec.name, 'kalam.json'), menu.app.spec)) },
    { key: 'delete', label: 'Delete…', icon: Trash2, destructive: true, onSelect: () => setToDelete(menu.app) },
  ] : [];

  const empty = loaded && !loading && !loadError && apps.length === 0;
  const countLine = `${t('shelf.count', { count: apps.length })} on this device`;

  // Read-aloud mode: say what is on the shelf once it has loaded (docs/10 §17.1).
  const spoken = useRef(false);
  useEffect(() => {
    if (!readAloud || !loaded || spoken.current) return;
    spoken.current = true;
    speakText(apps.length ? `Your shelf. ${countLine}.` : 'Your shelf is empty. Create your first app.', 'en');
  }, [readAloud, loaded, apps.length, countLine]);

  return (
    <AppShell active="shelf">
      <Screen>
        {isPhone ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <Logo size={28} />
            <StatusChips compact />
          </View>
        ) : null}

        <View style={{ flexDirection: hasRail ? 'row' : 'column', alignItems: hasRail ? 'flex-end' : 'stretch', gap: 16, marginBottom: 28 }}>
          <View style={{ flex: 1, gap: 6 }}>
            <Text variant="h1">Your shelf</Text>
            {empty ? null : (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 16, rowGap: 4 }}>
                <Text tone="secondary">{countLine}</Text>
                <OnDeviceCounter count={onDeviceCount} />
              </View>
            )}
          </View>
          {!isPhone ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <StatusChips />
              {hasRail && !empty ? <Button label="Create an app" icon={Plus} onPress={() => router.push(routes.create)} /> : null}
            </View>
          ) : null}
        </View>

        {loadError ? (
          <Surface tone="accentSoft" padded radius="lg" accessibilityRole="alert" style={{ gap: 12, maxWidth: 620 }}>
            <Text variant="h4">Your apps could not be read</Text>
            <Text tone="secondary">
              The storage on this device did not answer. Nothing was deleted. Try again. If it keeps happening, restart the
              browser or free some space.
            </Text>
            <Button label="Try again" icon={RefreshCw} onPress={load} />
          </Surface>
        ) : empty ? <ShelfEmpty /> : (
          <View style={{ gap: 20 }}>
            {apps.length || query ? (
              <View style={{ flexDirection: isPhone ? 'column' : 'row', gap: 12, alignItems: isPhone ? 'stretch' : 'center' }}>
                <View style={{ flex: isPhone ? undefined : 1, maxWidth: isPhone ? undefined : 360 }}>
                  <TextField
                    label="Search your apps"
                    labelHidden
                    icon={Search}
                    value={query}
                    onChangeText={setQuery}
                    placeholder="Search your apps"
                    returnKeyType="search"
                    autoCorrect={false}
                  />
                </View>
                {apps.length > 1 ? (
                  <SegmentedControl<'recent' | 'name'>
                    label="Sort apps"
                    labelHidden
                    value={sort}
                    onChange={setSort}
                    options={[{ value: 'recent', label: 'Recent' }, { value: 'name', label: 'Name' }]}
                  />
                ) : null}
              </View>
            ) : null}
            {!loaded && apps.length === 0 ? (
              <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 24 }}>
                <ActivityIndicator color={theme.colors.primary} />
                <Text tone="secondary">Opening your shelf…</Text>
              </View>
            ) : null}
            {query && visible.length === 0 ? (
              <View style={{ gap: 12, paddingVertical: 16 }}>
                <Text variant="h4">No apps match “{query.trim()}”</Text>
                <Text tone="secondary">Search looks at app names and descriptions.</Text>
                <Button label="Clear search" variant="outline" onPress={() => setQuery('')} />
              </View>
            ) : null}
            <View
              ref={grid}
              onLayout={(e) => setGridW(e.nativeEvent.layout.width)}
              role="list"
              style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GAP }}
            >
              {cardW > 0 ? visible.map((app, i) => (
                <View key={app.id} role="listitem" style={{ width: cardW }}>
                  <AppCard app={app} width={cardW} index={i} onMenu={(a, anchor) => setMenu({ app: a, anchor })} />
                </View>
              )) : null}
            </View>
          </View>
        )}
      </Screen>

      <Menu
        visible={!!menu}
        onClose={() => setMenu(null)}
        title={menu ? menu.app.spec.name : 'App actions'}
        items={menuItems}
        anchor={menu?.anchor}
      />
      <RenameSheet app={toRename} onClose={() => setToRename(null)} onDone={(name) => toast.show({ message: `Renamed to ${name}`, tone: 'success' })} />
      <AppDetailsSheet app={details} onClose={() => setDetails(null)} />
      <ConfirmSheet
        visible={!!toDelete}
        title={toDelete ? `Delete “${toDelete.spec.name}”?` : 'Delete app?'}
        message="This removes the app, its saved versions and every record stored in it on this device. Backups you exported stay wherever you saved them."
        confirmLabel="Delete app"
        destructive
        onCancel={() => setToDelete(null)}
        onConfirm={async () => {
          if (!toDelete) return;
          const name = toDelete.spec.name;
          await run(`Deleted ${name}`, () => remove(toDelete.id));
          setToDelete(null);
        }}
      />
    </AppShell>
  );
}

/** docs/07 §13.6: count of successful on-device AI actions. */
function OnDeviceCounter({ count }: { count: number }) {
  const theme = useKalamTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, maxWidth: '100%' }}>
      <Smartphone size={15} color={theme.colors.sourceOnDevice} strokeWidth={2.2} />
      <Text tone="secondary" numeric style={{ flexShrink: 1 }}>
        {count === 0 ? 'No AI actions have run on this device yet' : `${count.toLocaleString()} AI ${count === 1 ? 'action' : 'actions'} ran on this device`}
      </Text>
    </View>
  );
}

/** Online/offline + on-device AI readiness — real state from the services, links to Settings. */
function StatusChips({ compact }: { compact?: boolean }) {
  const theme = useKalamTheme();
  const online = useOnline();
  const { status } = useAIStatus();
  const od = describeOnDevice(status?.onDevice);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
      {online
        ? (compact ? null : <Chip label="Online" icon={Wifi} />)
        : <SourceBadge source="offline" size="md" label={compact ? 'Offline' : 'Offline. Apps still work'} />}
      <Link href={routes.settings} asChild>
        <Pressable role="link" accessibilityLabel={`${od.label}. Open settings.`} style={{ borderRadius: theme.radius.pill }} hitSlop={8}>
          <Chip label={compact ? od.short : od.label} icon={Smartphone} tone={od.ready ? 'success' : 'neutral'} />
        </Pressable>
      </Link>
    </View>
  );
}
