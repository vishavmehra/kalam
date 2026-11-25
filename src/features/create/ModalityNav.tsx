/** Modality switcher (docs/03 §6.3): vertical rail on desktop, scrollable pill bar on phones. */
import { Camera, Mic, PenLine, Type, Video, type LucideIcon } from 'lucide-react-native';
import { Pressable, ScrollView, View } from 'react-native';
import { Text, useKalamTheme, webData } from '@/design';
import { useCreationStore, type Modality } from '@/state/creation-store';

export const MODALITIES: ReadonlyArray<{ id: Modality; label: string; icon: LucideIcon }> = [
  { id: 'text', label: 'Describe', icon: Type },
  { id: 'photo', label: 'Photo or sketch', icon: Camera },
  { id: 'voice', label: 'Voice', icon: Mic },
  { id: 'video', label: 'Video', icon: Video },
  { id: 'draw', label: 'Draw', icon: PenLine },
];

/** Which modalities already hold input (shown as a dot so switching never feels lossy). */
export function useFilledModalities(): Record<Modality, boolean> {
  const text = useCreationStore((s) => !!s.text.trim());
  const photo = useCreationStore((s) => s.photos.length > 0);
  const voice = useCreationStore((s) => !!s.voice?.transcript.trim());
  const video = useCreationStore((s) => !!s.video?.frames.length);
  const draw = useCreationStore((s) => !!s.drawing);
  return { text, photo, voice, video, draw };
}

export function ModalityNav({ layout }: { layout: 'rail' | 'bar' }) {
  const { colors, space, radius, touchTarget } = useKalamTheme();
  const value = useCreationStore((s) => s.modality);
  const setModality = useCreationStore((s) => s.setModality);
  const filled = useFilledModalities();

  const items = MODALITIES.map((m) => {
    const active = m.id === value;
    const Icon = m.icon;
    const fg = active ? colors.primary : colors.textSecondary;
    return (
      <Pressable
        key={m.id}
        role="radio"
        aria-checked={active}
        accessibilityState={{ checked: active }}
        accessibilityLabel={`${m.label}${filled[m.id] ? ', has input' : ''}`}
        onPress={() => setModality(m.id)}
        {...webData({ kPress: '', kHover: active ? 'none' : 'surface' })}
        style={layout === 'rail' ? {
          flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: touchTarget,
          paddingHorizontal: space[3], borderRadius: radius.md,
          backgroundColor: active ? colors.primarySoft : 'transparent',
        } : {
          flexDirection: 'row', alignItems: 'center', gap: space[2], minHeight: Math.max(44, touchTarget - 4),
          paddingHorizontal: space[4], borderRadius: radius.pill, borderWidth: 1,
          borderColor: active ? colors.primary : colors.border,
          backgroundColor: active ? colors.primarySoft : colors.surface,
        }}
      >
        <Icon size={18} color={fg} strokeWidth={active ? 2.4 : 2} />
        <Text weight={active ? 'semibold' : 'medium'} style={{ color: fg, flexShrink: 1 }} numberOfLines={1}>{m.label}</Text>
        {filled[m.id] ? (
          <View
            accessibilityElementsHidden
            importantForAccessibility="no"
            style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.accent, marginLeft: layout === 'rail' ? 'auto' : 0 }}
          />
        ) : null}
      </Pressable>
    );
  });

  if (layout === 'rail') {
    return <View role="radiogroup" aria-label="Input method" style={{ gap: space[1] }}>{items}</View>;
  }
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      role="radiogroup"
      aria-label="Input method"
      contentContainerStyle={{ gap: space[2], paddingVertical: space[1] }}
    >
      {items}
    </ScrollView>
  );
}
