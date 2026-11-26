import { Check, type LucideIcon } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { t } from '@/i18n/active';
import { useT } from '@/i18n/react';

import { type ExecutionSource, SOURCE_EXPLAIN, SOURCE_STAMP } from './marks';
import { OfflineIcon, Stamp } from './Stamp';
import { Text } from './Text';
import { useKalamTheme } from './theme';
import type { KalamColors } from './tokens';
import { webData } from './web';

export type ChipTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

export interface ChipProps {
  label: string;
  icon?: LucideIcon;
  /** Static chips: semantic colour of a REAL state. */
  tone?: ChipTone;
  /** Makes the chip a toggle (role checkbox/radio). Selected shows a check, not colour alone. */
  onPress?: () => void;
  selected?: boolean;
  /** For selectable chips: `radio` inside single-choice groups. Default `checkbox`. */
  role?: 'checkbox' | 'radio';
  accessibilityLabel?: string;
  testID?: string;
  /** BCP 47 language of the label, e.g. 'hi' for हिन्दी, so screen readers pronounce it and the display face sets it. */
  lang?: string;
  /** Roving focus for a chip group on the web: spread `useRovingFocus(...).itemProps(i)` here. */
  rovingProps?: object;
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

/**
 * Status chip, or a selectable choice chip when `onPress` is given (DIRECTION §7): 40 px tall with a 48 px
 * target (64 in Large mode), 10 px corners, sheet fill with a hairline ring. Selected is a royal wash, royal
 * text, a 1.75 px royal ring and a check. Labels in an Indian script use the display face.
 */
export function Chip({ label, icon, tone = 'neutral', onPress, selected, role = 'checkbox', accessibilityLabel, testID, lang, rovingProps }: ChipProps) {
  const theme = useKalamTheme();
  const c = theme.colors;
  const interactive = !!onPress;
  const indic = !!lang && lang !== 'en' && !lang.startsWith('en-');
  if (!interactive) {
    const [bgKey, fgKey] = TONES[tone];
    return (
      <View
        accessibilityLabel={accessibilityLabel}
        testID={testID}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 28, paddingHorizontal: 10, borderRadius: theme.radius.sm, alignSelf: 'flex-start', backgroundColor: c[bgKey] }}
      >
        {icon ? (() => { const I = icon; return <I size={14} color={c[fgKey]} strokeWidth={2.25} />; })() : null}
        <Text variant="bodySmall" weight="medium" style={{ color: c[fgKey] }} numberOfLines={1} {...(lang ? ({ lang } as object) : {})}>{label}</Text>
      </View>
    );
  }
  const fg = selected ? c.primary : c.textSecondary;
  const Icon = selected ? Check : icon;
  const visual = Math.max(40, theme.touchTarget - 8);
  return (
    <Pressable
      onPress={onPress}
      role={role}
      aria-checked={!!selected}
      accessibilityState={{ checked: !!selected }}
      accessibilityLabel={accessibilityLabel ?? label}
      testID={testID}
      {...rovingProps}
      {...webData({ kPress: 'scale', kHover: selected ? 'none' : 'border' })}
      hitSlop={4}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 6,
        minHeight: visual, paddingHorizontal: 14,
        borderRadius: 10,
        backgroundColor: selected ? c.primarySoft : c.surface,
        borderWidth: selected ? 1.75 : 1.25,
        borderColor: selected ? c.primary : theme.accessModes.highContrast ? c.borderStrong : c.border,
      }}
    >
      {Icon ? <Icon size={15} color={fg} strokeWidth={2.25} /> : null}
      <Text
        variant="body"
        weight={selected ? 'semibold' : 'medium'}
        display={indic}
        style={{ color: selected ? c.primary : c.textSecondary, ...(indic ? { fontSize: Math.round(17 * theme.fontScale) } : null) }}
        numberOfLines={1}
        {...(lang ? ({ lang } as object) : {})}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export type { ExecutionSource };

export interface SourceBadgeProps {
  source: ExecutionSource;
  /** Override the visible text (e.g. "Offline. AI unavailable"). */
  label?: string;
  size?: 'sm' | 'md';
  /** Hide the text visually but keep it for screen readers (dense tables only). */
  compact?: boolean;
}

/**
 * Where an AI operation ran, as a stamp: On device (leaf), Cloud (sky), Template (graphite), Offline
 * (graphite with wifi-off, never a warning). Icon and words, never colour alone. Same API as before the
 * "Khata and Kalam" direction, so Create, Review, Edit and Activity keep working.
 */
export function SourceBadge({ source, label, size = 'sm', compact }: SourceBadgeProps) {
  const theme = useKalamTheme();
  const tr = useT(theme.uiLanguage);
  const s = SOURCE_STAMP[source];
  const text = label ?? tr(s.label);
  return <Stamp kind={s.kind} label={text} size={compact ? 'sm' : size} iconOnly={compact} icon={source === 'offline' ? OfflineIcon : undefined} />;
}

/** Plain-language explanation for a source, in the active language. */
export function explainSource(source: ExecutionSource): string {
  return t(SOURCE_EXPLAIN[source]);
}
