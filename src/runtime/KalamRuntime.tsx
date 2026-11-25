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
import type { AccessModes, AIImage, KalamRecord, RecordValue, RuntimeServices } from '@/core/contracts';
import type { ComponentOf, KalamComponent, KalamSpec } from '@/core/spec/schema';
import {
  acceptProposal, clamp, collectionValues, createRuntimeState, currentScreen, deleteListRecord, dispatchAction, getForm,
  goBack, lenientForm, openRecord, parseNumber, readAloudText, resolveAppTheme, runAIBlockFlow, runtimeAnnouncesTitle,
  screenFieldDefs, setFieldValue, speaksResults, stepCounter, toggleRecordField, visibleChildren,
  type ActionResult, type AIProposal, type DataSnapshot, type EngineEnv, type RuntimeEffect, type RuntimeState,
} from './engine';
import { BigButton, Counter, Heading, Stat, TextBlock } from './ui/blocks';
import { ChoiceField, DateField, NumberField, TextField, ToggleField } from './ui/inputs';
import { EASE_OUT, font, NATIVE_DRIVER, Pressy, useReducedMotion, type AppTheme } from './ui/kit';
import { ListView } from './ui/ListView';
import { AIReviewSheet, ConfirmSheet, type ConfirmRequest, Toast, type ToastMessage } from './ui/overlays';
import { PhotoBlock, type AIRunStatus } from './ui/PhotoBlock';
import { RuntimeErrorBoundary } from './ui/RuntimeErrorBoundary';
import { stopSpeakingAloud, VoiceControl } from './voice';
import { useKalamTheme } from '@/design/theme';
import { useRuntimeFont } from '@/i18n/use-script-fonts';

export interface KalamRuntimeProps {
  spec: KalamSpec;
  appId: string;
  services: RuntimeServices;
  /** `preview` marks the app as a sandbox (edit screen); data then lives in memory services. */
  mode?: 'live' | 'preview';
  accessModes: AccessModes;
  /** Called when the person goes back from the first screen. */
  onExit?: () => void;
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

function RuntimeApp({ spec, appId, services, mode = 'live', accessModes, onExit }: KalamRuntimeProps) {
  // The app's font follows its own language (spec.lang), not Kalam's (docs/10 §12.1).
  const scriptFont = useRuntimeFont(spec.lang);
  const t = useMemo<AppTheme>(() => ({ ...resolveAppTheme(spec.theme, accessModes), scriptFont }), [spec.theme, accessModes, scriptFont]);
  const reduced = useReducedMotion();
  // The desk around a framed app belongs to Kalam (light or dark shell); the app keeps its own theme.
  const desk = useKalamTheme().colors.background;
  const specRef = useRef(spec);
  specRef.current = spec;

  // ── Runtime state (navigation, forms, selection) ──────────────────────────
  const [rt, setRt] = useState<RuntimeState>(() => createRuntimeState(spec));
  const rtRef = useRef(rt);
  const commit = useCallback((next: RuntimeState) => {
    rtRef.current = next;
    setRt(next);
  }, []);

  // ── Local data (records + counters), kept fresh by repository subscriptions ─
  const [data, setData] = useState<DataSnapshot | null>(null);
  const dataRef = useRef<DataSnapshot>({ records: {}, state: {} });
  const [loadFailed, setLoadFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    const publish = (patch: Partial<DataSnapshot>) => {
      if (!alive) return;
      dataRef.current = { ...dataRef.current, ...patch };
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
      clearTimeout(toastTimer.current);
      setToast({ id: Date.now(), message, tone });
      announce(message);
      toastTimer.current = setTimeout(() => setToast(null), tone === 'warning' || tone === 'error' ? 4200 : 2400);
    },
    [announce],
  );

  // ── AI state ───────────────────────────────────────────────────────────────
  const [proposal, setProposal] = useState<AIProposal | null>(null);
  const [aiStatus, setAiStatus] = useState<Record<string, AIRunStatus>>({});
  const [photos, setPhotos] = useState<Record<string, AIImage>>({});

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
            announce('Check the suggested values before filling them in.');
            break;
          case 'aiUnavailable':
            setAiStatus((s) => ({ ...s, [e.blockId]: { phase: 'failed', badge: e.badge, message: e.message } }));
            if (!opts.fromPhoto) showToast(e.message, 'warning');
            else announce(e.message);
            break;
        }
      }
    },
    [announce, services, showToast],
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
  const env = useCallback(
    (overrides?: Partial<RuntimeServices>): EngineEnv => ({
      spec: specRef.current,
      appId,
      services: overrides ? { ...svc, ...overrides } : svc,
      data: dataRef.current,
      now: new Date(),
    }),
    [appId, svc],
  );
  const exec = useCallback(
    async (op: Op, overrides?: Partial<RuntimeServices>, fromPhoto?: boolean) => {
      const start = rtRef.current;
      const res = await op(env(overrides), start);
      if (res.state !== start) commit(res.state);
      if (res.kvWrites) {
        dataRef.current = { ...dataRef.current, state: { ...dataRef.current.state, ...res.kvWrites } };
        setData(dataRef.current);
      }
      handleEffects(res.effects, { fromPhoto });
      return res;
    },
    [commit, env, handleEffects],
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
        showToast('Something went wrong. Nothing was changed.', 'error');
        return undefined;
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [exec, showToast],
  );
  // Counters: rapid taps are queued (never dropped) so each one counts.
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const enqueue = useCallback((op: Op) => {
    chain.current = chain.current.then(() => exec(op)).catch(() => showToast("Couldn't save the count.", 'error'));
  }, [exec, showToast]);

  // ── Derived view state ─────────────────────────────────────────────────────
  const screen = currentScreen(spec, rt);
  const rawForm = useMemo(() => getForm(spec, rt, screen, new Date()), [spec, rt, screen]);
  const defs = useMemo(() => screenFieldDefs(spec, screen), [spec, screen]);
  const form = useMemo(() => lenientForm(defs, rawForm), [defs, rawForm]);
  const records = data?.records;
  const collections = useMemo(() => collectionValues(spec, records ?? {}), [spec, records]);
  const kv = data?.state ?? {};

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
        await capture().catch(() => showToast("Couldn't open the photo picker.", 'error'));
        return;
      }
      const blockId = c.aiBlock;
      await run((e, st) => runAIBlockFlow(e, st, blockId), { pickImage: capture }, true);
      // Cancelled pickers or thrown errors must not leave a spinner behind.
      setAiStatus((s) => (s[blockId]?.phase === 'running' ? { ...s, [blockId]: { phase: 'failed' } } : s));
    },
    [announce, run, services, showToast],
  );

  if (loadFailed) {
    return (
      <Centered t={t}>
        <Text style={[font(t, 17, '600'), { color: t.colors.text, textAlign: 'center' }]}>This app's data couldn't be opened.</Text>
        <Text style={[font(t, 15), { color: t.colors.textMuted, textAlign: 'center' }]}>
          Your records are still on this device. Close the app and open it again.
        </Text>
      </Centered>
    );
  }
  if (!data) {
    return (
      <Centered t={t}>
        <ActivityIndicator color={t.colors.primaryText} accessibilityLabel="Opening app" />
      </Centered>
    );
  }

  const render = (c: KalamComponent) => {
    const focus = () => announce(readAloudText(c));
    switch (c.type) {
      case 'text': return <TextBlock key={c.id} c={c} t={t} />;
      case 'heading': return <Heading key={c.id} c={c} t={t} />;
      case 'number':
        return <NumberField key={c.id} c={c} t={t} def={defs[c.field]} value={rawForm[c.field]} error={rt.errors[c.field]} onChange={(v) => setField(c.field, v)} onFocus={focus} />;
      case 'textInput':
        return <TextField key={c.id} c={c} t={t} def={defs[c.field]} value={rawForm[c.field]} error={rt.errors[c.field]} onChange={(v) => setField(c.field, v)} onFocus={focus} />;
      case 'date':
        return <DateField key={c.id} c={c} t={t} def={defs[c.field]} value={rawForm[c.field]} error={rt.errors[c.field]} onChange={(v) => setField(c.field, v)} onFocus={focus} />;
      case 'choice':
        return <ChoiceField key={c.id} c={c} t={t} def={defs[c.field]} value={rawForm[c.field]} error={rt.errors[c.field]} onChange={(v) => setField(c.field, v)} onFocus={focus} />;
      case 'toggle':
        return <ToggleField key={c.id} c={c} t={t} def={defs[c.field]} value={rawForm[c.field]} onChange={(v) => setField(c.field, v)} onFocus={focus} />;
      case 'counter': {
        const stored = c.field ? parseNumber(rawForm[c.field]) : kv[c.id];
        const value = typeof stored === 'number' ? stored : clamp(0, c.min, c.max);
        return (
          <Counter
            key={c.id} c={c} t={t} value={value}
            onStep={(op) => {
              announce(`${c.label} ${op === 'increment' ? 'up' : 'down'}`);
              enqueue((e, st) => stepCounter(e, st, c.id, op));
            }}
          />
        );
      }
      case 'bigButton':
        return (
          <BigButton
            key={c.id} c={c} t={t} busy={busy}
            onPress={() => {
              focus();
              void run((e, st) => dispatchAction(e, st, c.action));
            }}
          />
        );
      case 'list':
        return (
          <ListView
            key={c.id} c={c} t={t} spec={spec} records={records?.[c.source] ?? EMPTY} collections={collections} form={form} state={kv}
            onOpen={(r: KalamRecord) => {
              announce(readAloudText(c));
              const next = openRecord(specRef.current, rtRef.current, c, r, new Date());
              if (next) commit(next);
            }}
            onToggle={(r) => c.toggleField && void run((e, st) => toggleRecordField(e, st, c.source, r.id, c.toggleField as string))}
            onDelete={(r, title) => void run((e, st) => deleteListRecord(e, st, c.source, r.id, `Delete "${title}"? This can't be undone.`))}
          />
        );
      case 'stat':
        return <Stat key={c.id} c={c} t={t} lang={spec.lang} collections={collections} form={form} state={kv} />;
      case 'photo':
        return (
          <PhotoBlock
            key={c.id} c={c} t={t} image={photos[c.id]} status={c.aiBlock ? aiStatus[c.aiBlock] : undefined}
            disabled={busy} onPick={() => void pickPhoto(c)}
          />
        );
      default:
        // Unknown component types never execute; the rest of the screen keeps working (docs/09 §5.3).
        return (
          <View key={(c as { id: string }).id} style={{ padding: t.space, borderRadius: t.radius, backgroundColor: t.colors.surfaceAlt }}>
            <Text style={[font(t, 14), { color: t.colors.textMuted }]}>
              {`This part (${String((c as { type?: unknown }).type ?? 'unknown').slice(0, 40)}) needs a newer version of Kalam. The rest of the screen works. Update Kalam to see it.`}
            </Text>
          </View>
        );
    }
  };

  // Consecutive stats share a row so dashboards read as one group.
  const groups: Array<KalamComponent | KalamComponent[]> = [];
  for (const c of visibleChildren(screen, accessModes)) {
    const last = groups[groups.length - 1];
    if (c.type === 'stat' && Array.isArray(last)) last.push(c);
    else groups.push(c.type === 'stat' ? [c] : c);
  }

  const canGoBack = rt.stack.length > 1 || !!onExit;
  const prevTitle = rt.stack.length > 1 ? spec.screens.find((s) => s.id === rt.stack[rt.stack.length - 2])?.title : undefined;
  const translateY = reduced ? 0 : enter.interpolate({ inputRange: [0, 1], outputRange: [8, 0] });

  return (
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
          framed && [styles.framed, { borderColor: t.colors.border, borderRadius: Math.min(t.radius + 12, 28) }],
        ]}
      >
        {mode === 'preview' ? (
          <View style={[styles.previewStrip, { backgroundColor: t.colors.primarySoft }]}>
            <Text style={[font(t, 12, '500'), { color: t.colors.primaryText }]}>Preview. Records added here are not saved.</Text>
          </View>
        ) : null}
        <View style={[styles.header, { paddingHorizontal: t.space, paddingTop: t.space * 0.75, gap: 4 }]}>
          {canGoBack ? (
            <Pressy
              accessibilityRole="button"
              accessibilityLabel={prevTitle ? `Back to ${prevTitle}` : 'Close app'}
              onPress={back}
              style={[styles.back, { minHeight: t.target, minWidth: t.target, marginLeft: -t.space * 0.5 }]}
            >
              <ChevronLeft size={24 * t.fontScale} color={t.colors.primaryText} />
              {prevTitle ? <Text numberOfLines={1} style={[font(t, 16, '500'), { color: t.colors.primaryText, maxWidth: 200 }]}>{prevTitle}</Text> : null}
            </Pressy>
          ) : null}
          {accessModes.readAloud ? (
            <View style={{ flexDirection: 'row', marginLeft: 'auto', gap: 4 }}>
              <Pressy accessibilityRole="button" accessibilityLabel="Read that again" onPress={repeatSpeech} style={[styles.back, { minHeight: t.target, minWidth: t.target, justifyContent: 'center' }]}>
                <Repeat size={20 * t.fontScale} color={t.colors.primaryText} />
              </Pressy>
              <Pressy accessibilityRole="button" accessibilityLabel="Stop reading" onPress={stopSpeech} style={[styles.back, { minHeight: t.target, minWidth: t.target, justifyContent: 'center' }]}>
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
            {groups.map((g) =>
              Array.isArray(g) ? (
                <View key={g[0].id} style={[styles.statRow, { gap: t.space * 0.75 }]}>{g.map(render)}</View>
              ) : (
                render(g)
              ),
            )}
          </Animated.View>
        </ScrollView>
        <Toast toast={toast} t={t} reduced={reduced} />
        <VoiceControl
          spec={spec} appId={appId} screenId={screen.id} services={services} accessModes={accessModes} theme={t}
          run={run} getState={() => rtRef.current} onBack={back}
        />
      </View>
      <ConfirmSheet request={confirmReq} t={t} wide={wide} />
      <AIReviewSheet
        proposal={proposal}
        spec={spec}
        t={t}
        wide={wide}
        onAccept={() => {
          const p = proposal;
          setProposal(null);
          if (p) void run((e, st) => acceptProposal(e, st, p));
        }}
        onDiscard={() => {
          setProposal(null);
          showToast('Nothing was filled in.', 'info');
        }}
      />
    </View>
  );
}

const EMPTY: KalamRecord[] = [];

function Centered({ t, children }: { t: ReturnType<typeof resolveAppTheme>; children: ReactNode }) {
  return (
    <View style={[styles.root, styles.centered, { backgroundColor: t.colors.background, padding: t.space * 2, gap: 8 }]}>{children}</View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center' },
  app: { flex: 1, width: '100%', maxWidth: 720, alignSelf: 'center', overflow: 'hidden' },
  framed: {
    marginVertical: 24, borderWidth: 1,
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 24, shadowOffset: { width: 0, height: 12 },
  },
  previewStrip: { paddingVertical: 6, alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', minHeight: 8 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingRight: 8 },
  statRow: { flexDirection: 'row', flexWrap: 'wrap' },
});
