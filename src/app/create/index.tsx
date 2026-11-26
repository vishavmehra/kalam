/**
 * Create workspace (docs/03 §6, DIRECTION §6). Kalam's shell around one making session: "New app" with
 * honest status stamps, the five method tabs, the active input surface, then the tray that shows every
 * input as its material. Preferences (language, money, the cover as cloth swatches), the route forecast
 * and "Build app" sit in a right panel at 1280 px and wider; below that they follow the tray, and
 * "Build app" stays in a bar at the bottom. The workspace reveals once with an ink bloom on the web.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { LayoutTemplate, PenLine, RotateCcw, Wifi } from 'lucide-react-native';
import { type ComponentRef, useEffect, useRef, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useShallow } from 'zustand/react/shallow';

import { AppShell } from '@/components/shell/AppShell';
import { useAIStatus, useOnline } from '@/components/status/useHybridStatus';
import {
  Button, ConfirmSheet, IconButton, OfflineIcon, Stamp, Text, useBreakpoint, useKalamTheme, useReducedMotion, withAlpha,
} from '@/design';
import { ClarifyQuestions } from '@/features/create/ClarifyQuestions';
import { CloudNoticeSheet } from '@/features/create/CloudNoticeSheet';
import { cloudAllowed, draftMayUseCloud, needsCloudNotice } from '@/features/create/cloud-use';
import { CreationProgress } from '@/features/create/CreationProgress';
import { inputPartsT, sentenceCase } from '@/features/create/input-summary';
import { InputTray } from '@/features/create/InputTray';
import { ModalityNav } from '@/features/create/ModalityNav';
import { DrawPanel } from '@/features/create/panels/DrawPanel';
import { PhotoPanel } from '@/features/create/panels/PhotoPanel';
import { usePhotoDrop } from '@/features/create/panels/use-photo-drop';
import { TextPanel } from '@/features/create/panels/TextPanel';
import { VoicePanel } from '@/features/create/panels/VoicePanel';
import { BuildForecast, PreferencesPanel } from '@/features/create/PreferencesPanel';
import { checksPassed } from '@/features/create/review-save';
import { failureCopy, needsCloudWhileOffline } from '@/features/create/stages';
import { useCreateRun } from '@/features/create/use-create-run';
import { MAX_TEXT_CHARS } from '@/features/input/normalize';
import {
  AttachmentStatusList, AudioFileInput, ConflictQuestions, draftWithSession, HandoffNotice, SessionStatusNote, useCreateBlockerKey, useImageIntake, useMediaStore, useTypedInstructions, VideoInput,
} from '@/features/media';
import { QueueOffer, QueueStatusPill, startOperationQueue } from '@/features/queue';
import { availableActions, creationErrorCode, planRecovery, RecoveryCard, type RecoveryHandlers } from '@/features/recovery';
import { shelfRoutes } from '@/features/shelf/routes';
import type { TranslationKey } from '@/i18n/keys';
import { resolveLanguages } from '@/i18n/language-prefs';
import { useFormat, useT } from '@/i18n/react';
import { getServices } from '@/services';
import { selectDraft, useCreationStore, type Modality } from '@/state/creation-store';
import { useSettingsStore } from '@/state/settings-store';

const PANELS: Record<Modality, { title: TranslationKey; panel: () => ReactNode }> = {
  text: { title: 'create.heading.describe', panel: () => <TextPanel /> },
  photo: { title: 'create.heading.photo', panel: () => <PhotoPanel /> },
  // A recorded note and an attached audio file go into the same description (docs/06 §2.3).
  voice: { title: 'create.heading.voice', panel: () => (<><VoicePanel /><AudioFileInput /></>) },
  video: { title: 'create.heading.video', panel: () => <VideoInput /> },
  draw: { title: 'create.heading.draw', panel: () => <DrawPanel /> },
};

/** The ink bloom plays once per page load, from the Make key in the rail (DIRECTION §5: one authored moment). */
let bloomed = false;

function Outcome({ onRetry, online }: { onRetry: () => void; online: boolean }) {
  const router = useRouter();
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const { space, radius, colors } = theme;
  const run = useCreationStore((s) => s.run);
  const result = useCreationStore((s) => s.result);

  if (run.status === 'cancelled') {
    return <Text tone="secondary" accessibilityLiveRegion="polite">{t('create.stopped')}</Text>;
  }
  if (run.status === 'succeeded' && result?.ok) {
    const passed = checksPassed(result);
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3], flexWrap: 'wrap', padding: space[4], borderRadius: radius.paper, backgroundColor: theme.tints.violet }}>
        <Stamp kind={passed ? 'checked' : 'needs'} label={t(passed ? 'stamp.checked' : 'stamp.needs')} />
        <Text style={{ flex: 1, minWidth: 200 }}>{t('create.ready')}</Text>
        <Button label={t('create.review')} onPress={() => router.push('/create/review')} />
      </View>
    );
  }
  if (run.status !== 'failed' || !result) return null;
  const copy = failureCopy(result, online, t);
  const settings = useSettingsStore.getState().settings;
  // Only the stable code is read, never the message. Each action here does what its label says; the rest are left out.
  const code = creationErrorCode(result);
  const handlers: RecoveryHandlers = {
    retry: onRetry,
    turn_on_cloud: () => router.push('/settings'),
    change_input: () => useCreationStore.getState().clearResult(),
  };
  const recoveryActions = availableActions(planRecovery(code, 'ai'), handlers).length ? handlers : undefined;
  const offerQueue = needsCloudWhileOffline(result, online) && cloudAllowed(settings) && draftMayUseCloud(selectDraft(useCreationStore.getState()));
  return (
    // Build failure keeps the input and says what to do next, under a Needs check stamp (DIRECTION §6).
    <View accessibilityRole="alert" style={{ gap: space[2], padding: space[5], borderRadius: radius.paper, backgroundColor: theme.tints.haldi, borderWidth: theme.accessModes.highContrast ? 1.5 : 0, borderColor: colors.borderStrong }}>
      <Stamp kind="needs" label={t('stamp.needs')} />
      <Text variant="h4">{copy.title}</Text>
      <Text>{copy.body}</Text>
      {result.clarifications?.length ? <ClarifyQuestions key={result.clarifications.join('|')} questions={result.clarifications} onRetry={onRetry} /> : null}
      {copy.suggestion ? <Text tone="secondary">{copy.suggestion}</Text> : null}
      {/* Offline and this idea needs the cloud: keep it on this device and build it when the signal is back. */}
      {offerQueue ? <View style={{ flexDirection: 'row' }}><QueueOffer request={{ kind: 'compile', draft: draftWithSession(selectDraft(useCreationStore.getState())) }} /></View> : null}
      {/* What was kept and what can be done next, only when this screen can really do one of the listed actions. */}
      {recoveryActions ? <RecoveryCard error={code} origin="ai" handlers={recoveryActions} onDismiss={() => useCreationStore.getState().clearResult()} /> : null}
    </View>
  );
}

export default function CreateWorkspace() {
  const router = useRouter();
  const params = useLocalSearchParams<{ prompt?: string }>();
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const format = useFormat(theme.uiLanguage);
  const reduced = useReducedMotion();
  const { colors, space } = theme;
  const insets = useSafeAreaInsets();
  const { isPhone, hasRail, width } = useBreakpoint();
  const online = useOnline();
  const ai = useAIStatus().status;
  const modality = useCreationStore((s) => s.modality);
  const running = useCreationStore((s) => s.run.status === 'running');
  // An attached recording or a described file counts as input too (docs/06 §13).
  const blockerKey = useCreateBlockerKey();
  const blocker = blockerKey ? t(blockerKey, { max: MAX_TEXT_CHARS }) : undefined;
  const setText = useCreationStore((s) => s.setText);
  const setModality = useCreationStore((s) => s.setModality);
  const resetSession = useCreationStore((s) => s.resetSession);
  const { run, cancel } = useCreateRun();
  // The typed description is also kept as separate instructions with roles and times in the media session (docs/06 §6.3).
  useTypedInstructions();
  const [askStartOver, setAskStartOver] = useState(false);
  const parts = useCreationStore(useShallow((s) => inputPartsT(s, t)));
  const summary = sentenceCase(format.list(parts));
  // Attached files (an audio file, a described video) are work too: Start over clears them and leaving warns.
  const attached = useMediaStore((m) => m.session?.attachments.length ?? 0);
  // A new app starts in "Language for new apps" from Settings, unless the person already picked one here.
  const settingsReady = useSettingsStore((s) => s.hydrated);
  const newAppLanguage = useSettingsStore((s) => resolveLanguages(s.settings).newApp);
  useEffect(() => {
    if (!settingsReady) return undefined;
    const apply = () => useCreationStore.getState().adoptDefaultLanguage(newAppLanguage);
    if (useCreationStore.persist.hasHydrated()) { apply(); return undefined; }
    return useCreationStore.persist.onFinishHydration(apply);
  }, [settingsReady, newAppLanguage]);
  // Waiting tasks are picked up again here too (safe to start twice): a build queued offline runs once the signal is back.
  useEffect(() => {
    if (settingsReady) void startOperationQueue().catch(() => undefined);
  }, [settingsReady]);
  // Load an already downloaded Gemini Nano now, so the first on-device step does not wait. Never downloads or goes online.
  useEffect(() => {
    void getServices().ai.warmUpOnDevice().catch(() => undefined);
  }, []);
  // Photos and video frames live in memory only: warn before a reload or tab close loses them
  // (docs/03 §2.2, §3.2). Typed text and the drawing are kept anyway.
  const draftMedia = useCreationStore((s) => s.photos.length > 0 || !!s.video?.frames.length);
  const unsavedMedia = draftMedia || attached > 0;
  useEffect(() => {
    if (Platform.OS !== 'web' || !unsavedMedia) return undefined;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsavedMedia]);
  const wide = width >= 1280;

  useEffect(() => {
    const prompt = typeof params.prompt === 'string' ? params.prompt.trim() : '';
    if (!prompt) return undefined;
    const apply = () => { setText(prompt.slice(0, 4000)); setModality('text'); };
    // Apply after the persisted session hydrates, or hydration would overwrite the prompt.
    if (useCreationStore.persist.hasHydrated()) { apply(); return undefined; }
    return useCreationStore.persist.onFinishHydration(apply);
  }, [params.prompt, setText, setModality]);

  // The ink bloom: the workspace opens from the Make key, once (web only, never under reduced motion).
  const sheet = useRef<ComponentRef<typeof View>>(null);
  // Drop a picture on the screen, or paste one, from any way in: it joins the photos through the same checks as a picked file.
  const dropIntake = useImageIntake();
  const [tooBig, setTooBig] = useState(false);
  const dragging = usePhotoDrop(sheet, (files, skipped) => {
    setModality('photo');
    setTooBig(skipped > 0);
    void dropIntake.addFiles(files);
  }, !running);
  useEffect(() => {
    const el = sheet.current as unknown as HTMLElement | null;
    if (Platform.OS !== 'web' || reduced || bloomed || typeof el?.animate !== 'function') return;
    bloomed = true;
    el.animate([{ clipPath: 'circle(0% at 0px 96px)' }, { clipPath: 'circle(150% at 0px 96px)' }], { duration: 900, easing: 'cubic-bezier(0.65, 0, 0.35, 1)' });
  }, [reduced]);

  const build = async () => {
    const res = await run();
    if (res?.ok) router.push('/create/review');
  };
  // First build that may send content online: say what leaves the device first (docs/03 §23).
  const [noticeOpen, setNoticeOpen] = useState(false);
  const updateSettings = useSettingsStore((s) => s.update);
  const create = async () => {
    const settings = useSettingsStore.getState().settings;
    // Offline nothing can leave the device, so there is nothing to ask about yet: the build says what it needs, and a queued build asks when it runs.
    if (online && needsCloudNotice(settings, selectDraft(useCreationStore.getState()))) { setNoticeOpen(true); return; }
    await build();
  };
  const sendAfterNotice = async () => {
    setNoticeOpen(false);
    await updateSettings({ cloudNoticeSeen: true }).catch(() => undefined);
    await build();
  };
  const panel = PANELS[modality];

  const buildButton = (
    <Button
      label={t('create.ws.build')}
      icon={PenLine}
      size="lg"
      fullWidth
      onPress={create}
      loading={running}
      disabled={!!blocker || running}
      accessibilityHint={blocker}
      testID="create-app"
    />
  );
  const buildNote = blocker
    ? <Text variant="bodySmall" tone="muted">{blocker}</Text>
    : isPhone && summary ? <Text variant="bodySmall" tone="secondary" numberOfLines={1}>{t('create.ws.using', { summary })}</Text> : null;

  const head = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3], flexWrap: 'wrap' }}>
      <Text variant="h1" accessibilityRole="header" style={{ marginRight: 'auto' }}>{t('create.title')}</Text>
      {online
        ? <Stamp kind="plain" icon={Wifi} label={t('network.online')} size="sm" />
        : <Stamp kind="template" icon={OfflineIcon} label={t('create.ws.offlineBuild')} size="sm" />}
      {ai?.onDevice.availability === 'available' ? <Stamp kind="device" label={t('aiStatus.ready')} size="sm" /> : null}
      <QueueStatusPill onPress={() => router.push(shelfRoutes.queue)} />
      {!running ? (
        isPhone
          ? <IconButton icon={LayoutTemplate} label={t('create.templates.open')} onPress={() => router.push(shelfRoutes.templates)} testID="create-templates" />
          : <Button label={t('create.templates.open')} icon={LayoutTemplate} variant="ghost" size="sm" onPress={() => router.push(shelfRoutes.templates)} testID="create-templates" />
      ) : null}
      {(summary || attached > 0) && !running ? (
        isPhone
          ? <IconButton icon={RotateCcw} label={t('create.startOver.button')} onPress={() => setAskStartOver(true)} />
          : <Button label={t('create.startOver.button')} icon={RotateCcw} variant="ghost" size="sm" onPress={() => setAskStartOver(true)} />
      ) : null}
    </View>
  );

  const prefsInline = !wide && !running ? (
    <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space[6], gap: space[4] }}>
      <Text variant="h4" level={2}>{t('create.prefs.title')}</Text>
      <PreferencesPanel footer={<BuildForecast online={online} />} />
    </View>
  ) : null;

  const workspace = (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.surface }}
      contentContainerStyle={{ paddingHorizontal: isPhone ? space[4] : space[10], paddingTop: isPhone ? space[5] : 34, paddingBottom: space[10] }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={{ gap: isPhone ? 18 : space[6], width: '100%', maxWidth: 880 }}>
        {head}
        {/* While a build runs the ways in and the preferences step aside: a change would not reach this build. */}
        {running ? null : <ModalityNav />}
        {tooBig || dropIntake.message ? <Text tone="danger" accessibilityRole="alert">{tooBig ? t('create.photos.tooBig') : dropIntake.message}</Text> : null}
        {running ? <CreationProgress onCancel={cancel} /> : (
          <>
            <Text variant="h4" level={2}>{t(panel.title)}</Text>
            {panel.panel()}
            <Outcome online={online} onRetry={() => void create()} />
            <InputTray />
            <AttachmentStatusList />
            <SessionStatusNote />
            <ConflictQuestions />
            <HandoffNotice />
          </>
        )}
        {prefsInline}
      </View>
    </ScrollView>
  );

  return (
    <AppShell active="create">
      {/* iOS: keep Build app and the inputs above the keyboard. */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View ref={sheet} style={{ flex: 1, flexDirection: 'row', backgroundColor: colors.surface }}>
          {workspace}
          {dragging ? (
            <View
              pointerEvents="none"
              aria-hidden
              style={{ position: 'absolute', top: 8, left: 8, right: 8, bottom: 8, borderRadius: theme.radius.paper, borderWidth: 2, borderStyle: 'dashed', borderColor: colors.primary, backgroundColor: withAlpha(colors.primary, 0.08) }}
            />
          ) : null}
          {wide ? (
            // The preferences scroll; the forecast and Build app stay pinned at the bottom of the panel.
            <View style={{ width: 340, borderLeftWidth: 1, borderLeftColor: colors.border, backgroundColor: colors.background }}>
              <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 28, paddingTop: 30, paddingBottom: space[6], gap: space[4] }}>
                <Text variant="h4" level={2}>{t('create.prefs.title')}</Text>
                {running ? <Text variant="bodySmall" tone="secondary">{t('create.prefs.whileBuilding')}</Text> : <PreferencesPanel />}
              </ScrollView>
              <View style={{ gap: space[3], paddingHorizontal: 28, paddingTop: space[4], paddingBottom: space[6], borderTopWidth: 1, borderTopColor: colors.border }}>
                <BuildForecast online={online} />
                {buildButton}
                {buildNote}
              </View>
            </View>
          ) : null}
        </View>
        {!wide && !running ? (
          <View
            style={{
              flexDirection: isPhone ? 'column' : 'row', alignItems: isPhone ? 'stretch' : 'center', gap: space[3],
              paddingHorizontal: isPhone ? space[4] : space[10], paddingTop: space[3],
              paddingBottom: (hasRail ? insets.bottom : 0) + space[3],
              borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.background,
            }}
          >
            {isPhone ? null : <View style={{ flex: 1 }}>{blocker ? buildNote : <BuildForecast online={online} compact />}</View>}
            <View style={{ width: isPhone ? '100%' : 280, gap: space[2] }}>
              {buildButton}
              {isPhone ? buildNote : null}
            </View>
          </View>
        ) : null}
      </KeyboardAvoidingView>

      <CloudNoticeSheet visible={noticeOpen} onSend={sendAfterNotice} onCancel={() => setNoticeOpen(false)} />
      <ConfirmSheet
        visible={askStartOver}
        title={t('create.startOver.title')}
        message={t('create.startOver.message')}
        confirmLabel={t('create.startOver.button')}
        cancelLabel={t('common.cancel')}
        destructive
        onCancel={() => setAskStartOver(false)}
        onConfirm={() => { setAskStartOver(false); resetSession(); }}
      />
    </AppShell>
  );
}
