/**
 * <KalamRuntime> — renders a validated KalamSpec as a working app (docs/09 §5–7).
 * All behaviour lives in the pure engine (./engine); this file wires it to React Native,
 * the app's own theme, Access Modes, data subscriptions and UI effects. Works fully offline:
 * the only network-capable path is an AI block, which goes through services.runAIBlock.
 */
import { ChevronLeft, Repeat, Square } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator, Animated, BackHandler, Platform, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent,
} from 'react-native';
import type { AccessModes, AIImage, RecordValue, RuntimeServices } from '@/core/contracts';
import type { ComponentOf, KalamComponent, KalamSpec, SuggestedMode } from '@/core/spec/schema';
import { Stamp } from '@/design';
import { useKalamTheme } from '@/design/theme';
import { lifecycle } from '@/infrastructure/platform/lifecycle';
import { getNotificationAdapter } from '@/infrastructure/platform/notifications';
import { useRuntimeFont } from '@/i18n/use-script-fonts';
import { QueueAiOffer } from '@/features/queue/QueueAiOffer';
import { getOperationQueue } from '@/features/queue/queue-service';
import { readAiStepResult } from '@/features/queue/snapshot';
import { useQueuedAiResults } from '@/features/queue/use-queue';
import { syncReminders } from '@/features/reminders/runtime';
import { applyStartScreen } from '@/features/widgets/start-screen';
import { useSettingsStore } from '@/state/settings-store';
import {
  acceptProposal, collectionValues, createDraftKeeper, createRuntimeContext, createRuntimeState, currentScreen,
  deleteListRecord, dispatchAction, foldedCount, getForm, goBack, lenientForm, openRecord, proposalFromQueued, readAloudText,
  resolveAppTheme, runAIBlockFlow, runtimeAnnouncesTitle, screenFieldDefs, selectedId, setFieldValue, speaksResults,
  stepCounter, toggleRecordField, visibleChildren,
  type ActionResult, type AIProposal, type DataSnapshot, type EngineEnv, type RuntimeContextValue, type RuntimeEffect, type RuntimeState,
} from './engine';
import {
  arrangeScreen, offeredAccessModes, setReminderEnabled, SUGGESTED_MODES_KEY, type ReminderDevice, type ReminderStatus,
} from './engine/v11';
import { type RenderEnv, renderComponent } from './registry';
import { RuntimeContextProvider } from './RuntimeContext';
import { EASE_OUT, font, NATIVE_DRIVER, Pressy, useReducedMotion, type AppTheme } from './ui/kit';
import { AIReviewSheet, ConfirmSheet, type ConfirmRequest, Toast, type ToastMessage } from './ui/overlays';
import type { AIRunStatus } from './ui/PhotoBlock';
import { RuntimeErrorBoundary } from './ui/RuntimeErrorBoundary';
import { ShowMoreToggle } from './ui/ShowMore';
import { LayoutView, SuggestedModesNotice } from './ui/v11';
import { AppLanguageProvider, useAppT } from './use-app-t';
import { stopSpeakingAloud, VoiceControl } from './voice';

export interface KalamRuntimeProps {
  spec: KalamSpec;
  appId: string;
  services: RuntimeServices;
  /** `preview` marks the app as a sandbox (edit screen); data then lives in memory services. */
  mode?: 'live' | 'preview';
  accessModes: AccessModes;
  /** Called when the person goes back from the first screen. */
  onExit?: () => void;
  /**
   * A screen a widget or a link asked for (kalam://app/<id>?screen=<screen>). Applied at start and again whenever it
   * changes while the app is open; an unknown screen leaves the app where it is.
   */
  startScreen?: string;
  /** Called once the start screen has been applied, so the route can clear it. */
  onStartScreenUsed?: () => void;
  /** Where saved confirmations go. Absent: a toast inside the app. Present: the caller shows them (the run bar) and the app stays quiet. */
  onToast?: (message: string, tone: ToastMessage['tone']) => void;
}

type Op = (env: EngineEnv, st: RuntimeState) => Promise<ActionResult> | ActionResult;

/**
 * A generated app, wrapped in an error boundary: a render failure shows a recovery card instead
 * of breaking the Kalam screen around it. "Try again" remounts the app from scratch.
 */
export function KalamRuntime(props: KalamRuntimeProps) {
  const [attempt, setAttempt] = useState(0);
  return (
    <RuntimeErrorBoundary appName={props.spec.name} onRetry={() => setAttempt((a) => a + 1)} onExit={props.onExit}>
      <RuntimeApp key={attempt} {...props} />
    </RuntimeErrorBoundary>
  );
}

function RuntimeApp({ spec, appId, services, mode = 'live', accessModes, onExit, startScreen, onStartScreenUsed, onToast }: KalamRuntimeProps) {
  // The app's font follows its own language (spec.lang), not Kalam's (docs/10 §12.1).
  const scriptFont = useRuntimeFont(spec.lang);
  const t = useMemo<AppTheme>(() => ({ ...resolveAppTheme(spec.theme, accessModes), scriptFont }), [spec.theme, accessModes, scriptFont]);
  const reduced = useReducedMotion();
  // The desk around a framed app belongs to Kalam (light or dark shell); the app keeps its own theme.
  const kalam = useKalamTheme();
  const desk = kalam.colors.background;
  // The app's own words (runtime.* in the catalogues) in its own language, whatever language Kalam is shown in.
  const tr = useAppT(spec.lang);
  const specRef = useRef(spec);
  specRef.current = spec;
  const ctxRef = useRef<RuntimeContextValue | undefined>(undefined);

  // ── Runtime state (navigation, forms, selection) ──────────────────────────
  // A widget or link may ask for a screen: applied to the first state, and again if it changes while open.
  const [rt, setRt] = useState<RuntimeState>(() => applyStartScreen(spec, createRuntimeState(spec), startScreen));
  const rtRef = useRef(rt);
  const commit = useCallback((next: RuntimeState) => {
    rtRef.current = next;
    setRt(next);
  }, []);
  const appliedStart = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!startScreen) {
      appliedStart.current = undefined;
      return;
    }
    if (startScreen !== appliedStart.current) {
      appliedStart.current = startScreen;
      commit(applyStartScreen(specRef.current, rtRef.current, startScreen));
    }
    onStartScreenUsed?.();
  }, [startScreen, commit, onStartScreenUsed]);

  // ── Local data (records + counters), kept fresh by repository subscriptions ─
  const [data, setData] = useState<DataSnapshot | null>(null);
  const dataRef = useRef<DataSnapshot>({ records: {}, state: {} });
  const [loadFailed, setLoadFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    const publish = (patch: Partial<DataSnapshot>) => {
      if (!alive) return;
      dataRef.current = { ...dataRef.current, ...patch };
      ctxRef.current?.patchData(patch);
      setData(dataRef.current);
    };
    const loadRecords = async () => publish({ records: await services.records.listAll(appId) });
    const loadState = async () => publish({ state: await services.state.all(appId) });
    Promise.all([services.records.listAll(appId), services.state.all(appId)])
      .then(([records, state]) => publish({ records, state }))
      .catch(() => alive && setLoadFailed(true));
    const offRecords = services.records.subscribe(appId, () => void loadRecords().catch(() => undefined));
    const offState = services.state.subscribe(appId, () => void loadState().catch(() => undefined));
    return () => {
      alive = false;
      offRecords();
      offState();
    };
  }, [services, appId]);

  // ── Feedback: toast + Read-aloud ───────────────────────────────────────────
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  const lastSpoken = useRef<string | undefined>(undefined);
  // Read-aloud and Voice-only both speak results (docs/10 §4.4-4.5).
  const announce = useCallback(
    (text: string | undefined) => {
      if (!text || !speaksResults(accessModes)) return;
      lastSpoken.current = text;
      services.speak(text, specRef.current.lang);
    },
    [accessModes, services],
  );
  // Read-aloud controls (docs/10 §4.4, docs/03 §19.5): say it again, or stop now.
  const repeatSpeech = useCallback(() => {
    if (lastSpoken.current) services.speak(lastSpoken.current, specRef.current.lang);
  }, [services]);
  const stopSpeech = useCallback(() => stopSpeakingAloud(), []);
  const showToast = useCallback(
    (message: string, tone: ToastMessage['tone']) => {
      announce(message);
      // The caller shows saved confirmations itself (the run bar); the app then stays quiet but still speaks.
      if (onToast) {
        onToast(message, tone);
        return;
      }
      clearTimeout(toastTimer.current);
      setToast({ id: Date.now(), message, tone });
      toastTimer.current = setTimeout(() => setToast(null), tone === 'warning' || tone === 'error' ? 4200 : 2400);
    },
    [announce, onToast],
  );

  // ── AI state ───────────────────────────────────────────────────────────────
  const [proposal, setProposal] = useState<AIProposal | null>(null);
  const [aiStatus, setAiStatus] = useState<Record<string, AIRunStatus>>({});
  const [photos, setPhotos] = useState<Record<string, AIImage>>({});
  /** An AI step that reported "offline": offer to queue it until the device is online (docs/09 §12.5). */
  const [offlineStep, setOfflineStep] = useState<string | null>(null);
  /** The queued operation whose finished result is on screen as a proposal. */
  const [queuedOp, setQueuedOp] = useState<string | null>(null);
  const [reminderStatus, setReminderStatus] = useState<Record<string, ReminderStatus>>({});
  // Simple mode folds secondary components away; "Show more" opens them for one screen until Simple mode changes (docs/10 §4.3).
  const [moreOn, setMoreOn] = useState<Record<string, boolean>>({});
  useEffect(() => setMoreOn({}), [accessModes.simple]);

  const handleEffects = useCallback(
    (effects: RuntimeEffect[], opts: { fromPhoto?: boolean } = {}) => {
      for (const e of effects) {
        switch (e.type) {
          case 'toast':
            showToast(e.message, e.tone);
            break;
          case 'speak':
            lastSpoken.current = e.text;
            services.speak(e.text, specRef.current.lang);
            break;
          case 'aiProposal':
            setAiStatus((s) => ({ ...s, [e.proposal.blockId]: { phase: 'done', badge: e.proposal.source, latencyMs: e.proposal.latencyMs } }));
            setProposal(e.proposal);
            setOfflineStep(null);
            announce(tr('runtime.chrome.checkSuggested'));
            break;
          case 'aiUnavailable':
            setAiStatus((s) => ({ ...s, [e.blockId]: { phase: 'failed', badge: e.badge, message: e.message } }));
            if (e.badge === 'offline') setOfflineStep(e.blockId);
            if (!opts.fromPhoto) showToast(e.message, 'warning');
            else announce(e.message);
            break;
        }
      }
    },
    [announce, services, showToast, tr],
  );

  // ── Confirmations in the app's own theme (never the browser's native dialog) ─
  const [confirmReq, setConfirmReq] = useState<ConfirmRequest | null>(null);
  const svc = useMemo<RuntimeServices>(() => ({
    ...services,
    confirm: (message: string) => new Promise<boolean>((resolve) => {
      setConfirmReq({ message, resolve: (ok) => { setConfirmReq(null); resolve(ok); } });
    }),
  }), [services]);

  // ── Running engine operations ──────────────────────────────────────────────
  // One runtime context per running app (docs/09 §6): the spec, services, data snapshot, formula cache and the
  // operations in flight. Every engine call goes through `ctx.run`, so a lifecycle flush can wait for them (`idle`).
  const ctx = useMemo(
    () => createRuntimeContext({ spec, appId, services: svc, accessibility: accessModes, data: dataRef.current }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new spec is swapped in below, never by rebuilding the context
    [appId, svc, accessModes],
  );
  ctxRef.current = ctx;
  if (ctx.spec() !== spec) ctx.setSpec(spec);

  // Unsent typing survives a suspended app (docs/09 §15.5). Only the real app keeps a draft, never a preview.
  const keeperRef = useRef<ReturnType<typeof createDraftKeeper> | undefined>(undefined);
  useEffect(() => {
    if (mode !== 'live') return undefined;
    const keeper = createDraftKeeper(services.state, appId, () => specRef.current);
    keeperRef.current = keeper;
    let alive = true;
    void keeper.load().then((d) => {
      // Only into a fresh start: never over a screen the person already moved on.
      if (alive && d && rtRef.current.stack.length === 1 && !Object.keys(rtRef.current.forms).length) commit({ ...rtRef.current, ...d });
    });
    const off = lifecycle.register(async () => {
      await ctx.idle();
      await keeper.save(rtRef.current);
    });
    return () => {
      alive = false;
      off();
      keeperRef.current = undefined;
    };
  }, [mode, services, appId, ctx, commit]);

  const exec = useCallback(
    async (op: Op, overrides?: Partial<RuntimeServices>, fromPhoto?: boolean) => {
      const start = rtRef.current;
      const res = await ctx.run((e) => op(e, start), overrides);
      if (res.state !== start) commit(res.state);
      if (res.kvWrites) {
        dataRef.current = { ...dataRef.current, state: { ...dataRef.current.state, ...res.kvWrites } };
        setData(dataRef.current);
      }
      // A saved entry must not come back as a draft after the app is closed.
      if (res.ok) void keeperRef.current?.save(res.state);
      handleEffects(res.effects, { fromPhoto });
      return res;
    },
    [commit, ctx, handleEffects],
  );
  // Buttons: one action at a time — a double tap must not insert twice.
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async (op: Op, overrides?: Partial<RuntimeServices>, fromPhoto?: boolean) => {
      if (busyRef.current) return undefined;
      busyRef.current = true;
      setBusy(true);
      try {
        return await exec(op, overrides, fromPhoto);
      } catch {
        showToast(tr('runtime.chrome.wentWrong'), 'error');
        return undefined;
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [exec, showToast, tr],
  );
  // Counters: rapid taps are queued (never dropped) so each one counts.
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const enqueue = useCallback((op: Op) => {
    chain.current = chain.current.then(() => exec(op)).catch(() => showToast(tr('runtime.chrome.countFailed'), 'error'));
  }, [exec, showToast, tr]);

  // ── Derived view state ─────────────────────────────────────────────────────
  const screen = currentScreen(spec, rt);
  const rawForm = useMemo(() => getForm(spec, rt, screen, new Date()), [spec, rt, screen]);
  const defs = useMemo(() => screenFieldDefs(spec, screen), [spec, screen]);
  const form = useMemo(() => lenientForm(defs, rawForm), [defs, rawForm]);
  const records = data?.records;
  const collections = useMemo(() => collectionValues(spec, records ?? {}), [spec, records]);
  const kv = data?.state ?? {};
  // The entry this screen is about: a customer's page lists and totals only that customer's entries.
  const selected = selectedId(spec, rt);

  // A queued AI step that finished while the app was closed or offline comes back as a proposal for the person to
  // check, like a live one, on the screen that runs the step (docs/09 §12.5). Each result is shown once.
  const queued = useQueuedAiResults(appId);
  const shownOps = useRef(new Set<string>());
  useEffect(() => {
    if (mode !== 'live' || proposal || !data) return;
    for (const op of queued) {
      if (shownOps.current.has(op.id)) continue;
      const result = readAiStepResult(op);
      if (!result) continue;
      const found = proposalFromQueued(ctx.env(), rtRef.current, result);
      if (!found) continue;
      shownOps.current.add(op.id);
      setQueuedOp(op.id);
      setProposal(found);
      announce(tr('runtime.chrome.checkSuggested'));
      return;
    }
  }, [mode, proposal, data, queued, screen.id, ctx, announce, tr]);
  const settleQueued = useCallback(() => {
    if (queuedOp) void getOperationQueue().dismiss(queuedOp).catch(() => undefined);
    setQueuedOp(null);
  }, [queuedOp]);

  // Access Modes the app suggests are offered, never switched on by the app itself (docs/10).
  const offered = useMemo(() => (mode === 'live' ? offeredAccessModes(spec, accessModes, kv) : []), [mode, spec, accessModes, kv]);
  const acceptModes = useCallback((picked: readonly SuggestedMode[]) => {
    const store = useSettingsStore.getState();
    const next = { ...store.settings.accessModes, ...Object.fromEntries(picked.map((m) => [m, true])) };
    void store.update({ accessModes: next }).catch(() => showToast(tr('runtime.chrome.wentWrong'), 'error'));
  }, [showToast, tr]);
  const dismissModes = useCallback(() => {
    void services.state.set(appId, SUGGESTED_MODES_KEY, 'dismissed').catch(() => undefined);
  }, [services, appId]);

  // The reminder switch reaches the device only in the real app; a preview never schedules anything.
  const reminderDevice = useMemo<ReminderDevice | undefined>(
    () => (mode === 'live' ? { requestPermission: () => getNotificationAdapter().requestPermission(), sync: syncReminders } : undefined),
    [mode],
  );
  const openNotificationSettings = useMemo(() => {
    const adapter = mode === 'live' ? getNotificationAdapter() : undefined;
    return adapter?.openSettings ? () => void adapter.openSettings?.().catch(() => undefined) : undefined;
  }, [mode]);

  // Screen change: short fade-rise (fade only under reduced motion) + Read-aloud of the title.
  const enter = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    enter.setValue(0);
    Animated.timing(enter, { toValue: 1, duration: 220, easing: EASE_OUT, useNativeDriver: NATIVE_DRIVER }).start();
    // Voice-only says the title and the commands itself (VoiceControl), so the runtime stays quiet then.
    if (runtimeAnnouncesTitle(accessModes)) announce(screen.title);
    // Intentionally keyed on the screen id only: re-theming must not replay the entrance.
  }, [screen.id]);

  const back = useCallback(() => {
    if (rtRef.current.stack.length > 1) commit(goBack(rtRef.current));
    else onExit?.();
  }, [commit, onExit]);

  // Android hardware back walks the app's own stack first (BackHandler doesn't exist on web).
  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (rtRef.current.stack.length <= 1) return false;
      commit(goBack(rtRef.current));
      return true;
    });
    return () => sub.remove();
  }, [commit]);

  const [width, setWidth] = useState(0);
  const onLayout = useCallback((e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width), []);
  const wide = width >= 720;
  const framed = width >= 1024;

  const setField = useCallback(
    (field: string, value: RecordValue) => {
      const s = rtRef.current;
      commit(setFieldValue(specRef.current, s, currentScreen(specRef.current, s).id, field, value, new Date()));
    },
    [commit],
  );

  const pickPhoto = useCallback(
    async (c: ComponentOf<'photo'>) => {
      announce(readAloudText(c));
      const capture = async () => {
        const img = await services.pickImage();
        if (img) {
          setPhotos((p) => ({ ...p, [c.id]: img }));
          if (c.aiBlock) setAiStatus((s) => ({ ...s, [c.aiBlock as string]: { phase: 'running' } }));
        }
        return img;
      };
      if (!c.aiBlock) {
        await capture().catch(() => showToast(tr('runtime.chrome.pickerFailed'), 'error'));
        return;
      }
      const blockId = c.aiBlock;
      await run((e, st) => runAIBlockFlow(e, st, blockId), { pickImage: capture }, true);
      // Cancelled pickers or thrown errors must not leave a spinner behind.
      setAiStatus((s) => (s[blockId]?.phase === 'running' ? { ...s, [blockId]: { phase: 'failed' } } : s));
    },
    [announce, run, services, showToast, tr],
  );

  if (loadFailed) {
    return (
      <Centered t={t}>
        <Text style={[font(t, 17, '600'), { color: t.colors.text, textAlign: 'center' }]}>{tr('runtime.chrome.dataFailedTitle')}</Text>
        <Text style={[font(t, 15), { color: t.colors.textMuted, textAlign: 'center' }]}>{tr('runtime.chrome.dataFailedBody')}</Text>
      </Centered>
    );
  }
  if (!data) {
    return (
      <Centered t={t}>
        <ActivityIndicator color={t.colors.primaryText} accessibilityLabel={tr('runtime.chrome.opening')} />
      </Centered>
    );
  }

  // Every component type is drawn by the registry (./registry), which gets what it may read and the few things it may ask for.
  const appTheme = t;
  const renderEnv: RenderEnv = {
    spec, appId, screen, defs, rawForm, form, errors: rt.errors, records, collections, kv, selected, busy, photos, aiStatus, reminderStatus, tr,
    focus: (c) => announce(readAloudText(c)),
    setField,
    step: (c, op) => {
      announce(tr(op === 'increment' ? 'runtime.chrome.countUp' : 'runtime.chrome.countDown', { label: c.label }));
      enqueue((e, st) => stepCounter(e, st, c.id, op));
    },
    press: (actionId) => void run((e, st) => dispatchAction(e, st, actionId)),
    openRecord: (list, r) => {
      announce(readAloudText(list));
      const next = openRecord(specRef.current, rtRef.current, list, r, new Date());
      if (next) commit(next);
    },
    toggleRecord: (list, r) => {
      if (list.toggleField) void run((e, st) => toggleRecordField(e, st, list.source, r.id, list.toggleField as string));
    },
    deleteRecord: (list, r, title) => void run((e, st) => deleteListRecord(e, st, list.source, r.id, tr('runtime.chrome.confirmDelete', { title }))),
    switchReminder: (c, on) => void run(async (e, st) => {
      const r = await setReminderEnabled(e, st, c.id, on, reminderDevice);
      setReminderStatus((prev) => ({ ...prev, [c.id]: r.reminderStatus }));
      return r;
    }),
    openNotificationSettings,
    finishTimer: (message) => showToast(message, 'info'),
    pickPhoto: (c) => void pickPhoto(c),
  };
  const render = (c: KalamComponent): ReactNode => renderComponent(c, appTheme, renderEnv);

  // The screen's layout groups (rows, grids, cards); with none, consecutive stats still share a row.
  const showMore = moreOn[screen.id] === true;
  const folded = foldedCount(screen, accessModes);
  const items = arrangeScreen(screen, visibleChildren(screen, accessModes, { showMore }));

  const canGoBack = rt.stack.length > 1 || !!onExit;
  const prevTitle = rt.stack.length > 1 ? spec.screens.find((s) => s.id === rt.stack[rt.stack.length - 2])?.title : undefined;
  const translateY = reduced ? 0 : enter.interpolate({ inputRange: [0, 1], outputRange: [8, 0] });

  return (
    <AppLanguageProvider value={spec.lang}>
    <RuntimeContextProvider value={ctx}>
    <View
      onLayout={onLayout}
      // The app's own language tags its content, separate from Kalam's UI language (docs/10 §11).
      {...(Platform.OS === 'web' ? ({ lang: spec.lang } as object) : {})}
      style={[styles.root, { backgroundColor: framed ? desk : t.colors.background }]}
    >
      <View
        style={[
          styles.app,
          { backgroundColor: t.colors.background },
          framed && [styles.framed, kalam.elevation[2], { borderColor: kalam.colors.borderStrong, borderRadius: Math.min(t.radius + 12, 28) }],
        ]}
      >
        {/* The preview note is Kalam's, not the app's: a stamp on a paper strip, in Kalam's own colours. */}
        {mode === 'preview' ? (
          <View style={[styles.previewStrip, { backgroundColor: kalam.colors.surfaceAlt }]}>
            <View style={{ alignSelf: 'center' }}>
              <Stamp kind="plain" size="sm" label={tr('runtime.chrome.preview')} />
            </View>
          </View>
        ) : null}
        <View style={[styles.header, { paddingHorizontal: t.space, paddingTop: t.space * 0.75, gap: 4 }]}>
          {canGoBack ? (
            <Pressy
              accessibilityRole="button"
              accessibilityLabel={prevTitle ? tr('runtime.chrome.backTo', { name: prevTitle }) : tr('runtime.chrome.close')}
              onPress={back}
              style={[styles.back, { minHeight: t.target, minWidth: t.target, marginLeft: -t.space * 0.5 }]}
            >
              <ChevronLeft size={24 * t.fontScale} color={t.colors.primaryText} />
              {prevTitle ? <Text numberOfLines={1} style={[font(t, 16, '500'), { color: t.colors.primaryText, maxWidth: 200 }]}>{prevTitle}</Text> : null}
            </Pressy>
          ) : null}
          {accessModes.readAloud ? (
            <View style={{ flexDirection: 'row', marginLeft: 'auto', gap: 4 }}>
              <Pressy accessibilityRole="button" accessibilityLabel={tr('runtime.chrome.readAgain')} onPress={repeatSpeech} style={[styles.back, { minHeight: t.target, minWidth: t.target, justifyContent: 'center' }]}>
                <Repeat size={20 * t.fontScale} color={t.colors.primaryText} />
              </Pressy>
              <Pressy accessibilityRole="button" accessibilityLabel={tr('runtime.chrome.stopReading')} onPress={stopSpeech} style={[styles.back, { minHeight: t.target, minWidth: t.target, justifyContent: 'center' }]}>
                <Square size={18 * t.fontScale} color={t.colors.primaryText} />
              </Pressy>
            </View>
          ) : null}
        </View>
        <ScrollView
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
          // Extra room at the end so the microphone button never covers the last control.
          contentContainerStyle={{ paddingHorizontal: t.space, paddingBottom: t.space * 6 + 72 }}
        >
          <Animated.View style={{ opacity: enter, transform: [{ translateY }], gap: t.space * 0.85 }}>
            <View style={{ gap: 4, marginBottom: t.space * 0.25 }}>
              <Text accessibilityRole="header" style={[font(t, 28, '700', 1.2), { color: t.colors.text, letterSpacing: -0.4 }]}>
                {screen.title}
              </Text>
              {screen.description ? <Text style={[font(t, 15), { color: t.colors.textMuted }]}>{screen.description}</Text> : null}
            </View>
            <SuggestedModesNotice t={t} lang={spec.lang} modes={offered} onAccept={acceptModes} onDismiss={dismissModes} />
            <LayoutView items={items} t={t} render={render} />
            {folded > 0 ? (
              <ShowMoreToggle
                t={t} open={showMore} label={showMore ? tr('runtime.chrome.showLess') : tr('runtime.chrome.showMore', { count: folded })}
                onPress={() => setMoreOn((m) => ({ ...m, [screen.id]: !showMore }))}
              />
            ) : null}
            {offlineStep && mode === 'live' && Object.prototype.hasOwnProperty.call(spec.aiBlocks, offlineStep) ? (
              <QueueAiOffer
                appId={appId} blockId={offlineStep} block={spec.aiBlocks[offlineStep]} form={form}
                image={photos[visibleChildren(screen, accessModes).find((c) => c.type === 'photo' && c.aiBlock === offlineStep)?.id ?? '']}
                pickImage={services.pickImage} onQueued={() => setOfflineStep(null)}
              />
            ) : null}
          </Animated.View>
        </ScrollView>
        <Toast toast={toast} t={t} reduced={reduced} />
        <VoiceControl
          spec={spec} appId={appId} screenId={screen.id} services={services} accessModes={accessModes} theme={t}
          run={run} getState={() => rtRef.current} onBack={back}
        />
      </View>
      <ConfirmSheet request={confirmReq} t={t} wide={wide} lang={spec.lang} />
      <AIReviewSheet
        proposal={proposal}
        spec={spec}
        t={t}
        wide={wide}
        onAccept={() => {
          const p = proposal;
          setProposal(null);
          settleQueued();
          if (p) void run((e, st) => acceptProposal(e, st, p));
        }}
        onDiscard={() => {
          setProposal(null);
          settleQueued();
          showToast(tr('runtime.chrome.nothingFilled'), 'info');
        }}
      />
    </View>
    </RuntimeContextProvider>
    </AppLanguageProvider>
  );
}

function Centered({ t, children }: { t: ReturnType<typeof resolveAppTheme>; children: ReactNode }) {
  return (
    <View style={[styles.root, styles.centered, { backgroundColor: t.colors.background, padding: t.space * 2, gap: 8 }]}>{children}</View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center' },
  app: { flex: 1, width: '100%', maxWidth: 720, alignSelf: 'center', overflow: 'hidden' },
  framed: { marginVertical: 24, borderWidth: 1 },
  previewStrip: { paddingVertical: 6, alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', minHeight: 8 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingRight: 8 },
});
