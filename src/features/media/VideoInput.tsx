/**
 * The video input (docs/06 §2.4, §9; docs/03 §10): choose or record a clip, see its checks and stages,
 * play it back, add a note, and review the steps Kalam read from it before building. The video stays
 * on this device; only frames go to a model, and only when building or when the person asks.
 */
import { Cloud, Film, Video } from 'lucide-react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Image, Platform, ScrollView, View } from 'react-native';
import { Button, Stamp, Surface, Text, TextField, useKalamTheme } from '@/design';
import { useT } from '@/i18n/react';
import { useCreationStore } from '@/state/creation-store';
import { STATUS_LABEL, videoCopy, workflowCopy } from '@/core/media/copy';
import { formatClock } from '@/core/media/frames';
import type { MediaAttachment } from '@/core/media/types';
import { describeMedia } from './media-actions';
import { useMediaStore } from './media-store';
import { OBJECT_COLORS } from './objects';
import { playableVideoUri, useVideoIntake, workflowLocked } from './video-intake';
import { WorkflowEditor } from './WorkflowEditor';

const mb = (b: number) => `${Math.round((b / (1024 * 1024)) * 10) / 10} MB`;

/** Film stock: the kept frames between two rows of sprocket holes (fixed object colours, DIRECTION §2.3). */
const FILM = OBJECT_COLORS.film;
const HOLE = OBJECT_COLORS.sprocket;

function Sprockets({ count }: { count: number }) {
  return (
    <View aria-hidden style={{ height: 16, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 4 }}>
      {Array.from({ length: count }, (_, i) => <View key={i} style={{ width: 8, height: 6, borderRadius: 1.5, backgroundColor: HOLE }} />)}
    </View>
  );
}

function FilmStrip() {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const video = useCreationStore((s) => s.video);
  if (!video?.frames.length) return null;
  return (
    <View style={{ gap: theme.space[2] }}>
      <Text variant="bodySmall" tone="secondary" numeric>
        {t('create.film.kept', { seconds: Math.round(video.durationSec), count: video.frames.length })}
        {video.droppedFrames ? ` ${t('create.film.skipped', { count: video.droppedFrames })}` : ''}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ borderRadius: theme.radius.paper, backgroundColor: FILM, paddingHorizontal: 6 }}>
        <View>
          <Sprockets count={video.frames.length * 7} />
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {video.frames.map((f, i) => (
              <Image
                key={f.id}
                source={{ uri: `data:${f.mimeType};base64,${f.base64}` }}
                accessibilityLabel={t('create.film.frame', { n: i + 1 })}
                style={{ width: 120, height: Math.min(180, 120 * (f.height / Math.max(1, f.width))), borderRadius: 2, backgroundColor: theme.colors.surfaceAlt }}
                resizeMode="cover"
              />
            ))}
          </View>
          <Sprockets count={video.frames.length * 7} />
        </View>
      </ScrollView>
    </View>
  );
}

export function VideoInput() {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const { space } = theme;
  const intake = useVideoIntake();
  const video = useMediaStore((s) => s.session?.attachments.find((a) => a.type === 'video'));

  return (
    <View style={{ gap: space[4] }}>
      <Text tone="secondary">{t('create.film.intro')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[3] }}>
        <Button label={video ? videoCopy.replace : videoCopy.choose} icon={Film} onPress={() => void intake.add('library')} disabled={!!intake.busy} />
        {Platform.OS !== 'web' ? (
          <Button label={videoCopy.record} icon={Video} variant="outline" onPress={() => void intake.add('camera')} disabled={!!intake.busy} />
        ) : null}
      </View>
      {intake.busy === 'reading' ? (
        <View style={{ flexDirection: 'row', gap: space[3], alignItems: 'center' }}>
          <Text tone="secondary" accessibilityLiveRegion="polite">{video ? STATUS_LABEL[video.status] : STATUS_LABEL.validating}</Text>
          <Button label={videoCopy.stop} variant="ghost" onPress={intake.cancel} />
        </View>
      ) : null}
      {intake.message ? <Text tone="secondary" accessibilityLiveRegion="polite">{intake.message}</Text> : null}
      {video ? <FilmStrip /> : null}
      {video ? <VideoDetails video={video} describing={intake.busy === 'describing'} onDescribe={() => void intake.describeWithAI(video.id)} /> : null}
    </View>
  );
}

function VideoDetails({ video, describing, onDescribe }: { video: MediaAttachment; describing: boolean; onDescribe(): void }) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const { space } = theme;
  const uri = playableVideoUri(video);
  // Steps the person edited or checked are theirs: cloud AI may not replace them.
  const locked = useMediaStore((s) => workflowLocked(s.session?.workflows.find((w) => w.attachmentId === video.id)));
  const meta = [
    video.durationMs !== undefined ? formatClock(video.durationMs) : '',
    video.sizeBytes ? mb(video.sizeBytes) : '',
    video.width && video.height ? `${video.width} × ${video.height}` : '',
  ].filter(Boolean);

  return (
    <View style={{ gap: space[3] }}>
      {uri ? <Player uri={uri} /> : (
        <Text variant="bodySmall" tone="secondary">{Platform.OS === 'web' ? videoCopy.notKeptOnWeb : videoCopy.missing}</Text>
      )}
      <Text variant="bodySmall" tone="secondary" numeric>{videoCopy.meta(meta)}</Text>
      {video.error ? <Text tone="danger" accessibilityRole="alert">{video.error.message}</Text> : null}
      <TextField
        label={videoCopy.noteLabel}
        helper={videoCopy.noteHelper}
        value={video.note ?? ''}
        onChangeText={(v) => describeMedia(video.id, v)}
        multiline
        maxLength={1000}
      />
      {video.status !== 'failed' ? (
        <Surface tone="alt" radius="paper" padded={space[3]} style={{ gap: space[2] }}>
          <Stamp kind="cloud" label={t('stamp.cloud')} size="sm" />
          <Text variant="bodySmall" tone="secondary">{locked ? workflowCopy.locked : workflowCopy.cloudNote}</Text>
          <View style={{ flexDirection: 'row' }}>
            <Button label={describing ? workflowCopy.describing : workflowCopy.describeWithAI} icon={Cloud} variant="outline" loading={describing} disabled={describing || locked} onPress={onDescribe} />
          </View>
        </Surface>
      ) : null}
      <WorkflowEditor attachmentId={video.id} />
    </View>
  );
}

function Player({ uri }: { uri: string }) {
  const { radius, colors } = useKalamTheme();
  const player = useVideoPlayer(uri, (p) => {
    p.muted = false;
  });
  return (
    <VideoView
      player={player}
      nativeControls
      contentFit="contain"
      accessibilityLabel={videoCopy.playerLabel}
      style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: radius.paper, backgroundColor: colors.surfaceAlt }}
    />
  );
}
