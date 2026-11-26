/**
 * Attach an existing recording (docs/06 §2.3, §8; docs/01 §6.6): play, pause and resume it, see where
 * its text came from and which language it sounds like, and correct the text while the first version
 * is kept. The recording is stored only when "Keep recordings" is on (lead decision 3); otherwise it
 * plays until the person removes it or leaves the session. When only the platform's online speech
 * service could turn it into text, the card asks first (docs/10 §16.4).
 */
import { Check, FileAudio, Pause, Play, Trash2 } from 'lucide-react-native';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Chip, IconButton, Stamp, Surface, Text, TextField, useKalamTheme } from '@/design';
import { audioCopy, languageName, STATUS_LABEL } from '@/core/media/copy';
import { formatClock } from '@/core/media/frames';
import { wasEdited } from '@/core/media/transcript';
import type { MediaAttachment } from '@/core/media/types';
import { attachmentName } from '@/core/session/handoff';
import { getDatabase } from '@/infrastructure/storage/database';
import { loadAsset } from '@/infrastructure/storage/media-sessions';
import { MAX_BLOB_BYTES } from '@/infrastructure/storage/storage-limits';
import { allowOnlineSpeech, editAudioTranscript, playableAudioUri, useAudioFile } from './audio-intake';
import { removeMedia } from './media-actions';
import { useMediaStore } from './media-store';
import { WaveStrip } from './WaveStrip';

const mb = (b: number) => `${Math.round((b / (1024 * 1024)) * 10) / 10} MB`;

export function AudioFileInput() {
  const { space } = useKalamTheme();
  const audio = useAudioFile();
  const session = useMediaStore((s) => s.session);
  const files = session?.attachments.filter((a) => a.type === 'audio') ?? [];

  return (
    <View style={{ gap: space[3] }}>
      <View style={{ flexDirection: 'row', gap: space[3], alignItems: 'center', flexWrap: 'wrap' }}>
        <Button label={audioCopy.choose} icon={FileAudio} variant="outline" onPress={() => void audio.add()} loading={audio.busy} disabled={audio.busy} />
        {audio.busy ? <Button label={audioCopy.stop} variant="ghost" onPress={audio.cancel} /> : null}
      </View>
      {audio.message ? <Text tone="secondary" accessibilityLiveRegion="polite">{audio.message}</Text> : null}
      {session ? files.map((a) => <AudioCard key={a.id} attachment={a} name={a.name ?? attachmentName(session, a)} />) : null}
    </View>
  );
}

/** Data URI of a kept recording, loaded from the local store after a reload. */
function useKeptUri(a: MediaAttachment): string | undefined {
  const [uri, setUri] = useState<string>();
  useEffect(() => {
    let alive = true;
    if (!a.originalAssetId || playableAudioUri(a)) return undefined;
    void loadAsset(getDatabase(), a.originalAssetId).then((b) => {
      if (alive && b) setUri(`data:${b.mimeType};base64,${b.base64}`);
    });
    return () => { alive = false; };
  }, [a]);
  return playableAudioUri(a) ?? uri;
}

function AudioCard({ attachment: a, name }: { attachment: MediaAttachment; name: string }) {
  const { space, colors } = useKalamTheme();
  const transcript = useMediaStore((s) => s.session?.transcripts.find((t) => t.attachmentId === a.id));
  const uri = useKeptUri(a);
  const player = useAudioPlayer(uri ?? null);
  const status = useAudioPlayerStatus(player);
  const [showOriginal, setShowOriginal] = useState(false);
  const [note, setNote] = useState<string>();
  const busy = a.status === 'validating' || a.status === 'processing_local' || a.status === 'preparing_cloud';
  const askSpeech = a.error?.code === 'SPEECH_CONSENT_REQUIRED' && !busy;
  const edited = transcript ? wasEdited(transcript) : false;
  const playLabel = status.playing ? audioCopy.pause : status.currentTime > 0 ? audioCopy.resume : audioCopy.play;
  const meta = [a.durationMs !== undefined ? formatClock(a.durationMs) : '', a.sizeBytes ? mb(a.sizeBytes) : ''].filter(Boolean).join(' · ');

  return (
    <Surface bordered radius="paper" padded={space[3]} style={{ gap: space[2], ...(a.status === 'failed' ? { borderColor: colors.danger, borderWidth: 1.5 } : null) }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
        <WaveStrip />
        <View style={{ flex: 1, gap: 4 }}>
          <Text weight="semibold" numberOfLines={1}>{name}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2], flexWrap: 'wrap' }} accessibilityLiveRegion="polite">
            <Stamp kind={a.status === 'failed' ? 'needs' : 'plain'} icon={a.status === 'ready' ? Check : a.status === 'failed' ? undefined : null} label={STATUS_LABEL[a.status]} size="sm" />
            {meta ? <Text variant="bodySmall" tone="secondary" numeric>{meta}</Text> : null}
          </View>
        </View>
        {uri ? (
          <IconButton
            icon={status.playing ? Pause : Play}
            label={playLabel}
            onPress={() => (status.playing ? player.pause() : player.play())}
          />
        ) : null}
        <IconButton icon={Trash2} label={audioCopy.remove} onPress={() => removeMedia(a.id)} />
      </View>
      {!status.playing && status.currentTime > 0 ? <Text variant="caption" tone="muted">{audioCopy.pausedAt(formatClock(status.currentTime * 1000))}</Text> : null}
      {a.error && a.error.code !== 'SPEECH_CONSENT_REQUIRED' ?<Text tone="danger" accessibilityRole="alert">{a.error.message}</Text> : null}
      {askSpeech ? (
        <View style={{ gap: space[2] }}>
          <Text variant="bodySmall" tone="secondary">{a.error?.message}</Text>
          <Button label={audioCopy.useOnlineSpeech} variant="outline" onPress={() => void allowOnlineSpeech(a.id).then(setNote)} />
        </View>
      ) : null}
      {note ? <Text variant="bodySmall" tone="secondary" accessibilityLiveRegion="polite">{note}</Text> : null}
      {transcript?.language ? <Chip label={audioCopy.sounds(languageName(transcript.language))} tone="info" /> : null}
      {!busy && a.status !== 'failed' ? (
        <TextField
          label={audioCopy.transcriptLabel}
          helper={audioCopy.transcriptHelper}
          value={transcript?.text ?? ''}
          onChangeText={(t) => editAudioTranscript(a.id, t)}
          multiline
          maxLength={20_000}
        />
      ) : null}
      {edited && transcript ? (
        <View style={{ gap: space[1] }}>
          <Button label={showOriginal ? audioCopy.hideOriginal : audioCopy.showOriginal} variant="link" onPress={() => setShowOriginal((v) => !v)} />
          {showOriginal ? (
            <View style={{ gap: space[1] }}>
              <Text variant="bodySmall" tone="secondary">{audioCopy.originalLabel}</Text>
              <Text variant="bodySmall">{transcript.original}</Text>
              <Button label={audioCopy.restoreOriginal} variant="ghost" onPress={() => editAudioTranscript(a.id, transcript.original)} />
            </View>
          ) : null}
        </View>
      ) : null}
      <Text variant="caption" tone="muted">
        {a.originalAssetId ? audioCopy.kept : a.sizeBytes > MAX_BLOB_BYTES ? audioCopy.tooLargeToKeep : audioCopy.notKept}
      </Text>
    </Surface>
  );
}
