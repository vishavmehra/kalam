import { Link, router, useFocusEffect } from 'expo-router';
import {
  Archive, ArchiveRestore, CircleAlert, Copy, FileDown, Info, KeyRound, LayoutTemplate, PenLine, Pin, PinOff, Play, RefreshCw, Search, Smartphone,
  TextCursorInput, Trash2, Upload, Users,
} from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';

import { safeFilename, saveJsonFile } from '@/components/files/json-file';
import { AppShell } from '@/components/shell/AppShell';
import { routes } from '@/components/shell/routes';
import { describeOnDevice, useAIStatus, useOnline } from '@/components/status/useHybridStatus';
import { COLLAB_COPY } from '@/features/collab/copy';
import type { StoredApp } from '@/core/contracts';
import type { ShelfCategory } from '@/core/templates/catalog';
import {
  Button, ConfirmSheet, IconButton, LedgerRule, Menu, type MenuAnchor, OfflineIcon, Screen, SegmentedControl, ShelfPlank, Slip, Stamp, Text, TextField,
  useBreakpoint, useKalamTheme, useToast,
} from '@/design';
import { bazaarRoutes } from '@/features/bazaar/routes';
import { EndedNotices, getCollabService, JoinSheet, TeamSheet } from '@/features/collab';
import { QueueStatusPill } from '@/features/queue';
import { CloneSheet, ShelfCategoryBar, templatesCopy, useArchiveApp } from '@/features/templates';
import { DashboardCards } from '@/features/widgets';
import { useT } from '@/i18n/react';
import { getServices } from '@/services';
import { useAppsStore } from '@/state/apps-store';
import { useSettingsStore } from '@/state/settings-store';

import { AppCard } from './AppCard';
import { AppDetailsSheet, RenameSheet } from './AppSheets';
import { shelfView } from './model';
import { shelfSentences } from './read-aloud';
import { ShelfReadAloud } from './ShelfReadAloud';
import { shelfRoutes } from './routes';
import { ShelfEmpty } from './ShelfEmpty';

const GAP = 24;
const MIN_COVER = 176;
/** Registers on a real shelf are not all the same height. */
const HEIGHTS = [400, 384, 404, 372, 392, 380];

/**
 * Saved entries per app, for the stat line on each cover. Re-counted whenever the shelf list is re-read.
 * ponytail: reads every entry of every app to count it; add RecordRepository.count() if shelves grow large.
 */
function useEntryCounts(apps: StoredApp[]): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    let alive = true;
    const records = getServices().db.records;
    // Each app is counted on its own: one unreadable app shows no count, the others still do.
    const count = (id: string) =>
      records.listAll(id).then((all) => Object.values(all).reduce((n, l) => n + l.length, 0), () => undefined);
    void Promise.all(apps.map(async (a) => [a.id, await count(a.id)] as const)).then((pairs) => {
      if (!alive) return;
      const out: Record<string, number> = {};
      for (const [id, n] of pairs) if (n !== undefined) out[id] = n;
      setCounts(out);
    });
    return () => { alive = false; };
  }, [apps]);
  return counts;
}

/** App Shelf (docs/02 §11.2, docs/03 §5, DIRECTION §6): every app on this device as a register, offline. */
export function ShelfScreen() {
  const theme = useKalamTheme();
  const { isPhone, hasRail } = useBreakpoint();
  const { width: windowW } = useWindowDimensions();
  const toast = useToast();
  const t = useT(theme.uiLanguage);
  const apps = useAppsStore((s) => s.apps);
  const loading = useAppsStore((s) => s.loading);
  const refresh = useAppsStore((s) => s.refresh);
  const remove = useAppsStore((s) => s.remove);
  const pin = useAppsStore((s) => s.pin);
  const onDeviceCount = useSettingsStore((s) => s.settings.onDeviceActionCount);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState('');
  const [shelfW, setShelfW] = useState(0);
  const [menu, setMenu] = useState<{ app: StoredApp; anchor: MenuAnchor | null } | null>(null);
  const [toDelete, setToDelete] = useState<StoredApp | null>(null);
  const [toRename, setToRename] = useState<StoredApp | null>(null);
  const [details, setDetails] = useState<StoredApp | null>(null);
  const [sort, setSort] = useState<'recent' | 'name'>('recent');
  const [toClone, setToClone] = useState<StoredApp | null>(null);
  const [category, setCategory] = useState<ShelfCategory | 'all'>('all');
  const [showArchive, setShowArchive] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [teamsOpen, setTeamsOpen] = useState(false);
  /** What deleting would also do, when the app is shared with other people (read when the question opens). */
  const [deleteExtra, setDeleteExtra] = useState<string | undefined>();
  const archive = useArchiveApp();
  const [loadError, setLoadError] = useState(false);
  const entries = useEntryCounts(apps);

  const load = useCallback(() => {
    setLoadError(false);
    refresh()
      .catch(() => setLoadError(true))
      .finally(() => setLoaded(true));
  }, [refresh]);
  useFocusEffect(load);

  // Shared apps say so before they are deleted: the owner's delete also ends the sharing, a member's delete is a leave.
  useEffect(() => {
    setDeleteExtra(undefined);
    if (!toDelete) return undefined;
    let alive = true;
    getCollabService().space(toDelete.id).then(
      (space) => alive && setDeleteExtra(space ? (space.role === 'owner' ? COLLAB_COPY.deleteShared.owner : COLLAB_COPY.deleteShared.member) : undefined),
      () => undefined,
    );
    return () => { alive = false; };
  }, [toDelete]);

  const visible = useMemo(() => shelfView(apps, { query, sort, category, archived: showArchive }), [apps, query, sort, category, showArchive]);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    try { await fn(); toast.show({ message: label, tone: 'success' }); }
    catch { toast.show({ message: t('errors.generic'), tone: 'danger' }); }
  };
  const open = useCallback((app: StoredApp) => router.push(routes.app(app.id)), []);

  const menuItems = menu ? [
    { key: 'open', label: t('common.open'), icon: Play, onSelect: () => open(menu.app) },
    { key: 'edit', label: t('common.edit'), icon: PenLine, onSelect: () => router.push(routes.editApp(menu.app.id)) },
    menu.app.pinned
      ? { key: 'unpin', label: t('shelf.actions.unpin'), icon: PinOff, onSelect: () => void run(t('shelf.toast.unpinned'), () => pin(menu.app.id, false)) }
      : { key: 'pin', label: t('shelf.actions.pin'), icon: Pin, onSelect: () => void run(t('shelf.toast.pinned'), () => pin(menu.app.id, true)) },
    { key: 'rename', label: t('shelf.actions.rename'), icon: TextCursorInput, onSelect: () => setToRename(menu.app) },
    { key: 'details', label: t('shelf.actions.details'), icon: Info, onSelect: () => setDetails(menu.app) },
    { key: 'clone', label: t('shelfMore.copy'), icon: Copy, onSelect: () => setToClone(menu.app) },
    menu.app.archived
      ? { key: 'archive', label: t('shelfMore.unarchive'), icon: ArchiveRestore, onSelect: () => void archive(menu.app, false) }
      : { key: 'archive', label: t('shelfMore.archive'), icon: Archive, onSelect: () => void archive(menu.app, true) },
    { key: 'share', label: t('shelf.actions.share'), icon: Upload, onSelect: () => router.push(bazaarRoutes.publish({ appId: menu.app.id })) },
    { key: 'export', label: t('shelf.actions.export'), icon: FileDown, onSelect: () => void run(t('shelf.toast.exported', { name: menu.app.spec.name }), () => saveJsonFile(safeFilename(menu.app.spec.name, 'kalam.json'), menu.app.spec)) },
    { key: 'delete', label: t('shelf.actions.delete'), icon: Trash2, destructive: true, onSelect: () => setToDelete(menu.app) },
  ] : [];

  const empty = loaded && !loading && !loadError && apps.length === 0;
  const countLine = t('shelf.countOnDevice', { count: apps.length });

  // Read-aloud mode (docs/10 §17.1, §4.4): the shelf is said sentence by sentence, with Pause, Resume, Stop and Repeat.
  const names = useMemo(() => apps.map((a) => a.spec.name), [apps]);
  const readSentences = useMemo(
    () => (names.length ? shelfSentences(t('shelf.readAloud', { summary: countLine }), names) : [t('shelf.empty.line')]),
    [names, countLine, t],
  );

  // Phones scroll one row of covers sideways; Large mode on a phone shows two columns instead (DIRECTION §6).
  const strip = isPhone && theme.fontScale <= 1.2;
  const maxCover = MIN_COVER * Math.min(theme.fontScale, 1.25);
  const cols = isPhone ? 2 : Math.max(2, Math.min(6, Math.floor((shelfW + GAP) / (maxCover + GAP))));
  const coverW = shelfW > 0 ? Math.floor((shelfW - GAP * (cols - 1)) / cols) : 0;
  const rows = useMemo(() => {
    const out: StoredApp[][] = [];
    for (let i = 0; i < visible.length; i += cols) out.push(visible.slice(i, i + cols));
    return out;
  }, [visible, cols]);
  const cover = (app: StoredApp, i: number) => (
    // Phone covers are a little shorter so a whole register shows above the tab bar.
    <AppCard key={app.id} app={app} height={Math.round(HEIGHTS[i % HEIGHTS.length]! * (isPhone ? 0.84 : 1))} entries={entries[app.id]} onOpen={open} onMenu={(a, anchor) => setMenu({ app: a, anchor })} />
  );

  return (
    <AppShell active="shelf">
      <Screen>
        <View style={{ flexDirection: hasRail ? 'row' : 'column', alignItems: hasRail ? 'flex-end' : 'stretch', gap: 16, marginBottom: 28 }}>
          <View style={{ flex: hasRail ? 1 : undefined, gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <Text variant="h1">{t('shelf.title')}</Text>
              {/* Phones keep the shelf tools as icons beside the title, so a whole register still shows above the tab bar. */}
              {isPhone ? (
                <View style={{ flexDirection: 'row', marginEnd: -8 }}>
                  <IconButton icon={KeyRound} label={t('shelfMore.join')} onPress={() => setJoinOpen(true)} testID="shelf-join" />
                  <IconButton icon={Users} label={t('shelfMore.teams')} onPress={() => setTeamsOpen(true)} testID="shelf-teams" />
                  {empty ? null : <IconButton icon={LayoutTemplate} label={templatesCopy.page.title} onPress={() => router.push(shelfRoutes.templates)} testID="shelf-templates" />}
                </View>
              ) : null}
            </View>
            <LedgerRule />
            {empty ? null : (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 16, rowGap: 4, marginTop: 10 }}>
                <Text tone="secondary">{countLine}</Text>
                <OnDeviceCounter count={onDeviceCount} />
              </View>
            )}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <StatusStamps />
            <QueueStatusPill onPress={() => router.push(shelfRoutes.queue)} />
            {hasRail && !empty ? <Button label={t('shelf.create')} icon={PenLine} onPress={() => router.push(routes.create)} /> : null}
          </View>
        </View>

        <ShelfReadAloud sentences={readSentences} ready={loaded && !loading && !loadError} />
        <EndedNotices />
        {isPhone ? null : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 24 }}>
            <Button label={t('shelfMore.join')} variant="outline" size="sm" icon={KeyRound} onPress={() => setJoinOpen(true)} testID="shelf-join" />
            <Button label={t('shelfMore.teams')} variant="outline" size="sm" icon={Users} onPress={() => setTeamsOpen(true)} testID="shelf-teams" />
            {empty ? null : <Button label={templatesCopy.page.title} variant="outline" size="sm" icon={LayoutTemplate} onPress={() => router.push(shelfRoutes.templates)} testID="shelf-templates" />}
          </View>
        )}

        {loadError ? (
          // Errors sit on the danger wash with an icon beside the words (DIRECTION §6).
          <View style={{ maxWidth: 620, gap: 16, padding: 20, borderRadius: theme.radius.paper, backgroundColor: theme.colors.dangerSoft }}>
            <View accessibilityRole="alert" style={{ gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <CircleAlert size={20} color={theme.colors.danger} strokeWidth={2.2} />
                <Text variant="h4" style={{ flex: 1 }}>{t('shelf.loadErrorTitle')}</Text>
              </View>
              <Text tone="secondary">{t('shelf.loadErrorBody')}</Text>
            </View>
            <View style={{ alignSelf: 'flex-start' }}>
              <Button label={t('common.tryAgain')} icon={RefreshCw} onPress={load} />
            </View>
          </View>
        ) : empty ? <ShelfEmpty /> : (
          <View style={{ gap: 28 }}>
            <DashboardCards />
            <ShelfCategoryBar apps={apps} category={category} onCategory={setCategory} archived={showArchive} onArchived={setShowArchive} />
            {apps.length || query ? (
              <View style={{ flexDirection: isPhone ? 'column' : 'row', gap: 12, alignItems: isPhone ? 'stretch' : 'center' }}>
                <View style={{ flex: isPhone ? undefined : 1, maxWidth: isPhone ? undefined : 360 }}>
                  <TextField
                    label={t('shelf.search.label')}
                    labelHidden
                    icon={Search}
                    value={query}
                    onChangeText={setQuery}
                    placeholder={t('shelf.search.label')}
                    returnKeyType="search"
                    autoCorrect={false}
                  />
                </View>
                {apps.length > 1 ? (
                  <SegmentedControl<'recent' | 'name'>
                    label={t('shelf.sort.label')}
                    labelHidden
                    value={sort}
                    onChange={setSort}
                    options={[{ value: 'recent', label: t('shelf.sort.recent') }, { value: 'name', label: t('shelf.sort.name') }]}
                  />
                ) : null}
              </View>
            ) : null}
            {!loaded && apps.length === 0 ? (
              <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 24 }}>
                <ActivityIndicator color={theme.colors.primary} />
                <Text tone="secondary">{t('shelf.loading')}</Text>
              </View>
            ) : null}
            {query && visible.length === 0 ? (
              <Slip tint="kraft" style={{ maxWidth: 560 }}>
                <View accessibilityLiveRegion="polite" style={{ gap: 6 }}>
                  <Text variant="h4">{t('shelf.search.noneFor', { query: query.trim() })}</Text>
                  <Text tone="secondary">{t('shelf.search.hint')}</Text>
                </View>
                <View style={{ alignSelf: 'flex-start' }}>
                  <Button label={t('shelf.search.clear')} variant="outline" onPress={() => setQuery('')} />
                </View>
              </Slip>
            ) : null}

            {!query && loaded && visible.length === 0 && apps.length > 0 ? (
              <Text tone="secondary">{showArchive ? templatesCopy.shelf.emptyArchive : t('shelfMore.allArchived')}</Text>
            ) : null}

            {visible.length ? (
              strip ? (
                <View>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    snapToInterval={Math.round(windowW * 0.72) + 16}
                    decelerationRate="fast"
                    contentContainerStyle={{ gap: 16, paddingTop: 12, paddingBottom: 2, paddingEnd: 16, alignItems: 'flex-end' }}
                  >
                    <View role="list" style={{ flexDirection: 'row', gap: 16, alignItems: 'flex-end' }}>
                      {visible.map((app, i) => (
                        <View key={app.id} role="listitem" style={{ width: Math.round(windowW * 0.72) }}>{cover(app, i)}</View>
                      ))}
                    </View>
                  </ScrollView>
                  <ShelfPlank />
                </View>
              ) : (
                <View onLayout={(e) => setShelfW(e.nativeEvent.layout.width)} style={{ gap: 40 }}>
                  {coverW > 0 ? rows.map((row, r) => (
                    <View key={row[0]!.id}>
                      <View role="list" style={{ flexDirection: 'row', gap: GAP, alignItems: 'flex-end', paddingTop: 12, paddingHorizontal: 0 }}>
                        {row.map((app, i) => (
                          <View key={app.id} role="listitem" style={{ width: coverW }}>{cover(app, r * cols + i)}</View>
                        ))}
                      </View>
                      <ShelfPlank />
                    </View>
                  )) : null}
                </View>
              )
            ) : null}
          </View>
        )}
      </Screen>

      <Menu
        visible={!!menu}
        onClose={() => setMenu(null)}
        title={menu ? menu.app.spec.name : t('shelf.actions.title')}
        items={menuItems}
        anchor={menu?.anchor}
      />
      <RenameSheet app={toRename} onClose={() => setToRename(null)} onDone={(name) => toast.show({ message: t('shelf.toast.renamed', { name }), tone: 'success' })} />
      <CloneSheet app={toClone} onClose={() => setToClone(null)} onCloned={() => setToClone(null)} />
      <JoinSheet
        visible={joinOpen}
        onClose={() => setJoinOpen(false)}
        onJoined={(r) => { setJoinOpen(false); if (r.kind === 'app') router.push(routes.app(r.localAppId)); else void refresh(); }}
      />
      <TeamSheet visible={teamsOpen} onClose={() => setTeamsOpen(false)} onOpenApp={(id) => { setTeamsOpen(false); router.push(routes.app(id)); }} />
      <AppDetailsSheet app={details} entries={details ? entries[details.id] : undefined} onClose={() => setDetails(null)} />
      <ConfirmSheet
        visible={!!toDelete}
        title={toDelete ? t('shelf.delete.title', { name: toDelete.spec.name }) : t('shelf.delete.confirm')}
        // Links with other apps go in the same delete (removeAppCascade), so the question says so.
        message={[t('shelf.delete.message'), t('shelf.delete.links'), deleteExtra].filter(Boolean).join(' ')}
        confirmLabel={t('shelf.delete.confirm')}
        destructive
        onCancel={() => setToDelete(null)}
        onConfirm={async () => {
          if (!toDelete) return;
          const name = toDelete.spec.name;
          const wasShared = deleteExtra !== undefined;
          await run(t('shelf.toast.deleted', { name }), () => remove(toDelete.id));
          // The owner's delete stops the sharing and a member's is a leave; the sync does that remotely (it also happens on the next sync).
          if (wasShared) void getCollabService().sync(toDelete.id);
          setToDelete(null);
        }}
      />
    </AppShell>
  );
}

/** docs/07 §13.6: count of successful on-device AI actions. */
function OnDeviceCounter({ count }: { count: number }) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, maxWidth: '100%' }}>
      <Smartphone size={15} color={theme.colors.sourceOnDevice} strokeWidth={2.2} />
      <Text tone="secondary" numeric style={{ flexShrink: 1 }}>
        {count === 0 ? t('shelf.onDeviceNone') : t('shelf.onDeviceCount', { count })}
      </Text>
    </View>
  );
}

/** Offline (a quiet graphite stamp) and on-device AI readiness, from the real services. Links to Settings. */
function StatusStamps() {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const online = useOnline();
  const { status } = useAIStatus();
  const od = describeOnDevice(status?.onDevice);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      {online ? null : <Stamp kind="template" icon={OfflineIcon} label={t('network.offlineAppsWork')} />}
      <Link href={routes.settings} asChild>
        <Pressable
          role="link"
          accessibilityLabel={t('shelf.openSettings', { status: od.label })}
          hitSlop={10}
          style={{ minHeight: theme.touchTarget, justifyContent: 'center', borderRadius: theme.radius.stamp }}
        >
          <Stamp kind={od.ready ? 'device' : 'plain'} label={od.label} />
        </Pressable>
      </Link>
    </View>
  );
}
