/**
 * /app/[id] — opens an installed app (docs/09 §11.2): load → migrate → validate → render, then
 * touch lastOpenedAt. Kalam chrome stays a slim bar; the app below uses its own theme.
 * No cloud call is needed to open or use the app.
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { ArrowLeft, Bell, Ellipsis, MessageCircleQuestion, Pencil, PenLine } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { StoredApp } from '@/core/contracts';
import { migrateSpec, validateSpec } from '@/core/spec';
import { AppIconTile, Button, EmptyState, IconButton, Menu, Sheet, SourceBadge, Text, useBreakpoint, useKalamTheme } from '@/design';
import { AskButton, AssistantSheet } from '@/features/assistant';
import { AttributionNote } from '@/features/bazaar/AttributionNote';
import { RemindersPanel, useReminderSync } from '@/features/reminders';
import { listDateFields } from '@/features/reminders/rules';
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
  if (!migrated.ok) return { kind: 'unsupported', app, message: migrated.error ?? 'This app uses a format Kalam cannot open.' };
  const checked = validateSpec(migrated.spec);
  if (!checked.ok || !checked.spec) {
    return {
      kind: 'unsupported',
      app,
      message: `This app's design has ${checked.errors.length} problem${checked.errors.length === 1 ? '' : 's'} Kalam can't open safely. Open History to restore an earlier version.`,
    };
  }
  if (migrated.migratedFrom) {
    // Keep the upgraded format (docs/05 §16). The old design stays in History as the recovery copy.
    try {
      const saved = await getServices().db.apps.save(
        { ...app, spec: checked.spec, updatedAt: Date.now() },
        { summary: `Updated from format ${migrated.migratedFrom}`, source: 'edit' },
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

export function RunAppScreen({ id }: { id: string }) {
  const router = useRouter();
  const theme = useKalamTheme();
  const insets = useSafeAreaInsets();
  const accessModes = useAccessModes();
  const online = useOnline();
  const services = useMemo(() => createDeviceRuntimeServices(), []);
  const [load, setLoad] = useState<Load>({ kind: 'loading' });

  // Reload on focus so returning from the editor shows the newest version.
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      loadRunnableApp(id)
        .then((l) => {
          if (!alive) return;
          setLoad(l);
          if (l.kind === 'ready') void getServices().db.apps.touch(id).catch(() => undefined);
        })
        .catch(() => alive && setLoad({ kind: 'unsupported', message: "This app couldn't be read from this device's storage." }));
      return () => {
        alive = false;
      };
    }, [id]),
  );

  const toShelf = useCallback(() => (router.canGoBack() ? router.back() : router.replace('/')), [router]);
  const app = load.kind === 'ready' ? load.app : undefined;
  const { isPhone } = useBreakpoint();
  const [remindersOpen, setRemindersOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
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
  const openEdit = useCallback(() => router.push(`/app/${id}/edit`), [router, id]);
  const openDrawing = useCallback(() => router.push(`/app/${id}/edit?draw=1`), [router, id]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View
        style={{
          flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: insets.top + 4, paddingBottom: 4,
          paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: theme.colors.border, backgroundColor: theme.colors.surface,
        }}
      >
        <IconButton icon={ArrowLeft} label="Back to your apps" onPress={toShelf} />
        {app && !isPhone ? <AppIconTile icon={app.spec.icon} appColor={app.spec.theme.primary} size={28} /> : null}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="h4" numberOfLines={1}>
            {app?.spec.name ?? ''}
          </Text>
          {app ? <AttributionNote spec={app.spec} /> : null}
        </View>
        {!online ? <SourceBadge source="offline" /> : null}
        {app ? <LanguageSwitch translation={tr} /> : null}
        {app ? (
          // Phones get icons and a "More" menu so the app name keeps its room (Large mode especially).
          isPhone ? <IconButton icon={MessageCircleQuestion} label="Ask about this app" onPress={() => setAskOpen(true)} /> : <AskButton spec={app.spec} appId={app.id} />
        ) : null}
        {app && isPhone ? <IconButton icon={Ellipsis} label="More actions" onPress={() => setMoreOpen(true)} /> : null}
        {app && !isPhone && canRemind ? (
          <Button label="Reminders" variant="ghost" size="sm" icon={Bell} onPress={() => setRemindersOpen(true)} />
        ) : null}
        {/* Draw on the running app to change it (docs/08 §16.2). */}
        {app && !isPhone ? <IconButton icon={PenLine} label="Edit by drawing" onPress={openDrawing} /> : null}
        {app && !isPhone ? <Button label="Edit" variant="ghost" size="sm" icon={Pencil} onPress={openEdit} /> : null}
      </View>
      {app && !online && aiSteps > 0 ? (
        <View accessibilityRole="alert" style={{ paddingHorizontal: 16, paddingVertical: 8, backgroundColor: theme.colors.warningSoft }}>
          <Text variant="bodySmall" style={{ color: theme.colors.warning }}>
            You are offline. Everything works except the AI steps in this app, which need the internet.
          </Text>
        </View>
      ) : null}

      {load.kind === 'loading' ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={theme.colors.primary} accessibilityLabel="Opening app" />
        </View>
      ) : load.kind === 'missing' ? (
        <View style={{ flex: 1, justifyContent: 'center', padding: 24 }}>
          <EmptyState
            title="This app isn't on this device"
            description="It may have been deleted, or the link came from another device."
            action={<Button label="Go to your apps" onPress={() => router.replace('/')} />}
          />
        </View>
      ) : load.kind === 'unsupported' ? (
        <View style={{ flex: 1, justifyContent: 'center', padding: 24 }}>
          <EmptyState
            title="Kalam can't open this app"
            description={load.message}
            action={<Button label="Open history" variant="outline" onPress={() => router.push(`/app/${id}/edit`)} />}
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
          />
        </OptionLabelsProvider>
      )}
      {app && isPhone ? <AssistantSheet spec={app.spec} appId={app.id} visible={askOpen} onClose={() => setAskOpen(false)} /> : null}
      {app && isPhone ? (
        <Menu
          visible={moreOpen}
          onClose={() => setMoreOpen(false)}
          title={app.spec.name}
          items={[
            ...(canRemind ? [{ key: 'reminders', label: 'Reminders', icon: Bell, onSelect: () => setRemindersOpen(true) }] : []),
            { key: 'draw', label: 'Edit by drawing', icon: PenLine, onSelect: openDrawing },
            { key: 'edit', label: 'Edit', icon: Pencil, onSelect: openEdit },
          ]}
        />
      ) : null}
      {app && canRemind ? (
        <Sheet visible={remindersOpen} title="Reminders" onClose={() => setRemindersOpen(false)}>
          <RemindersPanel spec={app.spec} appId={app.id} />
        </Sheet>
      ) : null}
    </View>
  );
}
