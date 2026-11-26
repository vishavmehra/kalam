/**
 * Every attachment with its own status (docs/06 §5.2, docs/01 §6.3): a thumbnail, a stage word (never
 * a made-up percentage), and remove, replace, describe, rotate and zoom actions. A failed file shows
 * why and how to recover; the others stay usable.
 */
import { Check, Film, PenLine, RefreshCw, RotateCw, Trash2, ZoomIn } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Image, View } from 'react-native';
import { IconButton, Sheet, Stamp, Surface, Text, TextField, useKalamTheme } from '@/design';
import { attachmentCopy, STATUS_LABEL } from '@/core/media/copy';
import type { MediaAttachment } from '@/core/media/types';
import { attachmentName } from '@/core/session/handoff';
import { useCreationStore } from '@/state/creation-store';
import { useAudioFile } from './audio-intake';
import { useImageIntake } from './image-intake';
import { describeMedia, removeMedia } from './media-actions';
import { useMediaStore } from './media-store';
import { useVideoIntake } from './video-intake';
import { WaveStrip } from './WaveStrip';

const BUSY = new Set<MediaAttachment['status']>(['validating', 'processing_local', 'preparing_cloud']);

export function AttachmentStatusList() {
  const { space } = useKalamTheme();
  const session = useMediaStore((s) => s.session);
  const images = useImageIntake();
  const audio = useAudioFile();
  const video = useVideoIntake();
  const message = images.message ?? audio.message ?? video.message;
  if (!session?.attachments.length) return null;

  const replace = (a: MediaAttachment) => {
    if (a.type === 'image') void images.pick('library', { replaceId: a.id });
    else if (a.type === 'audio') void audio.add(a.id);
    else void video.add('library');
  };

  return (
    <View accessibilityRole="list" accessibilityLabel={attachmentCopy.listLabel} style={{ gap: space[2] }}>
      {session.attachments.map((a) => (
        <Row key={a.id} attachment={a} name={a.name ?? attachmentName(session, a)} onReplace={() => replace(a)} onRotate={() => void images.rotate(a.id)} />
      ))}
      {message ? <Text tone="secondary" accessibilityLiveRegion="polite">{message}</Text> : null}
    </View>
  );
}

function Row({ attachment: a, name, onReplace, onRotate }: { attachment: MediaAttachment; name: string; onReplace(): void; onRotate(): void }) {
  const { colors, space, radius, touchTarget } = useKalamTheme();
  const photo = useCreationStore((s) => (a.preparedImageId ? s.photos.find((p) => p.id === a.preparedImageId) : undefined));
  const firstFrame = useCreationStore((s) => (a.type === 'video' ? s.video?.frames[0] : undefined));
  const [describing, setDescribing] = useState(false);
  const [zoom, setZoom] = useState(false);
  const shown = photo ?? firstFrame;
  const size = Math.max(56, touchTarget);
  const busy = BUSY.has(a.status);

  return (
    // A paper slip per file: a failed one is ringed in danger and says so in words (a stamp), never by colour alone.
    <Surface bordered radius="paper" padded={space[2]} style={{ gap: space[2], ...(a.status === 'failed' ? { borderColor: colors.danger, borderWidth: 1.5 } : null) }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
        {shown ? (
          <Image
            source={{ uri: `data:${shown.mimeType};base64,${shown.base64}` }}
            accessibilityIgnoresInvertColors
            accessible={false}
            style={{ width: size, height: size, borderRadius: radius.paper, backgroundColor: colors.surfaceAlt }}
            resizeMode="cover"
          />
        ) : a.type === 'audio' ? (
          <WaveStrip size={size} />
        ) : (
          <View style={{ width: size, height: size, borderRadius: radius.paper, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
            <Film size={24} color={colors.textMuted} />
          </View>
        )}
        <View style={{ flex: 1, gap: 2 }}>
          <Text weight="semibold" numberOfLines={1}>{name}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }} accessibilityLiveRegion="polite">
            {busy ? <ActivityIndicator size="small" color={colors.primary} /> : null}
            <Stamp kind={a.status === 'failed' ? 'needs' : 'plain'} icon={a.status === 'ready' ? Check : a.status === 'failed' ? undefined : null} label={STATUS_LABEL[a.status]} size="sm" />
          </View>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {shown && a.type === 'image' ? <IconButton icon={ZoomIn} label={attachmentCopy.zoom(name)} onPress={() => setZoom(true)} /> : null}
          {a.type === 'image' && a.status === 'ready' ? <IconButton icon={RotateCw} label={attachmentCopy.rotate(name)} onPress={onRotate} /> : null}
          {a.type !== 'video' ? <IconButton icon={PenLine} label={attachmentCopy.describe(name)} selected={describing} onPress={() => setDescribing((d) => !d)} /> : null}
          <IconButton icon={RefreshCw} label={attachmentCopy.replace(name)} onPress={onReplace} disabled={busy} />
          <IconButton icon={Trash2} label={attachmentCopy.remove(name)} onPress={() => removeMedia(a.id)} />
        </View>
      </View>
      {a.error?.code === 'SPEECH_CONSENT_REQUIRED' ? <Text variant="bodySmall" tone="secondary">{a.error.message}</Text>
        : a.error ? <Text variant="bodySmall" tone="danger" accessibilityRole="alert">{a.error.message}</Text> : null}
      {describing ? (
        <TextField
          label={attachmentCopy.noteLabel}
          helper={attachmentCopy.noteHelper}
          value={a.note ?? ''}
          onChangeText={(t) => describeMedia(a.id, t)}
          multiline
          maxLength={1000}
        />
      ) : null}
      {zoom && shown ? (
        <Sheet visible title={name} onClose={() => setZoom(false)}>
          <Image
            source={{ uri: `data:${shown.mimeType};base64,${shown.base64}` }}
            accessibilityLabel={a.note ?? name}
            style={{ width: '100%', aspectRatio: shown.width / Math.max(1, shown.height), borderRadius: radius.paper }}
            resizeMode="contain"
          />
          {a.originalAssetId ? <Text variant="bodySmall" tone="secondary">{attachmentCopy.originalKept}</Text> : null}
        </Sheet>
      ) : null}
    </Surface>
  );
}
