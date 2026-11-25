/**
 * The input tray (docs/03 §6.4): every input in this creation, side by side, so it is obvious
 * that text, voice, video, photos and a drawing all go into ONE app. Each tile opens its input
 * method; each has its own remove button. Photos are removable one by one.
 */
import { Camera, Cloud, Film, Mic, PenLine, Type, X, type LucideIcon } from 'lucide-react-native';
import { type ReactNode, useMemo } from 'react';
import { Image, Pressable, ScrollView, View } from 'react-native';

import { Text, useBreakpoint, useKalamTheme, webData } from '@/design';
import { useCreationStore, type Modality } from '@/state/creation-store';
import { useSettingsStore } from '@/state/settings-store';

import { cloudAllowed, draftMayUseCloud } from './cloud-use';
import { inputSummary } from './input-summary';

const TILE_W = 128;
const TILE_H = 112;
const BARS = [0.35, 0.6, 0.9, 0.55, 0.8, 1, 0.65, 0.4, 0.75, 0.95, 0.5, 0.3, 0.6, 0.85, 0.45];

interface TileProps {
  modality: Modality;
  title: string;
  detail: string;
  icon: LucideIcon;
  onRemove: () => void;
  removeLabel: string;
  /** Set when this input will be sent to the cloud on build: the accessible explanation. */
  cloud?: string;
  children?: ReactNode;
}

function Tile({ modality, title, detail, icon: Icon, onRemove, removeLabel, cloud, children }: TileProps) {
  const { colors, radius, space } = useKalamTheme();
  const setModality = useCreationStore((s) => s.setModality);
  return (
    <View style={{ width: TILE_W, paddingTop: 8, paddingRight: 8 }}>
      <Pressable
        onPress={() => setModality(modality)}
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${detail}${cloud ? `. ${cloud}` : ''}. Open`}
        {...webData({ kPress: '', kHover: 'border' })}
        style={{
          height: TILE_H, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
          backgroundColor: colors.surface, overflow: 'hidden',
        }}
      >
        <View style={{ flex: 1, backgroundColor: colors.surfaceAlt }}>
          {children}
          {cloud ? (
            <View
              aria-hidden
              style={{
                position: 'absolute', right: 6, bottom: 6, width: 22, height: 22, borderRadius: 11,
                alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
              }}
            >
              <Cloud size={12} color={colors.sourceCloud} strokeWidth={2.4} />
            </View>
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space[2], paddingVertical: 6 }}>
          <Icon size={13} color={colors.textSecondary} strokeWidth={2.2} />
          <Text variant="caption" weight="semibold" numberOfLines={1} style={{ flex: 1 }}>{title}</Text>
        </View>
      </Pressable>
      <Text variant="caption" tone="muted" numberOfLines={1} style={{ marginTop: 4 }}>{detail}</Text>
      <Pressable
        onPress={onRemove}
        accessibilityRole="button"
        accessibilityLabel={removeLabel}
        {...webData({ kPress: '' })}
        style={{ position: 'absolute', top: -6, right: -6, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
      >
        <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: colors.text, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.background }}>
          <X size={14} color={colors.background} strokeWidth={2.6} />
        </View>
      </Pressable>
    </View>
  );
}

function Thumb({ uri, label }: { uri: string; label: string }) {
  return <Image source={{ uri }} accessibilityLabel={label} resizeMode="cover" style={{ width: '100%', height: '100%' }} />;
}

/** Ruled-paper preview of the typed description. */
function TextPreview({ text }: { text: string }) {
  const { colors } = useKalamTheme();
  return (
    <View style={{ flex: 1, paddingHorizontal: 10, paddingTop: 8, backgroundColor: colors.paper }}>
      {[22, 40, 58].map((top) => (
        <View key={top} style={{ position: 'absolute', left: 0, right: 0, top, height: 1, backgroundColor: colors.ruleLine }} />
      ))}
      <View style={{ position: 'absolute', top: 0, bottom: 0, left: 6, width: 1, backgroundColor: colors.marginLine }} />
      <Text variant="caption" numberOfLines={3} style={{ lineHeight: 18 }}>{text}</Text>
    </View>
  );
}

function Waveform() {
  const { colors } = useKalamTheme();
  return (
    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, backgroundColor: colors.primary }}>
      {BARS.map((h, i) => (
        <View key={i} style={{ width: 3, height: 40 * h, borderRadius: 2, backgroundColor: colors.accent }} />
      ))}
    </View>
  );
}

function IconFill({ icon: Icon }: { icon: LucideIcon }) {
  const { colors } = useKalamTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Icon size={28} color={colors.textMuted} strokeWidth={1.6} />
    </View>
  );
}

export function InputTray() {
  const { space } = useKalamTheme();
  const { isPhone } = useBreakpoint();
  const s = useCreationStore();
  const settings = useSettingsStore((st) => st.settings);
  const summary = inputSummary(s);
  // The classifier is cheap but runs on keystrokes; recompute only when an input changes.
  const { text: dText, photos, voice, video, drawing, preferences } = s;
  const willSend = useMemo(
    () => cloudAllowed(settings) && draftMayUseCloud({
      text: dText, photos, preferences, ...(voice ? { voice } : {}), ...(video ? { video } : {}), ...(drawing ? { drawing } : {}),
    }),
    [settings, dText, photos, voice, video, drawing, preferences],
  );
  const SENT = willSend ? 'Sent to Gemini in the cloud when you build' : undefined;
  const tiles: ReactNode[] = [];

  const text = s.text.trim();
  if (text) {
    tiles.push(
      <Tile key="text" modality="text" title="Description" detail={`${text.length} characters`} icon={Type} onRemove={() => s.setText('')} removeLabel="Remove the description" cloud={SENT}>
        <TextPreview text={text} />
      </Tile>,
    );
  }
  if (s.voice?.transcript.trim()) {
    const where = s.voice.recognizedBy === 'on_device' ? 'Heard on this device' : s.voice.recognizedBy === 'cloud_service' ? 'Heard online' : 'Typed in';
    const secs = s.voice.durationSec ? `${Math.round(s.voice.durationSec)} s. ` : '';
    tiles.push(
      <Tile key="voice" modality="voice" title="Voice note" detail={`${secs}${where}`} icon={Mic} onRemove={() => s.setVoice(undefined)} removeLabel="Remove the voice note" cloud={willSend ? 'Only the words go to the cloud, never the recording' : undefined}>
        <Waveform />
      </Tile>,
    );
  }
  s.photos.forEach((p, i) => {
    tiles.push(
      <Tile key={p.id} modality="photo" title={`Photo ${i + 1}`} detail={`${p.width} × ${p.height}`} icon={Camera} onRemove={() => s.removePhoto(p.id)} removeLabel={`Remove photo ${i + 1}`} cloud={SENT}>
        <Thumb uri={`data:${p.mimeType};base64,${p.base64}`} label={`Photo ${i + 1}`} />
      </Tile>,
    );
  });
  if (s.video?.frames.length) {
    const f = s.video.frames[0];
    tiles.push(
      <Tile key="video" modality="video" title="Video" detail={`${Math.round(s.video.durationSec)} s, ${s.video.frames.length} frames`} icon={Film} onRemove={() => s.setVideo(undefined)} removeLabel="Remove the video" cloud={SENT}>
        {f ? <Thumb uri={`data:${f.mimeType};base64,${f.base64}`} label="First frame of the video" /> : <IconFill icon={Film} />}
      </Tile>,
    );
  }
  if (s.drawing) {
    const img = s.drawing.summary.images[0];
    const pages = s.drawing.summary.pageCount;
    tiles.push(
      <Tile key="drawing" modality="draw" title="Drawing" detail={pages === 1 ? '1 screen' : `${pages} screens`} icon={PenLine} onRemove={s.detachDrawing} removeLabel="Remove the drawing" cloud={SENT}>
        {img ? <Thumb uri={`data:${img.mimeType};base64,${img.base64}`} label="Your drawing" /> : <IconFill icon={PenLine} />}
      </Tile>,
    );
  }

  const heading = (
    <View style={{ gap: 2 }}>
      <Text weight="semibold" accessibilityRole="header">In this app</Text>
      <Text variant="bodySmall" tone="muted">
        {tiles.length === 0
          ? 'Nothing added yet. Mix any of these: words, a voice note, photos, a video, a drawing.'
          : tiles.length === 1
            ? 'Add more if you like. Kalam reads everything here together.'
            : `${summary}. Kalam reads them together to build one app.`}
        {willSend ? ' Items with a cloud mark go to Gemini through Firebase when you build.' : ''}
      </Text>
    </View>
  );

  if (!tiles.length) return heading;
  return (
    <View style={{ gap: space[2] }}>
      {heading}
      {isPhone ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space[2], paddingRight: space[4] }} accessibilityRole="list">
          {tiles}
        </ScrollView>
      ) : (
        <View accessibilityRole="list" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>{tiles}</View>
      )}
    </View>
  );
}
