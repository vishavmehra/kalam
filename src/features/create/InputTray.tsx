/**
 * The input tray (docs/03 §6.4, DIRECTION §6 "the tray"): every input in this creation as the material it
 * is, side by side, so it is obvious that text, voice, video, photos and a drawing all go into ONE app.
 * A note slip for typed words, a haldi strip with the waveform for voice, a print for each photo, a film
 * strip for video and a sheet for the drawing. Each tile opens its input method and has its own remove
 * key (with Undo) and a cloud or device mark. Under it, one honest sentence about what goes to the cloud.
 */
import { Camera, Cloud, Film, Mic, PenLine, Plus, Smartphone, Type, X, type LucideIcon } from 'lucide-react-native';
import { type ReactNode, useMemo } from 'react';
import { Image, Pressable, ScrollView, View } from 'react-native';

import { Text, useBreakpoint, useKalamTheme, useToast, webData } from '@/design';
import { removePhotoEverywhere, removeVideoEverywhere } from '@/features/media';
import { OBJECT_COLORS } from '@/features/media/objects';
import { useFormat, useT } from '@/i18n/react';
import { useCreationStore, type Modality } from '@/state/creation-store';
import { useSettingsStore } from '@/state/settings-store';

import { cloudAllowed, draftMayUseCloud } from './cloud-use';
import { inputPartsT, sentenceCase } from './input-summary';
import { removeVoiceNote } from './voice-note';

const OBJ = OBJECT_COLORS;
const BARS = [0.35, 0.6, 0.9, 0.55, 0.8, 1, 0.65, 0.4, 0.75, 0.95, 0.5, 0.3, 0.6, 0.85, 0.45, 0.7, 0.5];

export type Mark = 'cloud' | 'device';

export interface TrayItem {
  key: string;
  modality: Modality;
  title: string;
  detail: string;
  icon: LucideIcon;
  art: ReactNode;
  mark: Mark;
  markLabel: string;
  remove: () => void;
  removeLabel: string;
}

/** Ruled note slip holding the first words of the description. No margin rule (owner override 1). */
function NoteSlip({ text }: { text: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: OBJ.paper, paddingHorizontal: 8, paddingTop: 5, overflow: 'hidden' }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <View key={i} style={{ position: 'absolute', left: 0, right: 0, top: 22 + i * 18, height: 1, backgroundColor: OBJ.ruling }} />
      ))}
      <Text numberOfLines={4} style={{ fontSize: 11.5, lineHeight: 18, color: OBJ.ballpoint }}>{text}</Text>
    </View>
  );
}

function VoiceStrip() {
  return (
    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, backgroundColor: OBJ.haldi }}>
      {BARS.map((h, i) => <View key={i} style={{ width: 3, height: Math.round(48 * h), borderRadius: 1.5, backgroundColor: OBJ.bars }} />)}
    </View>
  );
}

/** A photo print with a paper border, set down slightly crooked. */
function PhotoPrint({ uri, label }: { uri: string; label: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: OBJ.print, paddingTop: 7, paddingHorizontal: 7, paddingBottom: 16 }}>
      <Image source={{ uri }} accessibilityLabel={label} resizeMode="cover" style={{ flex: 1, borderRadius: 2, transform: [{ rotate: '-2deg' }] }} />
    </View>
  );
}

/** Film stock: sprocket holes above and below up to three frames from the clip. */
function FilmStrip({ uris }: { uris: string[] }) {
  const holes = (
    <View style={{ height: 12, flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', paddingHorizontal: 4 }}>
      {Array.from({ length: 9 }, (_, i) => <View key={i} style={{ width: 7, height: 5, borderRadius: 1.5, backgroundColor: OBJ.sprocket }} />)}
    </View>
  );
  return (
    <View aria-hidden style={{ flex: 1, backgroundColor: OBJ.film }}>
      {holes}
      <View style={{ flex: 1, flexDirection: 'row', gap: 3, paddingHorizontal: 3 }}>
        {uris.length ? uris.slice(0, 3).map((u, i) => <Image key={i} aria-hidden source={{ uri: u }} resizeMode="cover" style={{ flex: 1, borderRadius: 1 }} />)
          : <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><Film size={24} color={OBJ.sprocket} /></View>}
      </View>
      {holes}
    </View>
  );
}

/** A drawing on its sheet. */
function DrawingSheet({ uri, label }: { uri?: string; label: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: OBJ.paper, padding: 6 }}>
      {uri ? <Image source={{ uri }} accessibilityLabel={label} resizeMode="contain" style={{ flex: 1 }} />
        : <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><PenLine size={24} color={OBJ.ballpoint} /></View>}
    </View>
  );
}

/** Everything in this creation as tray items, plus whether a build will send them to the cloud. */
export function useTrayItems(): { items: TrayItem[]; willSend: boolean; hasVoice: boolean } {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const s = useCreationStore();
  const settings = useSettingsStore((st) => st.settings);
  const toast = useToast();
  /** Every remove says so and offers Undo, like Clear in the composer. */
  const removed = (message: string, undo?: () => void) =>
    toast.show({ message, ...(undo ? { action: { label: t('common.undo'), onPress: undo } } : {}) });
  // The classifier is cheap but runs on keystrokes; recompute only when an input changes.
  const { text: dText, photos, voice, video, drawing, preferences } = s;
  const willSend = useMemo(
    () => cloudAllowed(settings) && draftMayUseCloud({
      text: dText, photos, preferences, ...(voice ? { voice } : {}), ...(video ? { video } : {}), ...(drawing ? { drawing } : {}),
    }),
    [settings, dText, photos, voice, video, drawing, preferences],
  );
  const mark: Mark = willSend ? 'cloud' : 'device';
  const markLabel = t(willSend ? 'create.tray.cloudMark' : 'create.tray.deviceMark');
  const items: TrayItem[] = [];

  const text = dText.trim();
  if (text) {
    items.push({
      key: 'text', modality: 'text', icon: Type, title: t('create.tray.description'), detail: t('create.tray.chars', { count: text.length }),
      art: <NoteSlip text={text} />, mark, markLabel, removeLabel: t('create.tray.removeText'),
      remove: () => { s.setText(''); removed(t('create.compose.cleared'), () => s.setText(dText)); },
    });
  }
  if (voice?.transcript.trim()) {
    const where = t(voice.recognizedBy === 'on_device' ? 'create.tray.heardDevice' : voice.recognizedBy === 'cloud_service' ? 'create.tray.heardOnline' : 'create.tray.typedIn');
    items.push({
      key: 'voice', modality: 'voice', icon: Mic, title: t('create.tray.voice'),
      detail: voice.durationSec ? t('create.tray.voiceDetail', { seconds: Math.round(voice.durationSec), where }) : where,
      art: <VoiceStrip />, mark, markLabel: willSend ? t('create.tray.voiceCloudMark') : markLabel,
      removeLabel: t('create.tray.removeVoice'),
      // A kept recording is deleted at once, so Undo is offered only for words without one.
      remove: () => {
        removeVoiceNote(voice, s.setVoice);
        removed(t('create.tray.removed', { item: t('create.tray.voice') }), voice.audioUri ? undefined : () => s.setVoice(voice));
      },
    });
  }
  photos.forEach((p, i) => {
    const title = t('create.tray.photo', { n: i + 1 });
    items.push({
      key: p.id, modality: 'photo', icon: Camera, title, detail: `${p.width} × ${p.height}`,
      art: <PhotoPrint uri={`data:${p.mimeType};base64,${p.base64}`} label={title} />, mark, markLabel,
      removeLabel: t('create.tray.removePhoto', { n: i + 1 }),
      remove: () => { removePhotoEverywhere(p.id); removed(t('create.tray.removed', { item: title }), () => s.addPhotos([p])); },
    });
  });
  if (video?.frames.length) {
    items.push({
      key: 'video', modality: 'video', icon: Film, title: t('create.tray.video'),
      detail: t('create.tray.videoDetail', { seconds: Math.round(video.durationSec), count: video.frames.length }),
      art: <FilmStrip uris={video.frames.map((f) => `data:${f.mimeType};base64,${f.base64}`)} />, mark, markLabel,
      removeLabel: t('create.tray.removeVideo'),
      remove: () => { removeVideoEverywhere(); removed(t('create.tray.removed', { item: t('create.tray.video') }), () => s.setVideo(video)); },
    });
  }
  if (drawing) {
    const img = drawing.summary.images[0];
    items.push({
      key: 'drawing', modality: 'draw', icon: PenLine, title: t('create.tray.drawing'),
      detail: t('create.tray.screens', { count: drawing.summary.pageCount }),
      art: <DrawingSheet uri={img ? `data:${img.mimeType};base64,${img.base64}` : undefined} label={t('create.tray.drawing')} />, mark, markLabel,
      removeLabel: t('create.tray.removeDrawing'),
      remove: () => { s.detachDrawing(); removed(t('create.tray.removed', { item: t('create.tray.drawing') }), () => s.attachDrawing(drawing)); },
    });
  }
  return { items, willSend, hasVoice: !!voice?.transcript.trim() };
}

/** One material tile. `readOnly` (build progress) drops the open and remove keys. */
export function MaterialTile({ item, readOnly, compact }: { item: TrayItem; readOnly?: boolean; compact?: boolean }) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const { colors, radius } = theme;
  const setModality = useCreationStore((s) => s.setModality);
  const w = compact ? 124 : 148;
  const h = compact ? 94 : 108;
  const MarkIcon = item.mark === 'cloud' ? Cloud : Smartphone;
  const markInk = item.mark === 'cloud' ? OBJ.cloudInk : OBJ.deviceInk;
  const object = (
    <View style={{ height: h, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.surfaceAlt, ...theme.elevation[1] }}>
      {item.art}
      <View
        aria-hidden
        style={{
          position: 'absolute', right: 7, bottom: 7, width: 24, height: 24, borderRadius: radius.stamp,
          alignItems: 'center', justifyContent: 'center', backgroundColor: OBJ.markBg, borderWidth: 1.25, borderColor: markInk,
        }}
      >
        <MarkIcon size={14} color={markInk} strokeWidth={2.4} />
      </View>
    </View>
  );
  const caption = (
    <View style={{ marginTop: 8, gap: 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <item.icon size={15} color={colors.textMuted} strokeWidth={2} />
        <Text variant="bodySmall" weight="semibold" numberOfLines={1} style={{ flex: 1 }}>{item.title}</Text>
      </View>
      <Text variant="caption" tone="muted" numberOfLines={2}>{item.detail}</Text>
    </View>
  );
  const name = `${item.title}, ${item.detail}. ${item.markLabel}.`;
  if (readOnly) {
    return <View role="listitem" accessible accessibilityLabel={name} style={{ width: w }}>{object}{caption}</View>;
  }
  return (
    <View role="listitem" style={{ width: w }}>
      <Pressable
        onPress={() => setModality(item.modality)}
        accessibilityRole="button"
        accessibilityLabel={`${name} ${t('create.tray.open')}`}
        {...webData({ kPress: '', kHover: 'border' })}
        style={{ borderRadius: radius.lg }}
      >
        {object}
        {caption}
      </Pressable>
      <Pressable
        onPress={item.remove}
        accessibilityRole="button"
        accessibilityLabel={item.removeLabel}
        {...webData({ kPress: '' })}
        style={{ position: 'absolute', top: -18, right: -18, width: theme.touchTarget, height: theme.touchTarget, alignItems: 'center', justifyContent: 'center' }}
      >
        <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: colors.text, alignItems: 'center', justifyContent: 'center', borderWidth: 2.5, borderColor: colors.surface }}>
          <X size={14} color={colors.surface} strokeWidth={2.6} />
        </View>
      </Pressable>
    </View>
  );
}

const ORDER: Modality[] = ['text', 'photo', 'voice', 'video', 'draw'];

export function InputTray() {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const format = useFormat(theme.uiLanguage);
  const { colors, space, radius } = theme;
  const { isPhone } = useBreakpoint();
  const s = useCreationStore();
  const { items, willSend, hasVoice } = useTrayItems();
  const summary = sentenceCase(format.list(inputPartsT(s, t)));
  // "Add more" opens the first way in that holds nothing yet.
  const used = new Set(items.map((i) => i.modality));
  const next = ORDER.find((m) => !used.has(m) && m !== s.modality) ?? 'photo';

  const heading = (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space[3], flexWrap: 'wrap' }}>
      <Text weight="semibold" accessibilityRole="header" style={{ fontSize: Math.round(17 * theme.fontScale) }}>{t('create.tray.title')}</Text>
      <Text variant="bodySmall" tone="muted" style={{ flexShrink: 1 }}>
        {items.length === 0 ? t('create.tray.empty') : items.length === 1 ? t('create.tray.single') : t('create.tray.several', { summary })}
      </Text>
    </View>
  );
  if (!items.length) return heading;

  const addMore = (
    <View role="listitem" style={{ width: isPhone ? 124 : 148 }}>
      <Pressable
        onPress={() => s.setModality(next)}
        accessibilityRole="button"
        accessibilityLabel={t('create.tray.addMoreLabel')}
        {...webData({ kPress: '', kHover: 'border' })}
        style={{
          height: isPhone ? 94 : 108, borderRadius: radius.lg, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.borderStrong,
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Plus size={26} color={colors.textMuted} />
      </Pressable>
      <Text variant="bodySmall" weight="semibold" tone="muted" style={{ marginTop: 8 }}>{t('create.tray.addMore')}</Text>
    </View>
  );
  const tiles = [...items.map((it) => <MaterialTile key={it.key} item={it} compact={isPhone} />), <View key="add">{addMore}</View>];
  const HonestIcon = willSend ? Cloud : Smartphone;
  return (
    <View style={{ gap: space[4] }}>
      {heading}
      {isPhone ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          role="list"
          contentContainerStyle={{ gap: 14, paddingTop: 12, paddingRight: space[4], paddingLeft: 2 }}
        >
          {tiles}
        </ScrollView>
      ) : (
        <View role="list" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14, paddingTop: 10 }}>{tiles}</View>
      )}
      <View
        style={{
          flexDirection: 'row', gap: 10, alignItems: 'flex-start', padding: space[4], borderRadius: radius.press, maxWidth: 640,
          backgroundColor: willSend ? colors.infoSoft : colors.successSoft,
        }}
      >
        <HonestIcon size={19} color={willSend ? colors.info : colors.success} style={{ marginTop: 2 }} />
        <Text variant="bodySmall" style={{ flex: 1 }}>
          {willSend ? `${t('create.tray.honestCloud')}${hasVoice ? ` ${t('create.tray.honestVoice')}` : ''}` : t('create.tray.honestDevice')}
        </Text>
      </View>
    </View>
  );
}
