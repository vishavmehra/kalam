/**
 * Voice modality (docs/03 §9, docs/06 §2.3). Speech is transcribed on the device whenever the
 * platform offers it; the platform's online speech service is used only after explicit consent.
 * The transcript is editable. The raw recording is kept on this device only when Settings say so
 * (lead decision 3, docs/11 §7.3); otherwise only the words are kept.
 */
import { Download, Mic, Pause, Play, Square, Trash2 } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import {
  RecordingPresets, requestRecordingPermissionsAsync, useAudioPlayer, useAudioRecorder,
} from 'expo-audio';
import { DEFAULT_SPEECH } from '@/core/contracts';
import { canListenIn, LANGUAGES, recogniserFor } from '@/components/languages';
import { Button, Chip, Stamp, Surface, SwitchRow, Text, TextField, useKalamTheme, useReducedMotion, webData } from '@/design';
import { speechServiceName } from '@/features/settings/speech/languages';
import { discardRecording, settleRecording } from '@/infrastructure/platform/media-audio';
import { getSpeechCapability, installOnDeviceSpeech, type SpeechCapability } from '@/infrastructure/platform/speech';
import { useSegmentedDictation } from '@/features/media';
import { useT } from '@/i18n/react';
import { useCreationStore } from '@/state/creation-store';
import { useSettingsStore } from '@/state/settings-store';

import { useRadioRoving } from '../PreferencesPanel';
import { removeVoiceNote } from '../voice-note';

const SERVICE_NAME = speechServiceName(Platform.OS);
const baseOf = (tag: string) => tag.toLowerCase().split('-')[0];
/** What was found for a language tag: the same tag, else any region of the same language ("en-US" is answered by "en-IN"). */
const found = (verdicts: Record<string, SpeechCapability>, tag: string) => verdicts[tag] ?? Object.entries(verdicts).find(([k]) => baseOf(k) === baseOf(tag))?.[1];
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function VoicePanel() {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const { colors, space } = theme;
  const reduced = useReducedMotion();
  // Recognition uses the listening language from Settings; the app's own language is only for what is built.
  const speech = useSettingsStore((s) => s.settings.speech ?? DEFAULT_SPEECH);
  const updateSettings = useSettingsStore((s) => s.update);
  const language = speech.sttLanguage;
  const voice = useCreationStore((s) => s.voice);
  const setVoice = useCreationStore((s) => s.setVoice);
  const cloudAllowed = useSettingsStore((s) => s.settings.aiMode !== 'offline_only' && s.settings.allowCloud);
  const keepRecording = useSettingsStore((s) => !!s.settings.speech?.keepRecordings);

  /**
   * What the recogniser says about each language, by locale. Empty until the first tap on the microphone or on a
   * language: some browsers misbehave when recognition is probed on page load.
   */
  const [verdicts, setVerdicts] = useState<Record<string, SpeechCapability>>({});
  const cap = found(verdicts, language);
  const setCap = (c: SpeechCapability) => setVerdicts((v) => ({ ...v, [language]: c }));
  const checkAll = async (): Promise<Record<string, SpeechCapability>> => {
    const entries = await Promise.all(LANGUAGES.map(async (l) => {
      const c = await getSpeechCapability(l.locale).catch((): SpeechCapability => ({ supported: false, onDevice: 'unavailable', locale: l.locale }));
      return [l.locale, c] as const;
    }));
    const all = Object.fromEntries(entries);
    setVerdicts(all);
    return all;
  };
  const [checking, setChecking] = useState(false);
  const [consent, setConsent] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string>();
  const [seconds, setSeconds] = useState(0);
  // Pause and resume with timed segments (docs/06 §2.3). The words so far are kept while paused.
  const d = useSegmentedDictation({ lang: language, onDevice: cap?.onDevice === 'available', keepRecording });
  const { state: dState, recordings, error: dError, elapsedMs } = d;
  const listening = dState === 'listening';
  const paused = dState === 'paused';
  const active = useRef(false);
  /** Listening really began since the last start; an idle state before that is not an end. */
  const ran = useRef(false);
  const where = useRef<'on_device' | 'cloud_service'>('on_device');
  const base = useRef('');
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const webRecording = useRef(false);
  const player = useAudioPlayer(voice?.audioUri ?? null);

  useEffect(() => {
    if (!listening) return undefined;
    const id = setInterval(() => setSeconds(Math.floor(elapsedMs() / 1000)), 500);
    return () => clearInterval(id);
  }, [listening, elapsedMs]);

  // The transcript follows what the recogniser has heard so far, after any words already there.
  useEffect(() => {
    if (!active.current) return;
    const words = (base.current + d.transcript).trim();
    if (words) setVoice({ ...(useCreationStore.getState().voice ?? {}), transcript: words, recognizedBy: where.current });
  }, [d.transcript, setVoice]);
  useEffect(() => { if (listening) ran.current = true; }, [listening]);

  // When listening ends: the recorded copy is kept only if "Keep recordings" is on (lead decision 3), else deleted.
  useEffect(() => {
    if (dState !== 'idle' || !active.current || !(ran.current || dError)) return undefined;
    let alive = true;
    void (async () => {
      let uri: string | undefined;
      if (webRecording.current) {
        webRecording.current = false;
        try { await recorder.stop(); uri = recorder.uri ?? undefined; } catch { /* keep the transcript */ }
      }
      const [first, ...rest] = [...(uri ? [uri] : []), ...recordings];
      const kept = await settleRecording(first, keepRecording, discardRecording);
      for (const extra of rest) await settleRecording(extra, false, discardRecording);
      if (!alive) return;
      const current = useCreationStore.getState().voice;
      if (current) setVoice({ ...current, ...(kept ? { audioUri: kept } : {}), durationSec: Math.max(1, Math.round(elapsedMs() / 1000)) });
    })();
    return () => { alive = false; };
  }, [dState, dError, recordings, elapsedMs, keepRecording, recorder, setVoice]);

  const onDevice = cap?.onDevice === 'available';
  const canUseCloud = cloudAllowed && consent;
  const canListen = !!cap?.supported && (onDevice || canUseCloud);

  const onMic = async () => {
    if (listening) { d.stop(); return; }
    if (paused) { resumeListening(); return; }
    let c = cap;
    if (!c) {
      setChecking(true);
      c = found(await checkAll(), language) ?? { supported: false, onDevice: 'unavailable', locale: language };
      setChecking(false);
    }
    const local = c.onDevice === 'available';
    if (c.supported && (local || canUseCloud)) await start(local);
  };

  const start = async (local: boolean) => {
    setError(undefined);
    setSeconds(0);
    base.current = voice?.transcript ? `${voice.transcript} ` : '';
    where.current = local ? 'on_device' : 'cloud_service';
    active.current = true;
    ran.current = false;
    // Web: record a local copy alongside recognition only if the person chose to keep recordings
    // (Android keeps it natively under the same setting).
    if (Platform.OS === 'web' && keepRecording) {
      try {
        if ((await requestRecordingPermissionsAsync()).granted) {
          await recorder.prepareToRecordAsync();
          recorder.record();
          webRecording.current = true;
        }
      } catch { webRecording.current = false; }
    }
    await d.start({ onDevice: local });
  };

  const pauseListening = () => {
    d.pause();
    if (webRecording.current) try { recorder.pause(); } catch { /* the copy simply keeps running */ }
  };
  const resumeListening = () => {
    if (webRecording.current) try { recorder.record(); } catch { /* ignore */ }
    void d.resume();
  };

  const install = async () => {
    setInstalling(true);
    const ok = await installOnDeviceSpeech(language);
    setInstalling(false);
    setCap(await getSpeechCapability(language));
    if (!ok) setError(t('create.speak.downloadFailed'));
  };

  // Only languages the recogniser can handle are offered; the rest are named, never shown as available (docs/06 §8.6).
  const rows = LANGUAGES.map((l) => ({ l, selected: baseOf(l.locale) === baseOf(language), r: recogniserFor(verdicts[l.locale], cloudAllowed) }));
  const offered = rows.filter((x) => x.selected || canListenIn(x.r));
  const unavailable = rows.filter((x) => !offered.includes(x));
  const pickLanguage = (locale: string) => {
    if (baseOf(locale) === baseOf(language) || listening || paused) return;
    void updateSettings({ speech: { ...speech, sttLanguage: locale } }).catch(() => undefined);
    if (!Object.keys(verdicts).length) void checkAll();
  };
  const roving = useRadioRoving(offered.map((x) => x.l.code), offered.find((x) => x.selected)?.l.code, (code) => {
    const next = LANGUAGES.find((l) => l.code === code);
    if (next) pickLanguage(next.locale);
  });

  const statusStamp = onDevice
    ? <Stamp kind="device" label={t('create.speak.onDevice')} size="sm" />
    : canUseCloud ? <Stamp kind="cloud" label={t('create.speak.byService', { service: SERVICE_NAME })} size="sm" /> : null;

  return (
    <View style={{ gap: space[4] }}>
      <Text tone="secondary">{t('create.speak.intro')}</Text>

      <View role="radiogroup" aria-label={t('create.speak.language')} style={{ gap: space[2] }}>
        <Text weight="semibold" tone="secondary" variant="bodySmall">{t('create.speak.language')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {offered.map(({ l, selected }, i) => (
            <Chip key={l.code} label={l.native} lang={l.code} accessibilityLabel={l.english} role="radio" selected={selected}
              onPress={() => pickLanguage(l.locale)} rovingProps={roving.itemProps(i)} />
          ))}
        </View>
        {unavailable.length ? (
          <Text variant="caption" tone="muted">{t('create.speak.languagesOff', { names: unavailable.map((x) => x.l.english).join(', ') })}</Text>
        ) : null}
      </View>

      {cap && !cap.supported ? (
        <Surface tone="alt" padded radius="lg">
          <Text>{t('create.speak.unavailable')}</Text>
        </Surface>
      ) : null}

      {cap?.supported && !onDevice ? (
        <Surface tone="alt" padded radius="lg" style={{ gap: space[3] }}>
          {cap.onDevice === 'downloadable' || cap.onDevice === 'downloading' ? (
            <View style={{ gap: space[2] }}>
              <Text>{t('create.speak.downloadBody', { locale: cap.locale })}</Text>
              <View style={{ flexDirection: 'row' }}>
                <Button label={t('create.speak.download')} icon={Download} variant="outline" loading={installing || cap.onDevice === 'downloading'} onPress={install} />
              </View>
            </View>
          ) : null}
          {cloudAllowed ? (
            <SwitchRow
              label={t('create.speak.useService', { service: SERVICE_NAME })}
              description={t('create.speak.useServiceBody')}
              value={consent}
              onValueChange={setConsent}
            />
          ) : (
            <Text tone="secondary">{t('create.speak.cloudOff')}</Text>
          )}
        </Surface>
      ) : null}

      <View style={{ alignItems: 'center', gap: space[3], paddingVertical: space[4] }}>
        <Pressable
          onPress={() => void onMic()}
          disabled={(!!cap && !canListen && !listening && !paused) || checking}
          accessibilityRole="button"
          accessibilityLabel={t(listening ? 'create.speak.stop' : paused ? 'create.speak.resume' : 'create.speak.start')}
          accessibilityState={{ disabled: (!!cap && !canListen && !listening && !paused) || checking, busy: checking }}
          {...webData({ kPress: '' })}
          style={{
            width: 88, height: 88, borderRadius: 44,
            alignItems: 'center', justifyContent: 'center',
            // Listening is not an error: the key turns to ink with a haldi ring, never danger red.
            backgroundColor: listening ? colors.text : canListen || !cap || paused ? colors.actionBg : colors.surfaceAlt,
            borderWidth: listening && !reduced ? 6 : 0,
            borderColor: colors.accent,
          }}
        >
          {listening ? <Square size={28} color={colors.background} fill={colors.background} /> : paused ? <Mic size={32} color={colors.actionFg} /> : <Mic size={32} color={canListen || !cap ? colors.actionFg : colors.textMuted} />}
        </Pressable>
        <Text variant="bodySmall" tone="secondary" numeric accessibilityLiveRegion="polite">
          {listening
            ? t('create.speak.listening', { time: clock(seconds) })
            : paused
              ? t('create.speak.paused', { time: clock(Math.floor(elapsedMs() / 1000)) })
              : t(checking ? 'create.speak.checking' : canListen || !cap ? 'create.speak.tap' : 'create.speak.chooseFirst')}
        </Text>
        {listening || paused ? (
          <View style={{ flexDirection: 'row', gap: space[2] }}>
            {listening
              ? <Button label={t('create.speak.pause')} icon={Pause} variant="outline" size="sm" onPress={pauseListening} />
              : <Button label={t('create.speak.done')} icon={Square} variant="outline" size="sm" onPress={() => d.stop()} />}
          </View>
        ) : null}
        {statusStamp}
      </View>

      {error ?? dError ? <Text tone="danger" accessibilityRole="alert">{error ?? dError}</Text> : null}

      <TextField
        label={t('create.voice.transcript')}
        multiline
        // Words arrive while listening or paused; typing would be overwritten by the next stretch, so fix them after.
        editable={!listening && !paused}
        value={voice?.transcript ?? ''}
        onChangeText={(t) => setVoice(t ? { ...(voice ?? { recognizedBy: 'typed' }), transcript: t } : undefined)}
        placeholder={t('create.voice.transcriptPlaceholder')}
        helper={voice?.audioUri ? t('create.speak.kept') : undefined}
      />
      {voice ? (
        <View style={{ flexDirection: 'row', gap: space[2], flexWrap: 'wrap' }}>
          {voice.audioUri ? (
            <Button label={t('create.voice.play')} icon={Play} variant="outline" size="sm" onPress={() => { player.seekTo(0); player.play(); }} />
          ) : null}
          <Button
            label={t('create.voice.remove')}
            icon={Trash2}
            variant="ghost"
            size="sm"
            onPress={() => { active.current = false; d.stop(); removeVoiceNote(voice, setVoice); }}
          />
        </View>
      ) : null}
    </View>
  );
}
