/**
 * The five ways in (docs/03 §6.3, DIRECTION §6): Type, Photo or sketch, Voice, Video, Draw. A row of method
 * tabs; the selected one is solid ink. Scrolls sideways on phones. A haldi dot marks a way that already
 * holds input, so switching never feels lossy. On the web it is one tab stop; arrows move between the tabs
 * and open them (docs/02 §10.7).
 */
import { Camera, Mic, PenTool, Type, Video, type LucideIcon } from 'lucide-react-native';
import { Pressable, ScrollView, View } from 'react-native';

import { Text, useBreakpoint, useKalamTheme, webData } from '@/design';
import { useRovingFocus } from '@/design/inputs';
import type { TranslationKey } from '@/i18n/keys';
import { useT } from '@/i18n/react';
import { useCreationStore, type Modality } from '@/state/creation-store';

export const MODALITIES: ReadonlyArray<{ id: Modality; label: TranslationKey; icon: LucideIcon }> = [
  { id: 'text', label: 'create.ws.typeTab', icon: Type },
  { id: 'photo', label: 'create.modality.photo', icon: Camera },
  { id: 'voice', label: 'create.modality.voice', icon: Mic },
  { id: 'video', label: 'create.modality.video', icon: Video },
  { id: 'draw', label: 'create.modality.draw', icon: PenTool },
];

/** Which modalities already hold input. */
export function useFilledModalities(): Record<Modality, boolean> {
  const text = useCreationStore((s) => !!s.text.trim());
  const photo = useCreationStore((s) => s.photos.length > 0);
  const voice = useCreationStore((s) => !!s.voice?.transcript.trim());
  const video = useCreationStore((s) => !!s.video?.frames.length);
  const draw = useCreationStore((s) => !!s.drawing);
  return { text, photo, voice, video, draw };
}

export function ModalityNav() {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const { colors, radius, touchTarget, fontScale } = theme;
  const { isPhone } = useBreakpoint();
  const value = useCreationStore((s) => s.modality);
  const setModality = useCreationStore((s) => s.setModality);
  const filled = useFilledModalities();
  const roving = useRovingFocus({
    count: MODALITIES.length, orientation: 'horizontal', current: Math.max(0, MODALITIES.findIndex((m) => m.id === value)),
    onMove: (i) => { const m = MODALITIES[i]; if (m) setModality(m.id); },
  });

  const items = MODALITIES.map((m, i) => {
    const active = m.id === value;
    const fg = active ? colors.background : colors.textSecondary;
    const label = t(m.label);
    return (
      <Pressable
        key={m.id}
        role="tab"
        aria-selected={active}
        accessibilityState={{ selected: active }}
        accessibilityLabel={filled[m.id] ? t('create.ws.hasInput', { label }) : label}
        onPress={() => setModality(m.id)}
        {...roving.itemProps(i)}
        {...webData({ kPress: '', kHover: active ? 'none' : 'border' })}
        style={{
          flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: touchTarget, paddingLeft: 13, paddingRight: 16,
          borderRadius: radius.press, backgroundColor: active ? colors.text : 'transparent',
          borderWidth: active ? 0 : 1.25, borderColor: colors.border,
        }}
      >
        <m.icon size={18} color={fg} strokeWidth={active ? 2.3 : 2} />
        <Text weight="semibold" numberOfLines={1} style={{ color: fg, fontSize: Math.round(15.5 * fontScale) }}>{label}</Text>
        {filled[m.id] ? (
          <View aria-hidden style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.accent, borderWidth: active ? 0 : 1, borderColor: colors.accentInk }} />
        ) : null}
      </Pressable>
    );
  });

  return isPhone ? (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} role="tablist" aria-label={t('create.modality.label')} contentContainerStyle={{ gap: 8, paddingRight: 16 }}>
      {items}
    </ScrollView>
  ) : (
    <View role="tablist" aria-label={t('create.modality.label')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{items}</View>
  );
}
