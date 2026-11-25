import { Check, Cloud, CloudOff, type LucideIcon, Smartphone, Workflow } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { Text } from './Text';
import { useKalamTheme } from './theme';
import type { KalamColors } from './tokens';
import { webData } from './web';

export type ChipTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

export interface ChipProps {
  label: string;
  icon?: LucideIcon;
  /** Static chips: semantic colour of a REAL state (docs/02 §10.5). */
  tone?: ChipTone;
  /** Makes the chip a toggle (role checkbox/radio). Selected shows a check, not colour alone. */
  onPress?: () => void;
  selected?: boolean;
  /** For selectable chips: `radio` inside single-choice groups. Default `checkbox`. */
  role?: 'checkbox' | 'radio';
  accessibilityLabel?: string;
  testID?: string;
  /** BCP 47 language of the label, e.g. 'hi' for हिन्दी, so screen readers pronounce it (docs/10 §11). */
  lang?: string;
}

const TONES: Record<ChipTone, [keyof KalamColors, keyof KalamColors]> = {
  neutral: ['surfaceAlt', 'textSecondary'],
  primary: ['primarySoft', 'primary'],
  success: ['successSoft', 'success'],
  warning: ['warningSoft', 'warning'],
  danger: ['dangerSoft', 'danger'],
  info: ['infoSoft', 'info'],
  accent: ['accentSoft', 'text'],
};

/** Status chip, or a selectable filter/choice chip when `onPress` is given. */
export function Chip({ label, icon, tone = 'neutral', onPress, selected, role = 'checkbox', accessibilityLabel, testID, lang }: ChipProps) {
  const theme = useKalamTheme();
  const c = theme.colors;
  const interactive = !!onPress;
  const [bgKey, fgKey] = TONES[selected ? 'primary' : tone];
  const fg = c[fgKey];
  const Icon = interactive && selected ? Check : icon;
  const body = (
    <>
      {Icon ? <Icon size={14} color={fg} strokeWidth={2.25} /> : null}
      <Text variant="bodySmall" weight="medium" style={{ color: fg }} numberOfLines={1} {...(lang ? ({ lang } as object) : {})}>{label}</Text>
    </>
  );
  const base = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingHorizontal: 12,
    borderRadius: theme.radius.pill,
    backgroundColor: interactive && !selected ? 'transparent' : c[bgKey],
    borderWidth: 1,
    borderColor: interactive ? (selected ? c.primary : c.borderStrong) : 'transparent',
  };
  if (!interactive) {
    return (
      <View accessibilityLabel={accessibilityLabel} testID={testID} style={[base, { minHeight: 28, alignSelf: 'flex-start' }]}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      role={role}
      aria-checked={!!selected}
      accessibilityState={{ checked: !!selected }}
      accessibilityLabel={accessibilityLabel ?? label}
      testID={testID}
      {...webData({ kPress: '', kHover: selected ? 'none' : 'surface' })}
      style={[base, { minHeight: theme.touchTarget, paddingHorizontal: 14 }]}
      hitSlop={4}
    >
      {body}
    </Pressable>
  );
}

export type ExecutionSource = 'deterministic' | 'on_device' | 'cloud' | 'offline';

const SOURCE: Record<ExecutionSource, { label: string; icon: LucideIcon; color: keyof KalamColors; soft: keyof KalamColors; explain: string }> = {
  on_device: { label: 'On-device', icon: Smartphone, color: 'sourceOnDevice', soft: 'successSoft', explain: 'Handled on this device. Nothing was sent online.' },
  cloud: { label: 'Cloud', icon: Cloud, color: 'sourceCloud', soft: 'infoSoft', explain: 'Processed online by Gemini through Firebase.' },
  deterministic: { label: 'Deterministic', icon: Workflow, color: 'sourceDeterministic', soft: 'surfaceAlt', explain: 'Ordinary app logic. No AI model was used.' },
  offline: { label: 'Offline', icon: CloudOff, color: 'sourceOffline', soft: 'warningSoft', explain: 'Offline. Online AI is unavailable; your apps and data still work.' },
};

export interface SourceBadgeProps {
  source: ExecutionSource;
  /** Override the visible text (e.g. "Offline — AI unavailable"). */
  label?: string;
  size?: 'sm' | 'md';
  /** Hide the text visually but keep it for screen readers (dense tables only). */
  compact?: boolean;
}

/** Where an AI operation ran (docs/07 §13.6). Icon + text — never colour alone. */
export function SourceBadge({ source, label, size = 'sm', compact }: SourceBadgeProps) {
  const theme = useKalamTheme();
  const s = SOURCE[source];
  const fg = theme.colors[s.color];
  const text = label ?? s.label;
  return (
    <View
      accessible={compact}
      role={compact ? 'img' : undefined}
      accessibilityLabel={compact ? text : undefined}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start',
        paddingHorizontal: compact ? 6 : size === 'md' ? 10 : 8,
        minHeight: size === 'md' ? 28 : 24,
        borderRadius: theme.radius.sm,
        backgroundColor: theme.colors[s.soft],
      }}
    >
      <s.icon size={size === 'md' ? 15 : 13} color={fg} strokeWidth={2.25} />
      {compact ? null : (
        <Text variant={size === 'md' ? 'bodySmall' : 'caption'} weight="semibold" style={{ color: fg }} numberOfLines={1}>
          {text}
        </Text>
      )}
    </View>
  );
}

/** Plain-language explanation for a source (docs/07 §19.2). */
export function explainSource(source: ExecutionSource): string {
  return SOURCE[source].explain;
}
