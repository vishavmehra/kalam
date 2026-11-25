/**
 * /app/[id]/edit — change an app without breaking it (docs/07 §15). Every change becomes a
 * *proposed change* shown live in the preview with where it was computed (Deterministic /
 * On-device / Cloud); nothing is saved until "Keep change". Theme tweaks, version restores and
 * AI-block verification all save as new versions, so any step can be undone from History.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, PenLine, Sparkles } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { AppVersion, RuntimeServices, SpecPatchOp, StoredApp } from '@/core/contracts';
import type { KalamSpec } from '@/core/spec/schema';
import {
  Button, ConfirmSheet, EmptyState, IconButton, SegmentedControl, SourceBadge, Surface, Text, TextField, useBreakpoint, useKalamTheme,
  useToast, type ExecutionSource,
} from '@/design';
import { AttributionNote } from '@/features/bazaar/AttributionNote';
import { KalamRuntime } from '@/runtime/KalamRuntime';
import { createMemoryRuntimeServices } from '@/runtime/memory-services';
import { loadRunnableApp, useAccessModes, useOnline, type AppLoad } from '@/runtime/RunAppScreen';
import { getServices } from '@/services';
import { useAppsStore } from '@/state/apps-store';
import { AIBlocksPanel, type BlockCheck } from './AIBlocksPanel';
import { applyVerification, joinSummary, routeSource, verificationSummary } from './edit-model';
import { HistoryPanel } from './HistoryPanel';
import { EditByDrawing, type DrawnEdit } from './overlay';
import { ThemePanel } from './ThemePanel';

interface Draft {
  spec: KalamSpec;
  summary: string;
  sources: ExecutionSource[];
}

type Tab = 'preview' | 'theme' | 'history' | 'ai';

const addSource = (list: ExecutionSource[] | undefined, s: ExecutionSource) => (list?.includes(s) ? list : [...(list ?? []), s]);

export function EditAppScreen({ id }: { id: string }) {
  const router = useRouter();
  const k = useKalamTheme();
  const insets = useSafeAreaInsets();
  const { isDesktop } = useBreakpoint();
  const toast = useToast();
  const accessModes = useAccessModes();
  const online = useOnline();

  const [load, setLoad] = useState<AppLoad>({ kind: 'loading' });
  const [versions, setVersions] = useState<AppVersion[] | null>(null);
  const [preview, setPreview] = useState<RuntimeServices | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [instruction, setInstruction] = useState('');
  const [pending, setPending] = useState(false);
  const [editError, setEditError] = useState<{ message: string; source?: ExecutionSource } | null>(null);
  const [saving, setSaving] = useState(false);
  const [restoring, setRestoring] = useState<number | null>(null);
  const [checks, setChecks] = useState<Record<string, BlockCheck>>({});
  const [tab, setTab] = useState<Tab>(isDesktop ? 'theme' : 'preview');
  const abort = useRef<AbortController | null>(null);
  /** An older version shown in the preview before restoring it (docs/03 §18.2). */
  const [peek, setPeek] = useState<{ version: number; spec: KalamSpec } | null>(null);
  const [askRestore, setAskRestore] = useState<number | null>(null);
  const [askLeave, setAskLeave] = useState(false);
  /** Preview width on desktop (docs/14 §4.5). */
  const [frame, setFrame] = useState<'phone' | 'tablet' | 'full'>('full');
  /** Edit by drawing (docs/08 §16). `?draw=1` comes from the app's "Edit by drawing" button. */
  const { draw } = useLocalSearchParams<{ draw?: string }>();
  const [drawing, setDrawing] = useState(draw === '1');
  /** A drawn change is on screen: typed changes wait so the two never build on different versions. */
  const [drawPending, setDrawPending] = useState(false);

  const db = getServices().db;
  const reloadVersions = useCallback(async () => setVersions(await db.versions.list(id)), [db, id]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const l = await loadRunnableApp(id);
      if (!alive) return;
      setLoad(l);
      if (l.kind === 'missing') return;
      setVersions(await db.versions.list(id));
      if (l.kind === 'ready') {
        // The preview runs on a copy of the real data, so trying the app never changes it.
        const [records, state] = await Promise.all([db.records.listAll(id), db.state.all(id)]);
        if (alive) setPreview(createMemoryRuntimeServices(id, { records, state }));
      }
    })().catch(() => alive && setLoad({ kind: 'unsupported', message: "This app couldn't be read from this device's storage." }));
    return () => {
      alive = false;
      abort.current?.abort();
    };
  }, [db, id]);

  const app = load.kind === 'ready' ? load.app : undefined;
  const rawApp: StoredApp | undefined = load.kind === 'ready' || load.kind === 'unsupported' ? load.app : undefined;
  const working = draft?.spec ?? app?.spec;

  const saveApp = useCallback(
    async (base: StoredApp, spec: KalamSpec, change: { summary: string; source: AppVersion['source'] }) => {
      const saved = await useAppsStore.getState().save({ ...base, spec, updatedAt: Date.now() }, change);
      const checked = await loadRunnableApp(id);
      setLoad(checked.kind === 'ready' ? checked : { kind: 'ready', app: saved });
      await reloadVersions();
      return saved;
    },
    [id, reloadVersions],
  );

  // ── Describe a change ──────────────────────────────────────────────────────
  const describe = useCallback(async () => {
    const text = instruction.trim();
    if (!text || !working || pending) return;
    setPending(true);
    setEditError(null);
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      const out = await getServices().edit.applyInstruction(working, text, { signal: ctrl.signal });
      if (ctrl.signal.aborted) return;
      if (out.ok && out.spec) {
        const spec = out.spec;
        setDraft((d) => ({ spec, summary: joinSummary(d?.summary, out.summary), sources: addSource(d?.sources, routeSource(out.route)) }));
        setInstruction('');
        if (!isDesktop) setTab('preview');
      } else {
        setEditError({
          message: out.message ?? out.errors[0]?.message ?? "Kalam couldn't make that change. Try describing it differently.",
          source: online ? routeSource(out.route) : 'offline',
        });
      }
    } catch {
      if (!ctrl.signal.aborted) setEditError({ message: "Kalam couldn't make that change. Your app is unchanged." });
    } finally {
      setPending(false);
    }
  }, [instruction, working, pending, isDesktop, online]);

  const applyOps = useCallback(
    (ops: SpecPatchOp[], summary: string) => {
      if (!working) return;
      const out = getServices().edit.applyOps(working, ops, summary);
      if (out.ok && out.spec) {
        const spec = out.spec;
        setDraft((d) => ({ spec, summary: joinSummary(d?.summary, summary), sources: addSource(d?.sources, 'deterministic') }));
      } else {
        toast.show({ message: out.message ?? out.errors[0]?.message ?? "That change isn't possible.", tone: 'danger' });
      }
    },
    [working, toast],
  );

  const keep = useCallback(async () => {
    if (!draft || !app) return;
    setSaving(true);
    try {
      const before = app.spec.version;
      const saved = await saveApp(app, draft.spec, { summary: draft.summary, source: 'edit' });
      setDraft(null);
      toast.show({
        message: `Saved as version ${saved.spec.version}`,
        tone: 'success',
        action: { label: 'Undo', onPress: () => void restoreRef.current?.(before) },
      });
    } catch {
      toast.show({ message: "Couldn't save the change. Your app is unchanged.", tone: 'danger' });
    } finally {
      setSaving(false);
    }
  }, [draft, app, saveApp, toast]);

  /** Keeps a change made by drawing on the app, as a new version. */
  const keepDrawn = useCallback(
    async (e: DrawnEdit): Promise<boolean> => {
      if (!app) return false;
      try {
        const before = app.spec.version;
        const saved = await saveApp(app, e.spec, { summary: joinSummary(draft?.summary, e.summary), source: 'edit' });
        setDraft(null);
        toast.show({
          message: `Saved as version ${saved.spec.version}`,
          tone: 'success',
          action: { label: 'Undo', onPress: () => void restoreRef.current?.(before) },
        });
        return true;
      } catch {
        toast.show({ message: "Couldn't save the change. Your app is unchanged.", tone: 'danger' });
        return false;
      }
    },
    [app, draft, saveApp, toast],
  );

  const toggleDrawing = useCallback(() => {
    setDrawing((on) => !on);
    setPeek(null);
    if (!isDesktop) setTab('preview');
  }, [isDesktop]);

  const discard = useCallback(() => {
    setDraft(null);
    toast.show({ message: 'Change discarded', tone: 'neutral' });
  }, [toast]);

  // ── History ────────────────────────────────────────────────────────────────
  const restore = useCallback(
    async (version: number) => {
      if (!rawApp) return;
      setRestoring(version);
      try {
        const spec = await db.versions.materialize(id, version);
        if (!spec) {
          toast.show({ message: 'That version is no longer stored on this device.', tone: 'danger' });
          return;
        }
        const saved = await saveApp(rawApp, spec, { summary: `Restored version ${version}`, source: 'restore' });
        toast.show({ message: `Restored version ${version} as version ${saved.spec.version}`, tone: 'success' });
      } catch {
        toast.show({ message: "Couldn't restore that version. Nothing was changed.", tone: 'danger' });
      } finally {
        setRestoring(null);
      }
    },
    [rawApp, db, id, saveApp, toast],
  );

  const restoreRef = useRef(restore);
  restoreRef.current = restore;

  const previewVersion = useCallback(async (version: number) => {
    try {
      const spec = await db.versions.materialize(id, version);
      if (!spec) {
        toast.show({ message: 'That version is no longer stored on this device.', tone: 'danger' });
        return;
      }
      setPeek({ version, spec });
      if (!isDesktop) setTab('preview');
    } catch {
      toast.show({ message: "That version couldn't be opened.", tone: 'danger' });
    }
  }, [db, id, isDesktop, toast]);

  // ── AI block verification ──────────────────────────────────────────────────
  const verify = useCallback(
    async (blockId: string) => {
      if (!app) return;
      setChecks((c) => ({ ...c, [blockId]: { running: true } }));
      const ctrl = new AbortController();
      abort.current = ctrl;
      try {
        const outcome = await getServices().aiBlocks.verify(app.spec, blockId, { signal: ctrl.signal });
        // A check that ran no cases taught us nothing — don't create a version for it.
        if (outcome.testCount > 0) {
          await saveApp(app, applyVerification(app.spec, blockId, outcome, Date.now()), {
            summary: verificationSummary(blockId, outcome), source: 'edit',
          });
        }
        setChecks((c) => ({ ...c, [blockId]: { running: false, outcome } }));
      } catch {
        setChecks((c) => ({ ...c, [blockId]: { running: false, error: "The check couldn't run. Nothing was changed." } }));
      }
    },
    [app, saveApp],
  );

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace(`/app/${id}`);
  }, [router, id]);
  const leave = useCallback(() => {
    if (draft) setAskLeave(true);
    else goBack();
  }, [draft, goBack]);

  // ── Layout ─────────────────────────────────────────────────────────────────
  const topBar = (
    <View
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: insets.top + 4, paddingBottom: 4, paddingHorizontal: 8,
        borderBottomWidth: 1, borderBottomColor: k.colors.border, backgroundColor: k.colors.surface,
      }}
    >
      <IconButton icon={ArrowLeft} label="Back to the app" onPress={() => void leave()} />
      <View style={{ flex: 1 }}>
        <Text variant="h4" numberOfLines={1}>{rawApp ? `Edit ${rawApp.spec.name}` : 'Edit app'}</Text>
        {rawApp ? <Text variant="caption" tone="muted" numeric>Version {rawApp.spec.version}</Text> : null}
        {rawApp ? <AttributionNote spec={rawApp.spec} /> : null}
      </View>
      {!online ? <SourceBadge source="offline" /> : null}
    </View>
  );

  if (load.kind === 'loading') {
    return (
      <View style={{ flex: 1, backgroundColor: k.colors.background }}>
        {topBar}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={k.colors.primary} accessibilityLabel="Loading app" />
        </View>
      </View>
    );
  }
  if (load.kind === 'missing') {
    return (
      <View style={{ flex: 1, backgroundColor: k.colors.background }}>
        {topBar}
        <View style={{ flex: 1, justifyContent: 'center', padding: 24 }}>
          <EmptyState
            title="This app isn't on this device"
            description="It may have been deleted."
            action={<Button label="Go to your apps" onPress={() => router.replace('/')} />}
          />
        </View>
      </View>
    );
  }

  const panelFor = (t: Tab): ReactNode => {
    switch (t) {
      case 'theme':
        return working ? <ThemePanel theme={working.theme} disabled={saving} onApply={applyOps} /> : null;
      case 'history':
        return (
          <HistoryPanel
            versions={versions}
            current={rawApp?.spec.version ?? 0}
            lang={rawApp?.spec.lang ?? 'en'}
            restoring={restoring}
            blocked={!!draft}
            previewing={peek?.version ?? null}
            onPreview={(v) => void previewVersion(v)}
            onRestore={(v) => setAskRestore(v)}
          />
        );
      case 'ai':
        return app ? <AIBlocksPanel spec={app.spec} checks={checks} blocked={!!draft} onVerify={(b) => void verify(b)} /> : null;
      case 'preview':
        return null;
    }
  };

  const dialogs = (
    <>
      <ConfirmSheet
        visible={askRestore !== null}
        title={askRestore !== null ? `Restore version ${askRestore}?` : 'Restore version?'}
        message="It becomes the current design as a new version. The design you have now stays in History, and your records are kept."
        confirmLabel="Restore version"
        onCancel={() => setAskRestore(null)}
        onConfirm={async () => {
          const v = askRestore;
          setAskRestore(null);
          if (v === null) return;
          await restore(v);
          setPeek(null);
        }}
      />
      <ConfirmSheet
        visible={askLeave}
        title="Discard the proposed change?"
        message="The change you are previewing is not saved yet. Your app stays as it is."
        confirmLabel="Discard change"
        destructive
        onCancel={() => setAskLeave(false)}
        onConfirm={() => { setAskLeave(false); setDraft(null); goBack(); }}
      />
    </>
  );

  // A design that fails validation can't be previewed or edited — only restored.
  if (load.kind === 'unsupported') {
    return (
      <View style={{ flex: 1, backgroundColor: k.colors.background }}>
        {topBar}
        <ScrollView contentContainerStyle={{ padding: isDesktop ? 32 : 16, gap: 16, maxWidth: 720, width: '100%', alignSelf: 'center' }}>
          <Surface tone="accentSoft" padded style={{ gap: 4 }}>
            <Text weight="semibold">This version can't be opened</Text>
            <Text variant="bodySmall" tone="secondary">{load.message}</Text>
          </Surface>
          {panelFor('history')}
        </ScrollView>
        {dialogs}
      </View>
    );
  }

  const shown = peek?.spec ?? working;
  const runtimeView = shown && preview ? (
    peek ? (
      <KalamRuntime key={`${id}-v${peek.version}`} spec={peek.spec} appId={id} services={preview} mode="preview" accessModes={accessModes} />
    ) : (
      // Off: the app renders untouched. On: a drawing layer sits over the running preview.
      <EditByDrawing
        spec={shown}
        active={drawing}
        onClose={() => setDrawing(false)}
        onKeep={keepDrawn}
        onPendingChange={setDrawPending}
        renderApp={(s) => <KalamRuntime key={id} spec={s} appId={id} services={preview} mode="preview" accessModes={accessModes} />}
      />
    )
  ) : (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color={k.colors.primary} accessibilityLabel="Preparing preview" />
    </View>
  );
  const FRAME_W = { phone: 390, tablet: 768, full: undefined } as const;
  const runtime = (
    <View style={{ flex: 1 }}>
      {peek ? (
        <View
          accessibilityLiveRegion="polite"
          style={{
            flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingVertical: 10,
            backgroundColor: k.colors.accentSoft, borderBottomWidth: 1, borderBottomColor: k.colors.border,
          }}
        >
          <Text weight="semibold" style={{ flex: 1, minWidth: 180 }}>Previewing version {peek.version}. Your current design is unchanged.</Text>
          <Button label="Restore this version" size="sm" onPress={() => setAskRestore(peek.version)} disabled={!!draft} />
          <Button label="Back to current" size="sm" variant="ghost" onPress={() => setPeek(null)} />
        </View>
      ) : null}
      {isDesktop ? (
        <View style={{ flexDirection: 'row', justifyContent: 'center', paddingTop: 12 }}>
          <SegmentedControl<'phone' | 'tablet' | 'full'>
            label="Preview size"
            labelHidden
            value={frame}
            onChange={setFrame}
            options={[{ value: 'phone', label: 'Phone' }, { value: 'tablet', label: 'Tablet' }, { value: 'full', label: 'Full width' }]}
          />
        </View>
      ) : null}
      <View
        style={{
          flex: 1, width: '100%', maxWidth: isDesktop ? FRAME_W[frame] : undefined, alignSelf: 'center',
          ...(isDesktop && frame !== 'full' ? { marginVertical: 12, borderWidth: 1, borderColor: k.colors.border, borderRadius: k.radius.xl, overflow: 'hidden' } : {}),
        }}
      >
        {runtimeView}
      </View>
    </View>
  );

  const keepBtn = <Button key="keep" label="Keep change" loading={saving} onPress={() => void keep()} />;
  const discardBtn = <Button key="discard" label="Discard" variant="ghost" disabled={saving} onPress={discard} />;

  const workbench = (
    <>
      <View style={{ gap: 10 }}>
        <TextField
          label="Describe a change"
          value={instruction}
          onChangeText={setInstruction}
          placeholder="Add a phone number field, or make the buttons blue"
          multiline
          editable={!pending}
          onSubmitEditing={() => void describe()}
          helper={online ? undefined : "You're offline. Small changes still work; bigger ones need the internet."}
        />
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Button label="Preview change" icon={Sparkles} loading={pending} disabled={!instruction.trim() || drawPending} onPress={() => void describe()} />
          {pending ? <Button label="Cancel" variant="ghost" onPress={() => abort.current?.abort()} /> : null}
          <Button
            label={drawing ? 'Stop drawing' : 'Edit by drawing'}
            icon={PenLine}
            variant={drawing ? 'secondary' : 'outline'}
            disabled={!app}
            onPress={toggleDrawing}
          />
        </View>
        {editError ? (
          <View accessibilityLiveRegion="polite" style={{ gap: 6 }}>
            {editError.source ? <SourceBadge source={editError.source} /> : null}
            <Text variant="bodySmall" tone="danger">{editError.message}</Text>
          </View>
        ) : null}
      </View>

      {draft ? (
        <Surface tone="primarySoft" padded style={{ gap: 10 }} accessibilityLiveRegion="polite">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Text variant="h4">Proposed change</Text>
            {draft.sources.map((s) => <SourceBadge key={s} source={s} />)}
          </View>
          <Text tone="secondary">{draft.summary}</Text>
          <Text variant="caption" tone="muted">The preview shows it. Nothing is saved until you keep it.</Text>
          <View style={{ flexDirection: 'row', gap: 8, justifyContent: accessModes.leftHanded ? 'flex-start' : 'flex-end' }}>
            {accessModes.leftHanded ? [keepBtn, discardBtn] : [discardBtn, keepBtn]}
          </View>
        </Surface>
      ) : null}
    </>
  );

  const tabs = (
    <SegmentedControl<Tab>
      label="Edit tools"
      labelHidden
      value={!isDesktop || tab !== 'preview' ? tab : 'theme'}
      onChange={setTab}
      options={[
        ...(isDesktop ? [] : [{ value: 'preview' as const, label: 'Preview' }]),
        { value: 'theme', label: 'Theme' },
        { value: 'history', label: 'History' },
        { value: 'ai', label: 'AI' },
      ]}
    />
  );

  if (isDesktop) {
    return (
      <View style={{ flex: 1, backgroundColor: k.colors.background }}>
        {topBar}
        <View style={{ flex: 1, flexDirection: 'row' }}>
          <ScrollView
            style={{ width: 460, flexGrow: 0, borderRightWidth: 1, borderRightColor: k.colors.border, backgroundColor: k.colors.surface }}
            contentContainerStyle={{ padding: 24, gap: 24 }}
          >
            {workbench}
            {tabs}
            {panelFor(tab === 'preview' ? 'theme' : tab)}
          </ScrollView>
          <View style={{ flex: 1 }}>{runtime}</View>
        </View>
        {dialogs}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: k.colors.background }}>
      {topBar}
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: insets.bottom + 32 }} keyboardShouldPersistTaps="handled">
        {workbench}
        {tabs}
        {tab === 'preview' ? (
          <View style={{ height: 620, borderRadius: k.radius.lg, borderWidth: 1, borderColor: k.colors.border, overflow: 'hidden' }}>
            {runtime}
          </View>
        ) : (
          panelFor(tab)
        )}
      </ScrollView>
      {dialogs}
    </View>
  );
}
