/**
 * Optional creation preferences (DIRECTION §6, Create workspace right panel): the app's language, its money
 * and its cover, shown as the six cloth swatches the app will wear on the shelf. Then the honest route
 * forecast: which engine will most likely build this, and what that means.
 */
import { useMemo, type ReactNode } from 'react';
import { Image, type ImageSourcePropType, Pressable, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';

import { LANGUAGES } from '@/components/languages';
import { THEME_PRESETS, type ThemePreset } from '@/core/spec/schema';
import { Chip, clothForPreset, cloths, Stamp, Text, TextField, useKalamTheme, webData, type ClothKind } from '@/design';
import { MAX_BRIEF_CHARS } from '@/features/input/normalize';
import { useRovingFocus } from '@/design/inputs';
import type { TranslationKey } from '@/i18n/keys';
import { useT } from '@/i18n/react';
import { selectDraft, useCreationStore } from '@/state/creation-store';
import { useSettingsStore } from '@/state/settings-store';

import { buildForecast, cloudAllowed } from './cloud-use';

export const PRESET_KEY: Record<ThemePreset, TranslationKey> = {
  calm_green: 'create.look.calm_green', warm_paper: 'create.look.warm_paper', ocean_blue: 'create.look.ocean_blue',
  soft_lavender: 'create.look.soft_lavender', minimal_neutral: 'create.look.minimal_neutral', high_contrast: 'create.look.high_contrast',
};
const CURRENCIES = [
  { code: 'INR', label: 'create.money.INR' }, { code: 'USD', label: 'create.money.USD' }, { code: 'EUR', label: 'create.money.EUR' },
  { code: 'GBP', label: 'create.money.GBP' }, { code: 'AED', label: 'create.money.AED' },
] as const satisfies ReadonlyArray<{ code: string; label: TranslationKey }>;

/** The same cloth photographs as the shelf's registers (src/design/Register.tsx), so the swatch is the cover. */
const CLOTH_TEXTURE: Record<ClothKind, ImageSourcePropType> = {
  green: require('../../../assets/images/brand/cloth-green.webp'),
  lal: require('../../../assets/images/brand/cloth-red.webp'),
  neel: require('../../../assets/images/brand/cloth-blue.webp'),
  kraft: require('../../../assets/images/brand/cloth-brown.webp'),
  haldi: require('../../../assets/images/brand/cloth-haldi.webp'),
  ocean: require('../../../assets/images/brand/cloth-teal.webp'),
};

function Group({ title, children, radio = true }: { title: string; children: ReactNode; radio?: boolean }) {
  const theme = useKalamTheme();
  return (
    <View role={radio ? 'radiogroup' : undefined} aria-label={title} style={{ gap: 10 }}>
      <Text weight="semibold" tone="secondary" style={{ fontSize: Math.round(14 * theme.fontScale) }}>{title}</Text>
      {children}
    </View>
  );
}

/** One cover as a cloth swatch: the cloth photograph in the app's cover colour with a darker spine. */
export function ClothSwatch({ preset, selected, onPress, rovingProps }: { preset: ThemePreset; selected: boolean; onPress: () => void; rovingProps?: object }) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const { colors } = theme;
  const cloth = clothForPreset(preset);
  return (
    <Pressable
      role="radio"
      aria-checked={selected}
      accessibilityState={{ checked: selected }}
      accessibilityLabel={t(PRESET_KEY[preset])}
      onPress={onPress}
      {...rovingProps}
      {...webData({ kPress: '', kHover: selected ? 'none' : 'border' })}
      style={{
        flexGrow: 1, flexBasis: '30%', minWidth: 84, minHeight: theme.touchTarget, gap: 6, padding: 8, borderRadius: 10,
        borderWidth: selected ? 2 : 1.25, borderColor: selected ? colors.primary : colors.border,
        backgroundColor: selected ? colors.surface : 'transparent',
      }}
    >
      <View aria-hidden style={{ height: 30, borderTopLeftRadius: 3, borderBottomLeftRadius: 3, borderTopRightRadius: 6, borderBottomRightRadius: 6, overflow: 'hidden', backgroundColor: cloths[cloth].cloth }}>
        <Image aria-hidden source={CLOTH_TEXTURE[cloth]} resizeMode="cover" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' }} />
        <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: 4, backgroundColor: 'rgba(0,0,0,0.22)' }} />
      </View>
      <Text variant="caption" weight="semibold" numberOfLines={2} style={{ color: selected ? colors.text : colors.textSecondary }}>{t(PRESET_KEY[preset])}</Text>
    </Pressable>
  );
}

/** One tab stop for a radio group on the web; arrows move and select (docs/02 §10.7). */
export function useRadioRoving<T>(options: readonly T[], value: T | undefined, select: (v: T) => void) {
  const current = Math.max(0, options.indexOf(value as T));
  const pick = (i: number) => { const o = options[i]; if (o !== undefined) select(o); };
  return useRovingFocus({ count: options.length, orientation: 'both', current, onMove: pick, onActivate: pick });
}

export function ClothSwatches({ value, onChange }: { value?: ThemePreset; onChange: (p: ThemePreset | undefined) => void }) {
  const roving = useRadioRoving(THEME_PRESETS, value, onChange);
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {THEME_PRESETS.map((p, i) => (
        <ClothSwatch key={p} preset={p} selected={value === p} onPress={() => onChange(value === p ? undefined : p)} rovingProps={roving.itemProps(i)} />
      ))}
    </View>
  );
}

const LANGUAGE_CODES = LANGUAGES.map((l) => l.code);
const CURRENCY_CODES = CURRENCIES.map((c) => c.code);

export function PreferencesPanel({ footer }: { footer?: ReactNode }) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const prefs = useCreationStore((s) => s.preferences);
  const setPreferences = useCreationStore((s) => s.setPreferences);
  const languages = useRadioRoving(LANGUAGE_CODES, prefs.language, (language) => setPreferences({ language }));
  const money = useRadioRoving<string>(CURRENCY_CODES, prefs.currency, (currency) => setPreferences({ currency }));

  return (
    <View style={{ gap: 26 }}>
      <Group title={t('create.prefs.language')}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {LANGUAGES.map((l, i) => (
            <Chip key={l.code} label={l.native} lang={l.code} accessibilityLabel={l.english} role="radio" selected={prefs.language === l.code}
              onPress={() => setPreferences({ language: l.code })} rovingProps={languages.itemProps(i)} />
          ))}
        </View>
      </Group>
      <Group title={t('create.money.title')}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {CURRENCIES.map((c, i) => {
            const selected = prefs.currency === c.code;
            return <Chip key={c.code} label={t(c.label)} role="radio" selected={selected} onPress={() => setPreferences({ currency: selected ? undefined : c.code })} rovingProps={money.itemProps(i)} />;
          })}
        </View>
      </Group>
      <Group title={t('create.look.title')}>
        <ClothSwatches value={prefs.themePreset} onChange={(p) => setPreferences({ themePreset: p })} />
      </Group>
      {/* Two short notes for the compiler (docs/15 §8.2): who it is for and what it must or must not do. Both optional. */}
      <Group title={t('create.brief.title')} radio={false}>
        <TextField
          label={t('create.brief.who')}
          value={prefs.targetUser ?? ''}
          onChangeText={(targetUser) => setPreferences({ targetUser })}
          placeholder={t('create.brief.whoExample')}
          maxLength={MAX_BRIEF_CHARS}
        />
        <TextField
          label={t('create.brief.limits')}
          value={prefs.constraints ?? ''}
          onChangeText={(constraints) => setPreferences({ constraints })}
          placeholder={t('create.brief.limitsExample')}
          helper={t('create.brief.helper')}
          multiline
          maxLength={MAX_BRIEF_CHARS}
        />
      </Group>
      <Text variant="caption" tone="muted">{t('create.prefs.hint')}</Text>
      {footer}
    </View>
  );
}

/**
 * The route forecast stamp and its one honest sentence (DIRECTION §6). Mirrors the pipeline's route choice
 * through `draftMayUseCloud`; the build progress then shows the route that really ran.
 */
export function BuildForecast({ online, compact }: { online: boolean; compact?: boolean }) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const settings = useSettingsStore((s) => s.settings);
  const draft = useCreationStore(useShallow(selectDraft));
  const forecast = useMemo(() => buildForecast(draft, cloudAllowed(settings), online), [draft, settings, online]);
  if (!forecast) return null;
  return (
    <View style={{ gap: 8 }} accessibilityLiveRegion="polite">
      <Stamp kind={forecast.kind} label={t(forecast.stamp)} size="sm" />
      {compact ? null : <Text variant="bodySmall" tone="secondary">{t(forecast.body)}</Text>}
    </View>
  );
}
