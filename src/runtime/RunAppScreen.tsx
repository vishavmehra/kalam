/**
 * /app/[id] — opens an installed app (docs/09 §11.2): load → migrate → validate → render, then
 * touch lastOpenedAt. Kalam chrome stays a thin bar (DIRECTION §6): shelf key, app name, the
 * "On this phone" stamp and the edit pen. The app below uses its own theme. Less common tools (share with
 * people, home-screen widgets, export an entry) live in More at every width.
 * No cloud call is needed to open or use the app.
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { ArrowLeft, Bell, ChartColumn, Ellipsis, FileDown, LayoutGrid, MessageCircleQuestion, Pencil, PenLine, Share2, Users } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { canChangeStructure, COLLAB_COPY } from '@/core/collab';
import type { RuntimeServices, StoredApp } from '@/core/contracts';
import { timings } from '@/core/observability';
import { migrateSpec, validateSpec } from '@/core/spec';
import { reportError, track } from '@/core/telemetry';
import { Button, EmptyState, IconButton, Menu, OfflineIcon, Sheet, Stamp, Text, useBreakpoint, useKalamTheme, useToast } from '@/design';
import { AskButton, AssistantSheet } from '@/features/assistant';
import { AttributionNote } from '@/features/bazaar/AttributionNote';
import { getCollabService, ShareWithPeopleSheet, SyncStatusBadge, useSyncStatus } from '@/features/collab';
import { DocumentScan } from '@/features/document-intel';
import { RemindersPanel, useReminderSync } from '@/features/reminders';
import { listDateFields } from '@/features/reminders/rules';
import { hasReports, ReportsButton, ReportsSheet } from '@/features/reports';
import { ExportEntrySheet, ShareButton, ShareLinksSheet } from '@/features/share';
import { AddToHomeScreenSheet, WIDGET_UI } from '@/features/widgets';
import { t as gt } from '@/i18n/active';
import { useT } from '@/i18n/react';
import { getServices } from '@/services';
import { useSettingsStore } from '@/state/settings-store';
import { KalamRuntime } from './KalamRuntime';
import { createDeviceRuntimeServices } from './memory-services';
import { LanguageSwitch, OptionLabelsProvider, useAppTranslation } from './translation';

export type AppLoad =
  | { kind: 'loading' }
  | { kind: 'missing' }
  /** `app` is the raw stored app (when readable) so the editor can still restore an older version. */
  | { kind: 'unsupported'; message: string; app?: StoredApp }
  | { kind: 'ready'; app: StoredApp };
type Load = AppLoad;

/** Loads an app and checks it is safe to render. Shared by the run and edit screens. */
export async function loadRunnableApp(id: string): Promise<Load> {
  const app = await getServices().db.apps.get(id);
  if (!app) return { kind: 'missing' };
  const migrated = migrateSpec(app.spec);
  if (!migrated.ok) return { kind: 'unsupported', app, message: migrated.error ?? gt('run.unsupported.format') };
  const checked = validateSpec(migrated.spec);
  if (!checked.ok || !checked.spec) {
    // A closed validation code, never the design itself (docs/11 §8).
    reportError(checked.errors[0]?.code);
    return { kind: 'unsupported', app, message: gt('run.unsupported.problems', { count: checked.errors.length }) };
  }
  if (migrated.migratedFrom) {
    // Keep the upgraded format (docs/05 §16). The old design stays in History as the recovery copy.
    try {
      const saved = await getServices().db.apps.save(
        { ...app, spec: checked.spec, updatedAt: Date.now() },
        { summary: gt('run.migratedSummary', { from: String(migrated.migratedFrom) }), source: 'edit' },
      );
      return { kind: 'ready', app: saved };
    } catch {
      // Not saved: still open the upgraded copy; the next open tries again.
    }
  }
  return { kind: 'ready', app: { ...app, spec: checked.spec } };
}

/** Access modes for generated apps: the person's settings plus stricter device settings (theme). */
export function useAccessModes() {
  const modes = useKalamTheme().accessModes;
  const hydrated = useSettingsStore((s) => s.hydrated);
  useEffect(() => {
    if (!hydrated) void useSettingsStore.getState().load().catch(() => undefined);
  }, [hydrated]);
  return modes;
}

export function useOnline(): boolean {
  const network = getServices().network;
  const [online, setOnline] = useState(() => network.online());
  useEffect(() => network.subscribe(setOnline), [network]);
  return online;
}

export interface RunAppScreenProps {
  id: string;
  /** A widget tap or a link (`kalam://app/<id>?screen=<screen>`) opens the app on this screen. */
  startScreen?: string;
  /** The runtime has used `startScreen`; the route clears it so a second tap on the same widget works. */
  onStartScreenUsed?: () => void;
}

export function RunAppScreen({ id, startScreen, onStartScreenUsed }: RunAppScreenProps) {
  const router = useRouter();
  const toast = useToast();
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const insets = useSafeAreaInsets();
  const accessModes = useAccessModes();
  const online = useOnline();
  const services = useMemo(() => createDeviceRuntimeServices(), []);
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  /** An open is counted once per visit, not on every return from the editor. */
  const counted = useRef(false);

  // Reload on focus so returning from the editor shows the newest version.
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      // The timing covers the storage read, migration and validation: how long opening an app takes (docs/09 §22).
      const opening = timings.start('app_open');
      loadRunnableApp(id)
        .then((l) => {
          opening.stop({ ok: l.kind === 'ready' });
          if (!alive) return;
          setLoad(l);
          if (l.kind === 'ready') {
            void getServices().db.apps.touch(id).catch(() => undefined);
            if (!counted.current) {
              counted.current = true;
              track('app_opened', getServices().network.online() ? 'online' : 'offline');
            }
          }
        })
        .catch((e: unknown) => {
          opening.stop({ ok: false });
          reportError(e);
          if (alive) setLoad({ kind: 'unsupported', message: gt('run.unsupported.storage') });
        });
      return () => {
        alive = false;
      };
    }, [id]),
  );

  // "Back to your apps" always lands on the shelf. After saving a new app Create is still on the stack, so a plain
  // back would return there; dismissTo pops down to the shelf instead, and replaces when nothing is behind this screen.
  const toShelf = useCallback(() => (router.canGoBack() ? router.dismissTo('/') : router.replace('/')), [router]);
  const app = load.kind === 'ready' ? load.app : undefined;
  const { isPhone, width } = useBreakpoint();
  /**
   * The full row of chrome actions needs about 1180 px. Below that Ask, Reports, Share, Reminders and Draw
   * move into More so the app name keeps its room; phones also fold Edit in and shrink the stamps to icons.
   */
  const compact = width < 1180;
  const tightStamps = width < 900;
  const [remindersOpen, setRemindersOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [reportsOpen, setReportsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [widgetsOpen, setWidgetsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  useReminderSync(app?.id);
  // Labels in another language are a view of the app; records and the saved design stay as they are.
  const tr = useAppTranslation(app?.spec);
  // DEGRADED (docs/09 §11.3): the app works, but its AI steps need the internet.
  const aiSteps = app ? Object.keys(app.spec.aiBlocks ?? {}).length : 0;
  // Reminders only make sense for apps that record dates.
  const canRemind = useMemo(() => !!app && listDateFields(app.spec).length > 0, [app]);
  // Load an already downloaded Gemini Nano into memory before the first AI step or voice command.
  // It never starts a download and never contacts the cloud.
  const wantsNano = aiSteps > 0 || accessModes.voiceOnly === true;
  useEffect(() => {
    if (app?.id && wantsNano) void getServices().ai.warmUpOnDevice().catch(() => undefined);
  }, [app?.id, wantsNano]);
  // Only the owner of a shared app changes its design; a member is told why and nothing opens (docs/14 section 17).
  const editAt = useCallback(
    async (path: '' | '?draw=1') => {
      const space = await getCollabService().space(id).catch(() => undefined);
      if (space && !canChangeStructure(space.role)) {
        toast.show({ message: COLLAB_COPY.errors.structure_owner_only, tone: 'info' });
        return;
      }
      router.push(`/app/${id}/edit${path}`);
    },
    [router, id, toast],
  );
  const openEdit = useCallback(() => void editAt(''), [editAt]);
  const openDrawing = useCallback(() => void editAt('?draw=1'), [editAt]);
  // Saved confirmations show in the shell's toast slot (top on phones), so they never cover the app (docs/02 section 10.6).
  const onToast = useCallback(
    (message: string, tone: 'success' | 'info' | 'warning' | 'error') => toast.show({ message, tone: tone === 'error' ? 'danger' : tone === 'warning' ? 'info' : tone }),
    [toast],
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View
        style={{
          flexDirection: 'row', alignItems: 'center', gap: isPhone ? 2 : 8, paddingTop: insets.top + 4, paddingBottom: 4,
          paddingHorizontal: isPhone ? 4 : 12, borderBottomWidth: 1, borderBottomColor: theme.colors.border, backgroundColor: theme.colors.surface,
        }}
      >
        <IconButton icon={ArrowLeft} label={t('run.back')} onPress={toShelf} />
        {/* The name never collapses: it keeps at least 96 px and the actions fold into More before that. */}
        <View style={{ flex: 1, minWidth: 96, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ flexShrink: 1, minWidth: 64 }}>
            <Text variant="h4" numberOfLines={1} {...(app ? ({ lang: app.spec.lang } as object) : {})}>
              {app?.spec.name ?? ''}
            </Text>
            {app ? <AttributionNote spec={app.spec} /> : null}
          </View>
          {/* Where the app and its entries live. Offline is normal: a quiet graphite stamp, never a banner. */}
          {app ? (
            <Stamp kind="device" label={t('run.onThisPhone')} size="sm" iconOnly={tightStamps} accessibilityLabel={t('run.onThisPhoneHint')} />
          ) : null}
          {!online ? (
            <Stamp kind="template" icon={OfflineIcon} label={t('network.offline')} size="sm" iconOnly={tightStamps} accessibilityLabel={t('run.offlineHint')} />
          ) : null}
        </View>
        {/* Phones have no room for the language name beside the app name, so they get the icon alone. */}
        {app ? <LanguageSwitch translation={tr} compact={isPhone} /> : null}
        {/* Phones keep Ask one tap away as an icon; tablets and small laptops find it in More. */}
        {app && isPhone ? <IconButton icon={MessageCircleQuestion} label={t('run.ask')} onPress={() => setAskOpen(true)} /> : null}
        {app && !compact ? <AskButton spec={app.spec} appId={app.id} /> : null}
        {app && !compact ? <ReportsButton spec={app.spec} appId={app.id} /> : null}
        {app && !compact ? <ShareButton spec={app.spec} appId={app.id} /> : null}
        {app && !compact && canRemind ? (
          <Button label={t('run.reminders')} variant="ghost" size="sm" icon={Bell} onPress={() => setRemindersOpen(true)} />
        ) : null}
        {/* Draw on the running app to change it (docs/08 §16.2). */}
        {app && !compact ? <Button label={t('run.draw')} variant="ghost" size="sm" icon={PenLine} onPress={openDrawing} /> : null}
        {app ? <IconButton icon={Ellipsis} label={t('run.more')} onPress={() => setMoreOpen(true)} /> : null}
        {app && !isPhone ? <Button label={t('common.edit')} variant="outline" size="sm" icon={Pencil} onPress={openEdit} /> : null}
      </View>
      {app && !online && aiSteps > 0 ? (
        <View role="status" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 6, backgroundColor: theme.colors.surfaceAlt }}>
          <OfflineIcon size={14} color={theme.colors.graphite} strokeWidth={2.2} />
          <Text variant="bodySmall" style={{ flex: 1, color: theme.colors.graphite }}>{t('run.offlineAiSteps')}</Text>
        </View>
      ) : null}

      {app ? (
        <AppToolsStrip
          app={app}
          services={services}
          onPeople={() => setPeopleOpen(true)}
        />
      ) : null}

      {load.kind === 'loading' ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={theme.colors.primary} accessibilityLabel={t('run.opening')} />
        </View>
      ) : load.kind === 'missing' ? (
        <View style={{ flex: 1, justifyContent: 'center', padding: 24 }}>
          <EmptyState
            title={t('run.missing.title')}
            description={t('run.missing.description')}
            action={<Button label={t('run.missing.cta')} onPress={() => router.replace('/')} />}
          />
        </View>
      ) : load.kind === 'unsupported' ? (
        <View style={{ flex: 1, justifyContent: 'center', padding: 24 }}>
          <EmptyState
            title={t('run.unsupported.title')}
            description={load.message}
            action={<Button label={t('run.unsupported.cta')} variant="outline" onPress={() => router.push(`/app/${id}/edit`)} />}
          />
        </View>
      ) : (
        <OptionLabelsProvider value={tr.optionLabels}>
          <KalamRuntime
            key={load.app.id}
            spec={tr.spec ?? load.app.spec}
            appId={load.app.id}
            services={services}
            mode="live"
            accessModes={accessModes}
            startScreen={startScreen}
            onStartScreenUsed={onStartScreenUsed}
            onToast={onToast}
          />
        </OptionLabelsProvider>
      )}
      {app && compact ? <AssistantSheet spec={app.spec} appId={app.id} visible={askOpen} onClose={() => setAskOpen(false)} /> : null}
      {app && compact ? <ReportsSheet spec={app.spec} appId={app.id} visible={reportsOpen} onClose={() => setReportsOpen(false)} /> : null}
      {app && compact ? <ShareLinksSheet spec={app.spec} appId={app.id} visible={shareOpen} onClose={() => setShareOpen(false)} /> : null}
      {app ? (
        <Menu
          visible={moreOpen}
          onClose={() => setMoreOpen(false)}
          title={app.spec.name}
          items={[
            ...(compact && !isPhone ? [{ key: 'ask', label: t('run.ask'), icon: MessageCircleQuestion, onSelect: () => setAskOpen(true) }] : []),
            ...(compact && hasReports(app.spec) ? [{ key: 'reports', label: t('run.reports'), icon: ChartColumn, onSelect: () => setReportsOpen(true) }] : []),
            ...(compact && canRemind ? [{ key: 'reminders', label: t('run.reminders'), icon: Bell, onSelect: () => setRemindersOpen(true) }] : []),
            ...(compact ? [{ key: 'share', label: t('run.share'), icon: Share2, onSelect: () => setShareOpen(true) }] : []),
            { key: 'people', label: t('runMore.people'), icon: Users, onSelect: () => setPeopleOpen(true) },
            { key: 'widgets', label: WIDGET_UI.button, icon: LayoutGrid, onSelect: () => setWidgetsOpen(true) },
            { key: 'export', label: t('runMore.exportEntry'), icon: FileDown, onSelect: () => setExportOpen(true) },
            ...(compact ? [{ key: 'draw', label: t('run.draw'), icon: PenLine, onSelect: openDrawing }] : []),
            ...(compact && isPhone ? [{ key: 'edit', label: t('common.edit'), icon: Pencil, onSelect: openEdit }] : []),
          ]}
        />
      ) : null}
      {app ? (
        <>
          <ShareWithPeopleSheet appId={app.id} spec={app.spec} visible={peopleOpen} onClose={() => setPeopleOpen(false)} onLeft={() => router.replace('/')} />
          <AddToHomeScreenSheet spec={app.spec} appId={app.id} visible={widgetsOpen} onClose={() => setWidgetsOpen(false)} />
          <ExportEntrySheet app={app} visible={exportOpen} onClose={() => setExportOpen(false)} />
        </>
      ) : null}
      {app && canRemind ? (
        <Sheet visible={remindersOpen} title={t('run.reminders')} onClose={() => setRemindersOpen(false)}>
          <RemindersPanel spec={app.spec} appId={app.id} />
        </Sheet>
      ) : null}
    </View>
  );
}

/** Under the chrome bar: how a shared app stands with the cloud, and the "read a document" step for apps that have one. Hidden when none applies. */
function AppToolsStrip({ app, services, onPeople }: { app: StoredApp; services: RuntimeServices; onPeople: () => void }) {
  const theme = useKalamTheme();
  const shared = useSyncStatus(app.id).shared;
  const scan = Object.values(app.spec.aiBlocks ?? {}).some((b) => b.kind === 'extractFromPhoto');
  if (!shared && !scan) return null;
  return (
    <View
      style={{
        flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingVertical: 6,
        borderBottomWidth: 1, borderBottomColor: theme.colors.border, backgroundColor: theme.colors.surfaceAlt,
      }}
    >
      <SyncStatusBadge appId={app.id} onPress={onPeople} />
      {scan ? <DocumentScan spec={app.spec} appId={app.id} services={services} /> : null}
    </View>
  );
}
