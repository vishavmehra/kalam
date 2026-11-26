/**
 * /app/[id]/edit — change an app without breaking it (docs/07 §15, DIRECTION §6). The app on the left,
 * the red pen on the right. Every change becomes a *proposed change* shown live in the preview with where
 * it was computed (Template / On device / Cloud); nothing is saved until "Keep change". Theme tweaks,
 * formula changes, version restores and AI-block verification all save as new versions, so any step can be
 * undone from History (the Time Machine).
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, LayoutGrid, PenLine, Sparkles } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { confirmRestore, previewRestore } from '@/core/clone';
import type { AppVersion, RuntimeServices, SpecPatchOp, StoredApp } from '@/core/contracts';
import type { KalamSpec } from '@/core/spec/schema';
import { track } from '@/core/telemetry';
import {
  Button, ConfirmSheet, EmptyState, IconButton, OfflineIcon, SegmentedControl, Slip, SourceBadge, Stamp, Text, TextField, useBreakpoint,
  useKalamTheme, useToast, type ExecutionSource,
} from '@/design';
import { AttributionNote } from '@/features/bazaar/AttributionNote';
import { useStructureGate } from '@/features/collab';
import { StatFormulaPanel } from '@/features/formula-assist';
import { DraftChanges, VersionTimeline } from '@/features/history';
import { RecoveryCard } from '@/features/recovery';
import { RestoreConfirmSheet } from '@/features/templates';
import { filledCollections, UndoRedo, useDraftHistory, VisualStudio } from '@/features/visual-studio';
import { useT } from '@/i18n/react';
import { KalamRuntime } from '@/runtime/KalamRuntime';
import { createMemoryRuntimeServices } from '@/runtime/memory-services';
import { loadRunnableApp, useAccessModes, useOnline, type AppLoad } from '@/runtime/RunAppScreen';
import { getServices } from '@/services';
import { useAppsStore } from '@/state/apps-store';
import { AIBlocksPanel, type BlockCheck } from './AIBlocksPanel';
import { applyVerification, joinSummary, routeSource, verificationSummary } from './edit-model';
import { EditByDrawing, type DrawnEdit } from './overlay';
import { ThemePanel } from './ThemePanel';

interface Draft {
  spec: KalamSpec;
  summary: string;
  sources: ExecutionSource[];
}

/** What a saved version records about itself; `origin` tells an AI edit from a hand edit in the Time Machine. */
type Change = { summary: string; source: AppVersion['source']; origin?: AppVersion['origin'] };

type Tab = 'preview' | 'theme' | 'numbers' | 'history' | 'ai';

const addSource = (list: ExecutionSource[] | undefined, s: ExecutionSource) => (list?.includes(s) ? list : [...(list ?? []), s]);
/** An edit that a model proposed is 'ai'; a template or hand edit is 'user'. */
const originOf = (sources: readonly ExecutionSource[] | undefined): AppVersion['origin'] =>
  sources?.some((s) => s === 'on_device' || s === 'cloud') ? 'ai' : 'user';

export function EditAppScreen({ id }: { id: string }) {
  const router = useRouter();
  const k = useKalamTheme();
  const t = useT(k.uiLanguage);
  const insets = useSafeAreaInsets();
  const { isDesktop, isPhone } = useBreakpoint();
  const toast = useToast();
  const accessModes = useAccessModes();
  const online = useOnline();

  const [load, setLoad] = useState<AppLoad>({ kind: 'loading' });
  const [versions, setVersions] = useState<AppVersion[] | null>(null);
  const [preview, setPreview] = useState<RuntimeServices | null>(null);
  // The pending change keeps a step history, so Undo and Redo (and Ctrl+Z) walk through what was proposed.
  const { draft, setDraft, undo, redo, canUndo, canRedo } = useDraftHistory<Draft>();
  const [instruction, setInstruction] = useState('');
  const [pending, setPending] = useState(false);
  /** `code` is the stable code of the failure when there is one: the recovery card plans from it. */
  const [editError, setEditError] = useState<{ message: string; source?: ExecutionSource; code?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [restoring, setRestoring] = useState<number | null>(null);
  const [checks, setChecks] = useState<Record<string, BlockCheck>>({});
  const [tab, setTab] = useState<Tab>(isDesktop ? 'theme' : 'preview');
  const abort = useRef<AbortController | null>(null);
  /** An older version shown in the preview before restoring it (docs/03 §18.2). */
  const [peek, setPeek] = useState<{ version: number; spec: KalamSpec } | null>(null);
  const [peekLoading, setPeekLoading] = useState(false);
  const [askRestore, setAskRestore] = useState<number | null>(null);
  const [askLeave, setAskLeave] = useState(false);
  /** Preview width on desktop (docs/14 §4.5). */
  const [frame, setFrame] = useState<'phone' | 'tablet' | 'full'>('full');
  /** Edit by drawing (docs/08 §16). `?draw=1` comes from the app's "Draw a change" button. */
  const { draw } = useLocalSearchParams<{ draw?: string }>();
  const [drawing, setDrawing] = useState(draw === '1');
  /** A drawn change is on screen: typed changes wait so the two never build on different versions. */
  const [drawPending, setDrawPending] = useState(false);
  /** The Visual App Studio (docs/14 section 4): arrange the running preview by dragging. */
  const [studio, setStudio] = useState(false);
  /** Collections that hold entries: the studio will not change the type of their fields. */
  const [filled, setFilled] = useState<ReadonlySet<string>>(() => new Set());
  /** Saved entries per list, so the restore question can say how many stay when a list is not in the older design. */
  const [counts, setCounts] = useState<Record<string, number>>({});
  /** Only the owner of a shared app changes its design. */
  const gate = useStructureGate(id);
  const locked = gate.locked;

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
        if (alive) {
          setPreview(createMemoryRuntimeServices(id, { records, state }));
          setFilled(filledCollections(records));
          setCounts(Object.fromEntries(Object.entries(records).map(([k, v]) => [k, v.length])));
        }
      }
    })().catch(() => alive && setLoad({ kind: 'unsupported', message: t('run.unsupported.storage') }));
    return () => {
      alive = false;
      abort.current?.abort();
    };
  }, [db, id]); // eslint-disable-line react-hooks/exhaustive-deps

  const app = load.kind === 'ready' ? load.app : undefined;
  const rawApp: StoredApp | undefined = load.kind === 'ready' || load.kind === 'unsupported' ? load.app : undefined;
  const working = draft?.spec ?? app?.spec;

  const saveApp = useCallback(
    async (base: StoredApp, spec: KalamSpec, change: Change) => {
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
    if (!text || !working || pending || locked) return;
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
          message: out.message ?? out.errors[0]?.message ?? t('edit.error.couldNot'),
          source: online ? routeSource(out.route) : 'offline',
          code: out.errors[0]?.code ?? (online ? undefined : 'offline'),
        });
      }
    } catch {
      if (!ctrl.signal.aborted) setEditError({ message: t('edit.error.unchanged') });
    } finally {
      setPending(false);
    }
  }, [instruction, working, pending, locked, isDesktop, online, t]);

  const applyOps = useCallback(
    (ops: SpecPatchOp[], summary: string) => {
      if (!working || locked) return;
      const out = getServices().edit.applyOps(working, ops, summary);
      if (out.ok && out.spec) {
        const spec = out.spec;
        setDraft((d) => ({ spec, summary: joinSummary(d?.summary, summary), sources: addSource(d?.sources, 'deterministic') }));
      } else {
        toast.show({ message: out.message ?? out.errors[0]?.message ?? t('edit.error.notPossible'), tone: 'danger' });
      }
    },
    [working, locked, toast, t],
  );

  /** A change made in the Visual App Studio: validated there, kept here as a pending change like any other. */
  const arrange = useCallback((spec: KalamSpec, summary: string) => {
    setDraft((d) => ({ spec, summary: joinSummary(d?.summary, summary), sources: addSource(d?.sources, 'deterministic') }));
  }, [setDraft]);

  const savedToast = useCallback((version: number, before: number) => {
    toast.show({
      message: t('edit.savedAs', { version }),
      tone: 'success',
      action: { label: t('common.undo'), onPress: () => void restoreRef.current?.(before) },
    });
  }, [toast, t]);

  const keep = useCallback(async () => {
    if (!draft || !app) return;
    setSaving(true);
    try {
      const before = app.spec.version;
      const saved = await saveApp(app, draft.spec, { summary: draft.summary, source: 'edit', origin: originOf(draft.sources) });
      setDraft(null);
      savedToast(saved.spec.version, before);
    } catch {
      toast.show({ message: t('edit.saveFailed'), tone: 'danger' });
    } finally {
      setSaving(false);
    }
  }, [draft, app, saveApp, savedToast, toast, t]);

  /** Keeps a change made by drawing on the app, as a new version. */
  const keepDrawn = useCallback(
    async (e: DrawnEdit): Promise<boolean> => {
      if (!app) return false;
      track('feature_used', 'visual_edit');
      try {
        const before = app.spec.version;
        const saved = await saveApp(app, e.spec, { summary: joinSummary(draft?.summary, e.summary), source: 'edit', origin: 'ai' });
        setDraft(null);
        savedToast(saved.spec.version, before);
        return true;
      } catch {
        track('feature_failed', 'visual_edit');
        toast.show({ message: t('edit.saveFailed'), tone: 'danger' });
        return false;
      }
    },
    [app, draft, saveApp, savedToast, toast, t],
  );

  const toggleDrawing = useCallback(() => {
    setDrawing((on) => !on);
    setStudio(false);
    setPeek(null);
    if (!isDesktop) setTab('preview');
  }, [isDesktop]);
  const toggleStudio = useCallback(() => {
    setStudio((on) => !on);
    setDrawing(false);
    setPeek(null);
    if (!isDesktop) setTab('preview');
  }, [isDesktop]);

  const discard = useCallback(() => {
    setDraft(null);
    toast.show({ message: t('edit.discarded'), tone: 'neutral' });
  }, [toast, t]);

  // ── History (Time Machine) ─────────────────────────────────────────────────
  const restore = useCallback(
    async (version: number) => {
      if (!rawApp) return;
      setRestoring(version);
      track('feature_used', 'time_machine');
      try {
        const spec = await db.versions.materialize(id, version);
        if (!spec) {
          toast.show({ message: t('edit.history.gone'), tone: 'danger' });
          return;
        }
        const saved = await saveApp(rawApp, spec, { summary: t('edit.history.restoredSummary', { version }), source: 'restore', origin: 'user' });
        toast.show({ message: t('edit.history.restored', { version, next: saved.spec.version }), tone: 'success' });
      } catch {
        track('feature_failed', 'time_machine');
        toast.show({ message: t('edit.history.restoreFailed'), tone: 'danger' });
      } finally {
        setRestoring(null);
      }
    },
    [rawApp, db, id, saveApp, toast, t],
  );

  const restoreRef = useRef(restore);
  restoreRef.current = restore;

  /** Preview before restore: the older design runs in the preview on a copy of the data; nothing changes yet. */
  const previewVersion = useCallback(async (version: number) => {
    setStudio(false);
    setPeekLoading(true);
    try {
      const spec = await db.versions.materialize(id, version);
      if (!spec) {
        toast.show({ message: t('edit.history.gone'), tone: 'danger' });
        return;
      }
      setPeek({ version, spec });
      if (!isDesktop) setTab('preview');
    } catch {
      toast.show({ message: t('edit.history.openFailed'), tone: 'danger' });
    } finally {
      setPeekLoading(false);
    }
  }, [db, id, isDesktop, toast, t]);

  // The restore question: what the older design changes, in plain words, before anything is saved (docs/00 section 24.7).
  const restorePreview = useMemo(
    () => (askRestore === null ? undefined : previewRestore(versions ?? [], askRestore, rawApp?.spec.version ?? 0, { recordCounts: counts, hasDraft: !!draft })),
    [askRestore, versions, rawApp?.spec.version, counts, draft],
  );
  const confirmRestoreNow = useCallback(async () => {
    const v = askRestore;
    const req = restorePreview ? confirmRestore(restorePreview) : undefined;
    setAskRestore(null);
    if (!req || !rawApp || v === null || locked) return;
    const before = rawApp.spec.version;
    setRestoring(v);
    track('feature_used', 'time_machine');
    try {
      const saved = await saveApp(rawApp, req.spec, req.change);
      toast.show({
        message: t('edit.history.restored', { version: v, next: saved.spec.version }),
        tone: 'success',
        action: { label: t('common.undo'), onPress: () => void restoreRef.current?.(before) },
      });
      setPeek(null);
    } catch {
      track('feature_failed', 'time_machine');
      toast.show({ message: t('edit.history.restoreFailed'), tone: 'danger' });
    } finally {
      setRestoring(null);
    }
  }, [askRestore, restorePreview, rawApp, locked, saveApp, toast, t]);

  /** The running app inside the studio, with the drawing layer over it when drawing is on. */
  const renderStudioApp = useCallback(
    (s: KalamSpec) => (
      <EditByDrawing
        spec={s}
        active={drawing && !studio}
        onClose={() => setDrawing(false)}
        onKeep={keepDrawn}
        onPendingChange={setDrawPending}
        renderApp={(s2) => preview ? <KalamRuntime key={id} spec={s2} appId={id} services={preview} mode="preview" accessModes={accessModes} /> : null}
      />
    ),
    [drawing, studio, keepDrawn, id, preview, accessModes],
  );

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
            summary: verificationSummary(blockId, outcome), source: 'edit', origin: 'ai',
          });
        }
        setChecks((c) => ({ ...c, [blockId]: { running: false, outcome } }));
      } catch {
        setChecks((c) => ({ ...c, [blockId]: { running: false, error: t('edit.ai.checkFailed') } }));
      }
    },
    [app, saveApp, t],
  );

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace(`/app/${id}`);
  }, [router, id]);
  // A typed or a drawn change that is not kept yet is never dropped without asking.
  const leave = useCallback(() => {
    if (draft || drawPending) setAskLeave(true);
    else goBack();
  }, [draft, drawPending, goBack]);

  // ── Layout ─────────────────────────────────────────────────────────────────
  const topBar = (
    <View
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: insets.top + 4, paddingBottom: 4, paddingHorizontal: isPhone ? 4 : 12,
        borderBottomWidth: 1, borderBottomColor: k.colors.border, backgroundColor: k.colors.surface,
      }}
    >
      <IconButton icon={ArrowLeft} label={t('edit.back')} onPress={() => void leave()} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="h4" numberOfLines={1}>{rawApp ? t('edit.title', { name: rawApp.spec.name }) : t('edit.titleNone')}</Text>
        {rawApp ? <Text variant="caption" tone="muted" mono>{t('edit.version', { version: rawApp.spec.version })}</Text> : null}
        {rawApp ? <AttributionNote spec={rawApp.spec} /> : null}
      </View>
      {!online ? <Stamp kind="template" icon={OfflineIcon} label={t('network.offline')} size="sm" iconOnly={isPhone} /> : null}
    </View>
  );

  if (load.kind === 'loading') {
    return (
      <View style={{ flex: 1, backgroundColor: k.colors.background }}>
        {topBar}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={k.colors.primary} accessibilityLabel={t('edit.loading')} />
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
            title={t('run.missing.title')}
            description={t('edit.missing')}
            action={<Button label={t('run.missing.cta')} onPress={() => router.replace('/')} />}
          />
        </View>
      </View>
    );
  }

  const timeline = (
    <VersionTimeline
      versions={versions}
      current={rawApp?.spec.version ?? 0}
      lang={rawApp?.spec.lang ?? 'en'}
      restoring={restoring}
      blocked={!!draft || drawPending || locked}
      previewing={peek?.version ?? null}
      previewPending={peekLoading}
      // Previewing an older version would swap out the drawing layer and lose a drawn change; a broken
      // current design cannot be previewed at all, only restored.
      onPreview={drawPending || load.kind === 'unsupported' ? undefined : (v) => void previewVersion(v)}
      onRestore={(v) => setAskRestore(v)}
      // The desktop tools column is the surface; phones and the restore-only view sit on the page canvas.
      behind={isDesktop && load.kind === 'ready' ? k.colors.surface : k.colors.background}
    />
  );

  const panelFor = (p: Tab): ReactNode => {
    switch (p) {
      case 'theme':
        return working ? <ThemePanel theme={working.theme} disabled={saving || locked} onApply={applyOps} /> : null;
      case 'numbers':
        return working ? <StatFormulaPanel spec={working} appId={id} disabled={saving || locked} onApply={applyOps} /> : null;
      case 'history':
        return timeline;
      case 'ai':
        return app ? <AIBlocksPanel spec={app.spec} checks={checks} blocked={!!draft || locked} onVerify={(b) => void verify(b)} /> : null;
      case 'preview':
        return null;
    }
  };

  const dialogs = (
    <>
      <RestoreConfirmSheet visible={askRestore !== null} preview={restorePreview} onCancel={() => setAskRestore(null)} onConfirm={confirmRestoreNow} />
      <ConfirmSheet
        visible={askLeave}
        title={t('edit.leave.title')}
        message={t('edit.leave.message')}
        confirmLabel={t('edit.leave.confirm')}
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
        <ScrollView contentContainerStyle={{ padding: isDesktop ? 32 : 16, gap: 16, maxWidth: 720, width: '100%' }}>
          <Slip tint="haldi">
            <View accessibilityRole="alert" style={{ gap: 4 }}>
              <Stamp kind="needs" label={t('stamp.needs')} size="sm" />
              <Text weight="semibold">{t('edit.unsupported')}</Text>
              <Text variant="bodySmall" tone="secondary">{load.message}</Text>
            </View>
          </Slip>
          {timeline}
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
      // Off: the app renders untouched. On: the studio or a drawing layer sits over the running preview.
      <VisualStudio
        spec={shown}
        active={studio}
        onClose={() => setStudio(false)}
        onChange={arrange}
        onUndo={undo}
        hasEntries={(c) => filled.has(c)}
        renderApp={renderStudioApp}
      />
    )
  ) : (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color={k.colors.primary} accessibilityLabel={t('edit.preparing')} />
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
            backgroundColor: k.tints.haldi, borderBottomWidth: 1, borderBottomColor: k.colors.border,
          }}
        >
          <Text weight="semibold" style={{ flex: 1, minWidth: 180 }}>{t('edit.history.previewing', { version: peek.version })}</Text>
          <Button label={t('edit.history.restoreThis')} size="sm" onPress={() => setAskRestore(peek.version)} disabled={!!draft} />
          <Button label={t('edit.history.backToCurrent')} size="sm" variant="ghost" onPress={() => setPeek(null)} />
        </View>
      ) : null}
      {isDesktop ? (
        <View style={{ flexDirection: 'row', justifyContent: 'center', paddingTop: 12 }}>
          <SegmentedControl<'phone' | 'tablet' | 'full'>
            label={t('edit.frame.label')}
            labelHidden
            value={frame}
            onChange={setFrame}
            options={[{ value: 'phone', label: t('edit.frame.phone') }, { value: 'tablet', label: t('edit.frame.tablet') }, { value: 'full', label: t('edit.frame.full') }]}
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

  const keepBtn = <Button key="keep" label={t('edit.keep')} loading={saving} onPress={() => void keep()} />;
  const discardBtn = <Button key="discard" label={t('common.discard')} variant="ghost" disabled={saving} onPress={discard} />;

  const workbench = (
    <>
      {locked ? (
        <Slip tint="haldi" behind={isDesktop ? k.colors.surface : k.colors.background}>
          <View accessibilityLiveRegion="polite" style={{ gap: 6 }}>
            <Stamp kind="needs" label={t('stamp.needs')} size="sm" />
            <Text>{gate.message}</Text>
          </View>
        </Slip>
      ) : null}
      <View style={{ gap: 10 }}>
        <TextField
          label={t('edit.describe')}
          value={instruction}
          onChangeText={setInstruction}
          placeholder={t('edit.placeholder')}
          multiline
          editable={!pending && !locked}
          onSubmitEditing={() => void describe()}
          helper={online ? undefined : t('edit.offlineHelper')}
        />
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Button label={t('edit.previewChange')} icon={Sparkles} loading={pending} disabled={!instruction.trim() || drawPending || studio || locked} onPress={() => void describe()} />
          {pending ? <Button label={t('common.cancel')} variant="ghost" onPress={() => abort.current?.abort()} /> : null}
          <Button
            label={drawing ? t('edit.stopDrawing') : t('run.draw')}
            icon={PenLine}
            variant={drawing ? 'secondary' : 'outline'}
            disabled={!app || locked}
            onPress={toggleDrawing}
          />
          <Button
            label={studio ? t('visualStudio.stop') : t('visualStudio.start')}
            icon={LayoutGrid}
            variant={studio ? 'secondary' : 'outline'}
            disabled={!app || drawPending || locked}
            onPress={toggleStudio}
          />
          <UndoRedo canUndo={canUndo} canRedo={canRedo} onUndo={undo} onRedo={redo} disabled={saving || pending} />
        </View>
        {editError ? (
          <View accessibilityLiveRegion="polite" style={{ gap: 6 }}>
            {editError.source ? <SourceBadge source={editError.source} /> : null}
            <Text variant="bodySmall" tone="danger">{editError.message}</Text>
            {editError.code ? (
              <RecoveryCard error={editError.code} origin="ai" handlers={{ retry: () => void describe(), retry_when_online: () => void describe() }} onDismiss={() => setEditError(null)} />
            ) : null}
          </View>
        ) : null}
      </View>

      {draft && app ? (
        <Slip tint="carbon" behind={isDesktop ? k.colors.surface : k.colors.background}>
          <View accessibilityLiveRegion="polite" style={{ gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Text variant="h4">{t('edit.proposed')}</Text>
              {draft.sources.map((s) => <SourceBadge key={s} source={s} size="sm" />)}
            </View>
            <Text tone="secondary">{draft.summary}</Text>
            <DraftChanges before={app.spec} after={draft.spec} />
            <Text variant="caption" tone="muted">{t('edit.proposedHint')}</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8, justifyContent: accessModes.leftHanded ? 'flex-start' : 'flex-end' }}>
            {accessModes.leftHanded ? [keepBtn, discardBtn] : [discardBtn, keepBtn]}
          </View>
        </Slip>
      ) : null}
    </>
  );

  const tabs = (
    <SegmentedControl<Tab>
      label={t('edit.tools')}
      labelHidden
      wrap
      value={!isDesktop || tab !== 'preview' ? tab : 'theme'}
      onChange={setTab}
      options={[
        ...(isDesktop ? [] : [{ value: 'preview' as const, label: t('edit.tab.preview') }]),
        { value: 'theme', label: t('edit.tab.cover') },
        { value: 'numbers', label: t('edit.tab.numbers') },
        { value: 'history', label: t('edit.tab.history') },
        { value: 'ai', label: t('edit.tab.ai') },
      ]}
    />
  );

  if (isDesktop) {
    return (
      <View style={{ flex: 1, backgroundColor: k.colors.background }}>
        {topBar}
        <View style={{ flex: 1, flexDirection: 'row' }}>
          <View style={{ flex: 1 }}>{runtime}</View>
          <ScrollView
            style={{ width: 460, flexGrow: 0, borderLeftWidth: 1, borderLeftColor: k.colors.border, backgroundColor: k.colors.surface }}
            contentContainerStyle={{ padding: 24, gap: 24 }}
            accessibilityLabel={t('edit.tools')}
          >
            {workbench}
            {tabs}
            {panelFor(tab === 'preview' ? 'theme' : tab)}
          </ScrollView>
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
          <View style={{ height: 620, borderRadius: k.radius.paper, borderWidth: 1, borderColor: k.colors.border, overflow: 'hidden' }}>
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
