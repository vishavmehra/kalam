/**
 * Voice modality (docs/03 §9, docs/06 §2.3). Speech is transcribed on the device whenever the
 * platform offers it; the platform's online speech service is used only after explicit consent.
 * The transcript is editable. The raw recording is kept on this device only when Settings say so
 * (lead decision 3, docs/11 §7.3); otherwise only the words are kept.
 */
import { Download, Mic, Play, Square, Trash2 } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import {
  RecordingPresets, requestRecordingPermissionsAsync, useAudioPlayer, useAudioRecorder,
} from 'expo-audio';
import { Button, Chip, Surface, SwitchRow, Text, TextField, useKalamTheme, useReducedMotion, webData } from '@/design';
import { discardRecording, settleRecording } from '@/infrastructure/platform/media-audio';
import {
  getSpeechCapability, installOnDeviceSpeech, startDictation, type DictationSession, type SpeechCapability,
} from '@/infrastructure/platform/speech';
import { useCreationStore } from '@/state/creation-store';
import { useSettingsStore } from '@/state/settings-store';

const SERVICE_NAME = Platform.OS === 'web'
  ? 'your browser\'s speech service'
  : Platform.OS === 'ios' ? 'Apple\'s speech service' : 'Android\'s speech service';

export function VoicePanel() {
  const { colors, space } = useKalamTheme();
  const reduced = useReducedMotion();
  const language = useCreationStore((s) => s.preferences.language);
  const voice = useCreationStore((s) => s.voice);
  const setVoice = useCreationStore((s) => s.setVoice);
  const cloudAllowed = useSettingsStore((s) => s.settings.aiMode !== 'offline_only' && s.settings.allowCloud);
  const keepRecording = useSettingsStore((s) => !!s.settings.speech?.keepRecordings);

  const [cap, setCap] = useState<SpeechCapability>();
  const [consent, setConsent] = useState(false);
  const [listening, setListening] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string>();
  const [seconds, setSeconds] = useState(0);
  const session = useRef<DictationSession | undefined>(undefined);
  const base = useRef('');
  const startedAt = useRef(0);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const player = useAudioPlayer(voice?.audioUri ?? null);

  useEffect(() => {
    let alive = true;
    getSpeechCapability(language).then((c) => alive && setCap(c)).catch(() => alive && setCap(undefined));
    return () => { alive = false; };
  }, [language]);

  useEffect(() => {
    if (!listening) return;
    const t0 = Date.now();
    const id = setInterval(() => setSeconds(Math.floor((Date.now() - t0) / 1000)), 500);
    return () => clearInterval(id);
  }, [listening]);

  useEffect(() => () => session.current?.abort(), []);

  const onDevice = cap?.onDevice === 'available';
  const canUseCloud = cloudAllowed && consent;
  const canListen = !!cap?.supported && (onDevice || canUseCloud);

  const start = async () => {
    setError(undefined);
    setSeconds(0);
    startedAt.current = Date.now();
    base.current = voice?.transcript ? `${voice.transcript} ` : '';
    // Web: record a local copy alongside recognition only if the person chose to keep recordings
    // (Android keeps it natively under the same setting).
    let recording = false;
    if (Platform.OS === 'web' && keepRecording) {
      try {
        if ((await requestRecordingPermissionsAsync()).granted) {
          await recorder.prepareToRecordAsync();
          recorder.record();
          recording = true;
        }
      } catch { recording = false; }
    }
    try {
      const where = onDevice ? 'on_device' : 'cloud_service';
      session.current = await startDictation({
        lang: language,
        onDevice,
        keepRecording,
        onText: (text) => setVoice({ transcript: (base.current + text).trim(), recognizedBy: where }),
        onError: (msg) => setError(msg),
        onEnd: async ({ audioUri }) => {
          setListening(false);
          session.current = undefined;
          let uri = audioUri ?? undefined;
          if (recording) {
            try { await recorder.stop(); uri = recorder.uri ?? uri; } catch { /* keep transcript */ }
          }
          // Lead decision 3: the raw audio is deleted unless "Keep recordings" is on.
          uri = await settleRecording(uri, keepRecording, discardRecording);
          const current = useCreationStore.getState().voice;
          if (current) setVoice({ ...current, ...(uri ? { audioUri: uri } : {}), durationSec: Math.round((Date.now() - startedAt.current) / 1000) });
        },
      });
      setListening(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Speech recognition could not start.');
      if (recording) recorder.stop().catch(() => {});
    }
  };

  const install = async () => {
    setInstalling(true);
    const ok = await installOnDeviceSpeech(language);
    setInstalling(false);
    setCap(await getSpeechCapability(language));
    if (!ok) setError('The on-device speech model could not be downloaded right now.');
  };

  const statusChip = onDevice
    ? <Chip label="Transcribed on this device" tone="success" />
    : canUseCloud ? <Chip label={`Transcribed by ${SERVICE_NAME}`} tone="info" /> : null;

  return (
    <View style={{ gap: space[4] }}>
      <Text tone="secondary">
        Explain your app out loud: who uses it, what to record, what to add up. You can fix the words before building.
      </Text>

      {cap && !cap.supported ? (
        <Surface tone="alt" padded radius="lg">
          <Text>Speech recognition is not available here. Type your idea in Describe instead.</Text>
        </Surface>
      ) : null}

      {cap?.supported && !onDevice ? (
        <Surface tone="alt" padded radius="lg" style={{ gap: space[3] }}>
          {cap.onDevice === 'downloadable' || cap.onDevice === 'downloading' ? (
            <View style={{ gap: space[2] }}>
              <Text>On-device speech recognition can be downloaded for {cap.locale}. Your voice then never leaves this device.</Text>
              <View style={{ flexDirection: 'row' }}>
                <Button label="Download speech model" icon={Download} variant="outline" loading={installing || cap.onDevice === 'downloading'} onPress={install} />
              </View>
            </View>
          ) : null}
          {cloudAllowed ? (
            <SwitchRow
              label={`Use ${SERVICE_NAME}`}
              description="Your voice is sent to that service to be turned into text. Kalam does not upload the recording."
              value={consent}
              onValueChange={setConsent}
            />
          ) : (
            <Text tone="secondary">Online AI is turned off in Settings, so only on-device speech can be used.</Text>
          )}
        </Surface>
      ) : null}

      <View style={{ alignItems: 'center', gap: space[3], paddingVertical: space[4] }}>
        <Pressable
          onPress={listening ? () => session.current?.stop() : start}
          disabled={!canListen && !listening}
          accessibilityRole="button"
          accessibilityLabel={listening ? 'Stop listening' : 'Start speaking'}
          accessibilityState={{ disabled: !canListen && !listening }}
          {...webData({ kPress: '' })}
          style={{
            width: 88, height: 88, borderRadius: 44,
            alignItems: 'center', justifyContent: 'center',
            backgroundColor: listening ? colors.danger : canListen ? colors.primary : colors.surfaceAlt,
            borderWidth: listening && !reduced ? 6 : 0,
            borderColor: colors.dangerSoft,
          }}
        >
          {listening ? <Square size={28} color={colors.onPrimary} fill={colors.onPrimary} /> : <Mic size={32} color={canListen ? colors.onPrimary : colors.textMuted} />}
        </Pressable>
        <Text variant="bodySmall" tone="secondary" numeric accessibilityLiveRegion="polite">
          {listening ? `Listening… ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : canListen ? 'Tap to speak' : 'Choose how to transcribe first'}
        </Text>
        {statusChip}
      </View>

      {error ? <Text tone="danger" accessibilityRole="alert">{error}</Text> : null}

      <TextField
        label="Transcript"
        multiline
        value={voice?.transcript ?? ''}
        onChangeText={(t) => setVoice(t ? { ...(voice ?? { recognizedBy: 'typed' }), transcript: t } : undefined)}
        placeholder="Your words appear here. Fix anything Kalam misheard."
        helper={voice?.audioUri ? 'The recording is kept on this device only.' : undefined}
      />
      {voice ? (
        <View style={{ flexDirection: 'row', gap: space[2], flexWrap: 'wrap' }}>
          {voice.audioUri ? (
            <Button label="Play recording" icon={Play} variant="outline" size="sm" onPress={() => { player.seekTo(0); player.play(); }} />
          ) : null}
          <Button label="Remove voice note" icon={Trash2} variant="ghost" size="sm" onPress={() => setVoice(undefined)} />
        </View>
      ) : null}
    </View>
  );
}
