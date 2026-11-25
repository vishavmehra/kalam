/**
 * Creation Workspace (docs/03 §6, docs/02 §11.3). One session, five input methods; the active
 * surface dominates, and the input tray under it shows every input that will go into the one app.
 * Desktop: modality rail | editor + tray | preferences. Phone: modality pills, editor, tray and a
 * bottom-anchored Create button.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, RotateCcw, SlidersHorizontal, WandSparkles } from 'lucide-react-native';
import { useEffect, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, ConfirmSheet, IconButton, Sheet, SourceBadge, Surface, Text, useBreakpoint, useKalamTheme } from '@/design';
import { ClarifyQuestions } from '@/features/create/ClarifyQuestions';
import { CloudNoticeSheet } from '@/features/create/CloudNoticeSheet';
import { needsCloudNotice } from '@/features/create/cloud-use';
import { CreationProgress } from '@/features/create/CreationProgress';
import { inputSummary } from '@/features/create/input-summary';
import { InputTray } from '@/features/create/InputTray';
import { ModalityNav } from '@/features/create/ModalityNav';
import { DrawPanel } from '@/features/create/panels/DrawPanel';
import { PhotoPanel } from '@/features/create/panels/PhotoPanel';
import { TextPanel } from '@/features/create/panels/TextPanel';
import { VideoPanel } from '@/features/create/panels/VideoPanel';
import { VoicePanel } from '@/features/create/panels/VoicePanel';
import { PreferencesPanel } from '@/features/create/PreferencesPanel';
import { failureCopy } from '@/features/create/stages';
import { useCreateRun } from '@/features/create/use-create-run';
import { draftBlocker } from '@/features/input/normalize';
import { getServices } from '@/services';
import { selectDraft, useCreationStore, type Modality } from '@/state/creation-store';
import { useSettingsStore } from '@/state/settings-store';

const HEADINGS: Record<Modality, { title: string; panel: () => ReactNode }> = {
  text: { title: 'What should your app do?', panel: () => <TextPanel /> },
  photo: { title: 'Show Kalam a sketch or a page', panel: () => <PhotoPanel /> },
  voice: { title: 'Say what you need', panel: () => <VoicePanel /> },
  video: { title: 'Show how you work today', panel: () => <VideoPanel /> },
  draw: { title: 'Draw the screens', panel: () => <DrawPanel /> },
};

function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    try {
      const net = getServices().network;
      setOnline(net.online());
      return net.subscribe(setOnline);
    } catch {
      return undefined;
    }
  }, []);
  return online;
}

function Outcome({ onRetry }: { onRetry: () => void }) {
  const router = useRouter();
  const { space } = useKalamTheme();
  const online = useOnline();
  const run = useCreationStore((s) => s.run);
  const result = useCreationStore((s) => s.result);

  if (run.status === 'cancelled') {
    return <Text tone="secondary" accessibilityLiveRegion="polite">Building stopped. Everything you added is still here.</Text>;
  }
  if (run.status === 'succeeded' && result?.ok) {
    return (
      <Surface tone="primarySoft" padded radius="lg" style={{ flexDirection: 'row', alignItems: 'center', gap: space[3], flexWrap: 'wrap' }}>
        <Text style={{ flex: 1, minWidth: 200 }}>Your app is ready to review.</Text>
        <Button label="Review app" onPress={() => router.push('/create/review')} />
      </Surface>
    );
  }
  if (run.status !== 'failed' || !result) return null;
  const copy = failureCopy(result, online);
  return (
    <Surface tone="accentSoft" padded radius="lg" style={{ gap: space[2] }} accessibilityRole="alert">
      <Text variant="h4">{copy.title}</Text>
      <Text>{copy.body}</Text>
      {result.clarifications?.length ? <ClarifyQuestions key={result.clarifications.join('|')} questions={result.clarifications} onRetry={onRetry} /> : null}
      {copy.suggestion ? <Text tone="secondary">{copy.suggestion}</Text> : null}
    </Surface>
  );
}

export default function CreateWorkspace() {
  const router = useRouter();
  const params = useLocalSearchParams<{ prompt?: string }>();
  const theme = useKalamTheme();
  const { colors, space } = theme;
  const insets = useSafeAreaInsets();
  const { isPhone, isDesktop, width } = useBreakpoint();
  const online = useOnline();
  const modality = useCreationStore((s) => s.modality);
  const running = useCreationStore((s) => s.run.status === 'running');
  const blocker = useCreationStore((s) => draftBlocker(selectDraft(s)));
  const setText = useCreationStore((s) => s.setText);
  const setModality = useCreationStore((s) => s.setModality);
  const resetSession = useCreationStore((s) => s.resetSession);
  const { run, cancel } = useCreateRun();
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [askStartOver, setAskStartOver] = useState(false);
  const summary = useCreationStore((s) => inputSummary(s));
  // Load an already downloaded Gemini Nano now, so the first on-device step does not wait. Never downloads or goes online.
  useEffect(() => {
    void getServices().ai.warmUpOnDevice().catch(() => undefined);
  }, []);
  // Photos and video frames live in memory only: warn before a reload or tab close loses them
  // (docs/03 §2.2, §3.2). Typed text and the drawing are kept anyway.
  const unsavedMedia = useCreationStore((s) => s.photos.length > 0 || !!s.video?.frames.length);
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

  const build = async () => {
    const res = await run();
    if (res?.ok) router.push('/create/review');
  };
  // First build that may send content online: say what leaves the device first (docs/03 §23).
  const [noticeOpen, setNoticeOpen] = useState(false);
  const updateSettings = useSettingsStore((s) => s.update);
  const create = async () => {
    const settings = useSettingsStore.getState().settings;
    if (needsCloudNotice(settings, selectDraft(useCreationStore.getState()))) { setNoticeOpen(true); return; }
    await build();
  };
  const sendAfterNotice = async () => {
    setNoticeOpen(false);
    await updateSettings({ cloudNoticeSeen: true }).catch(() => undefined);
    await build();
  };
  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const heading = HEADINGS[modality];

  const createBar = (
    <View style={{ gap: space[2], alignItems: isPhone ? 'stretch' : 'flex-start' }}>
      <Button
        label="Create app"
        icon={WandSparkles}
        size="lg"
        fullWidth={isPhone}
        onPress={create}
        loading={running}
        disabled={!!blocker || running}
        accessibilityHint={blocker}
        testID="create-app"
      />
      {blocker ? <Text variant="bodySmall" tone="muted">{blocker}</Text> : isPhone && summary ? <Text variant="bodySmall" tone="secondary" numberOfLines={1}>Using: {summary}</Text> : null}
    </View>
  );

  const centre = (
    <View style={{ gap: space[6], width: '100%', maxWidth: 760, alignSelf: 'center' }}>
      {running ? <CreationProgress onCancel={cancel} /> : (
        <>
          <Text variant={isPhone ? 'h2' : 'h1'} display accessibilityRole="header">{heading.title}</Text>
          {heading.panel()}
          <Outcome onRetry={() => void create()} />
          <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space[5] }}>
            <InputTray />
          </View>
        </>
      )}
      {!isPhone && !running ? createBar : null}
    </View>
  );

  return (
    // iOS: keep the Create button and inputs above the keyboard.
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.background }}>
      <View
        style={{
          flexDirection: 'row', alignItems: 'center', gap: space[2],
          paddingTop: insets.top + space[2], paddingBottom: space[2], paddingHorizontal: isPhone ? space[2] : space[6],
          borderBottomWidth: 1, borderBottomColor: colors.border,
        }}
      >
        <IconButton icon={ArrowLeft} label="Back" onPress={back} />
        <Text variant="h4" style={{ flex: 1 }} accessibilityRole="header">New app</Text>
        {summary && !running ? (
          isPhone
            ? <IconButton icon={RotateCcw} label="Start over" onPress={() => setAskStartOver(true)} />
            : <Button label="Start over" icon={RotateCcw} variant="ghost" size="sm" onPress={() => setAskStartOver(true)} />
        ) : null}
        {!online ? <SourceBadge source="offline" label={isPhone ? 'Offline' : 'Offline. Simple apps still build'} /> : null}
        {!wide ? <IconButton icon={SlidersHorizontal} label="App preferences" onPress={() => setPrefsOpen(true)} /> : null}
      </View>

      {isDesktop ? (
        <View style={{ flex: 1, flexDirection: 'row' }}>
          <ScrollView style={{ width: 264, flexGrow: 0, borderRightWidth: 1, borderRightColor: colors.border }} contentContainerStyle={{ padding: space[4], gap: space[6] }}>
            <ModalityNav layout="rail" />
            <Text variant="bodySmall" tone="muted">Use one way or mix several. Everything you add goes into the same app.</Text>
          </ScrollView>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: space[10], paddingVertical: space[10] }} keyboardShouldPersistTaps="handled">
            {centre}
          </ScrollView>
          {wide ? (
            <ScrollView style={{ width: 320, flexGrow: 0, borderLeftWidth: 1, borderLeftColor: colors.border }} contentContainerStyle={{ padding: space[5], gap: space[4] }}>
              <Text variant="h4">App preferences</Text>
              <PreferencesPanel />
            </ScrollView>
          ) : null}
        </View>
      ) : (
        <>
          <View style={{ paddingHorizontal: isPhone ? space[4] : space[6], paddingTop: space[3] }}>
            <ModalityNav layout="bar" />
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: isPhone ? space[4] : space[6], gap: space[6] }} keyboardShouldPersistTaps="handled">
            {centre}
          </ScrollView>
          {isPhone && !running ? (
            <View
              style={{
                paddingHorizontal: space[4], paddingTop: space[3], paddingBottom: insets.bottom + space[3],
                borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface,
              }}
            >
              {createBar}
            </View>
          ) : null}
        </>
      )}

      <CloudNoticeSheet visible={noticeOpen} onSend={sendAfterNotice} onCancel={() => setNoticeOpen(false)} />
      <ConfirmSheet
        visible={askStartOver}
        title="Start over?"
        message="Everything you added for this app is removed from this device: your words, voice note, photos, video and drawing. Your app preferences stay."
        confirmLabel="Start over"
        destructive
        onCancel={() => setAskStartOver(false)}
        onConfirm={() => { setAskStartOver(false); resetSession(); }}
      />
      <Sheet visible={prefsOpen} onClose={() => setPrefsOpen(false)} title="App preferences" footer={<Button label="Done" onPress={() => setPrefsOpen(false)} fullWidth />}>
        <PreferencesPanel />
      </Sheet>
    </KeyboardAvoidingView>
  );
}
