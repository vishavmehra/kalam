/** Unified list of everything attached to this creation session (docs/03 §6.4). */
import { X } from 'lucide-react-native';
import { Pressable, View } from 'react-native';
import { IconButton, Text, useKalamTheme, webData } from '@/design';
import { useCreationStore, type Modality } from '@/state/creation-store';
import { MODALITIES } from './ModalityNav';

interface Item { modality: Modality; title: string; detail: string; remove: () => void }

function useAttachmentItems(): Item[] {
  const s = useCreationStore();
  const items: Item[] = [];
  const text = s.text.trim();
  if (text) items.push({ modality: 'text', title: 'Description', detail: text.length > 70 ? `${text.slice(0, 70)}…` : text, remove: () => s.setText('') });
  if (s.photos.length) {
    items.push({
      modality: 'photo', title: s.photos.length === 1 ? '1 photo' : `${s.photos.length} photos`,
      detail: 'Resized, location removed', remove: () => s.photos.forEach((p) => s.removePhoto(p.id)),
    });
  }
  if (s.voice?.transcript.trim()) {
    const where = s.voice.recognizedBy === 'on_device' ? 'transcribed on this device' : s.voice.recognizedBy === 'cloud_service' ? 'transcribed online' : 'typed';
    items.push({ modality: 'voice', title: 'Voice note', detail: where, remove: () => s.setVoice(undefined) });
  }
  if (s.video?.frames.length) {
    items.push({
      modality: 'video', title: 'Video', detail: `${Math.round(s.video.durationSec)} s, ${s.video.frames.length} frames`,
      remove: () => s.setVideo(undefined),
    });
  }
  if (s.drawing) {
    items.push({ modality: 'draw', title: s.drawing.title, detail: `${s.drawing.summary.pageCount} screen sketch`, remove: s.detachDrawing });
  }
  return items;
}

export function AttachmentList({ emptyHint = true }: { emptyHint?: boolean }) {
  const { colors, space, radius } = useKalamTheme();
  const setModality = useCreationStore((s) => s.setModality);
  const items = useAttachmentItems();

  if (!items.length) {
    return emptyHint ? <Text variant="bodySmall" tone="muted">Nothing added yet. You can combine several inputs.</Text> : null;
  }
  return (
    <View accessibilityRole="list" style={{ gap: space[1] }}>
      {items.map((it) => {
        const Icon = MODALITIES.find((m) => m.id === it.modality)!.icon;
        return (
          <View key={it.modality} style={{ flexDirection: 'row', alignItems: 'center', gap: space[1] }}>
            <Pressable
              onPress={() => setModality(it.modality)}
              accessibilityRole="button"
              accessibilityLabel={`${it.title}, ${it.detail}. Open`}
              {...webData({ kPress: '', kHover: 'surface' })}
              style={{ flex: 1, flexDirection: 'row', gap: space[3], alignItems: 'center', paddingVertical: space[2], paddingHorizontal: space[2], borderRadius: radius.md }}
            >
              <View style={{ width: 32, height: 32, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
                <Icon size={16} color={colors.textSecondary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="bodySmall" weight="semibold" numberOfLines={1}>{it.title}</Text>
                <Text variant="caption" tone="muted" numberOfLines={1}>{it.detail}</Text>
              </View>
            </Pressable>
            <IconButton icon={X} label={`Remove ${it.title}`} onPress={it.remove} />
          </View>
        );
      })}
    </View>
  );
}
