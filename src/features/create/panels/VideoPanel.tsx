/**
 * Video modality (docs/03 §10, docs/06 §2.4): a ≤60s clip becomes up to six distinct keyframes
 * extracted on this device. Only those frames are used for building; the video stays here.
 */
import { Film, Trash2, Video } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { Image, Platform, ScrollView, View } from 'react-native';
import { Button, Text, useKalamTheme } from '@/design';
import { pickVideo } from '@/infrastructure/platform/image';
import { extractKeyframes } from '@/infrastructure/platform/media';
import { useCreationStore } from '@/state/creation-store';

export function VideoPanel() {
  const { colors, space, radius } = useKalamTheme();
  const video = useCreationStore((s) => s.video);
  const setVideo = useCreationStore((s) => s.setVideo);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const abort = useRef<AbortController | undefined>(undefined);

  const add = async (from: 'camera' | 'library') => {
    setError(undefined);
    try {
      const picked = await pickVideo(from);
      if (!picked) return;
      setBusy('Reading frames from your video…');
      abort.current = new AbortController();
      const res = await extractKeyframes(picked.uri, { durationSec: picked.durationSec, signal: abort.current.signal });
      if (!res.frames.length) throw new Error('No frames could be read from this video.');
      setVideo({
        ...(picked.name ? { name: picked.name } : {}),
        durationSec: res.durationSec || picked.durationSec,
        frames: res.frames,
        droppedFrames: res.dropped,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'This video could not be read. Try an MP4 under 60 seconds.');
    } finally {
      setBusy(undefined);
      abort.current = undefined;
    }
  };

  return (
    <View style={{ gap: space[4] }}>
      <Text tone="secondary">
        Record yourself going through the paper register or routine the app should replace. Up to 60 seconds.
        Kalam keeps a few distinct frames; the video itself stays on this device.
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[3] }}>
        <Button label={video ? 'Replace video' : 'Choose a video'} icon={Film} onPress={() => add('library')} disabled={!!busy} />
        {Platform.OS !== 'web' ? (
          <Button label="Record a video" icon={Video} variant="outline" onPress={() => add('camera')} disabled={!!busy} />
        ) : null}
      </View>
      {busy ? (
        <View style={{ flexDirection: 'row', gap: space[3], alignItems: 'center' }}>
          <Text tone="secondary" accessibilityLiveRegion="polite">{busy}</Text>
          <Button label="Stop" variant="ghost" size="sm" onPress={() => abort.current?.abort()} />
        </View>
      ) : null}
      {error ? <Text tone="danger" accessibilityRole="alert">{error}</Text> : null}
      {video ? (
        <View style={{ gap: space[2] }}>
          <Text variant="bodySmall" tone="secondary" numeric>
            {Math.round(video.durationSec)} s · {video.frames.length} frame{video.frames.length === 1 ? '' : 's'} kept
            {video.droppedFrames ? ` (${video.droppedFrames} repeated frame${video.droppedFrames === 1 ? '' : 's'} skipped)` : ''}
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space[2] }}>
            {video.frames.map((f) => (
              <View key={f.id} style={{ gap: space[1] }}>
                <Image
                  source={{ uri: `data:${f.mimeType};base64,${f.base64}` }}
                  accessibilityLabel={f.label ?? 'Video frame'}
                  style={{ width: 120, height: 120 * (f.height / Math.max(1, f.width)), maxHeight: 180, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt }}
                  resizeMode="cover"
                />
                <Text variant="caption" tone="muted">{f.label?.replace('Frame at ', '')}</Text>
              </View>
            ))}
          </ScrollView>
          <View style={{ flexDirection: 'row' }}>
            <Button label="Remove video" icon={Trash2} variant="ghost" size="sm" onPress={() => setVideo(undefined)} />
          </View>
        </View>
      ) : null}
    </View>
  );
}
