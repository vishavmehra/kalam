/**
 * Theme customiser (docs/02 §12.3, DIRECTION §6): the cover cloth (preset), main and second colour,
 * background, corners and text size. Every choice is a proposed change shown in the preview first.
 */
import { Check } from 'lucide-react-native';
import { Image, Pressable, View } from 'react-native';
import type { AccessModes, SpecPatchOp } from '@/core/contracts';
import { THEME_PRESETS, type KalamTheme, type ThemePreset } from '@/core/spec/schema';
import { clothForPreset, clothLabel, cloths, palette, readableOn, SegmentedControl, Text, useKalamTheme, webData, withAlpha } from '@/design';
import type { TranslationKey } from '@/i18n/keys';
import { useT } from '@/i18n/react';
import { resolveAppTheme } from '@/runtime/engine/theme';
import {
  ACCENT_SWATCHES, BACKGROUND_MOODS, type BackgroundMood, currentMood, moodOps, PRIMARY_SWATCHES, RADIUS_OPTIONS,
  TEXT_SIZES, presetOps,
} from './edit-model';

const NO_MODES: AccessModes = { large: false, highContrast: false, simple: false, readAloud: false, leftHanded: false };

const PRESET: Record<ThemePreset, TranslationKey> = {
  calm_green: 'edit.theme.preset.calm_green',
  warm_paper: 'edit.theme.preset.warm_paper',
  ocean_blue: 'edit.theme.preset.ocean_blue',
  soft_lavender: 'edit.theme.preset.soft_lavender',
  minimal_neutral: 'edit.theme.preset.minimal_neutral',
  high_contrast: 'edit.theme.preset.high_contrast',
};

/** Swatch names (edit-model) to their words. */
const COLOUR: Record<string, TranslationKey> = {
  Forest: 'edit.theme.colour.forest', Teal: 'edit.theme.colour.teal', Ocean: 'edit.theme.colour.ocean', Indigo: 'edit.theme.colour.indigo',
  Lavender: 'edit.theme.colour.lavender', Berry: 'edit.theme.colour.berry', Brick: 'edit.theme.colour.brick', Saffron: 'edit.theme.colour.saffron',
  Clay: 'edit.theme.colour.clay', Graphite: 'edit.theme.colour.graphite', Marigold: 'edit.theme.colour.marigold', Coral: 'edit.theme.colour.coral',
  Rose: 'edit.theme.colour.rose', Mint: 'edit.theme.colour.mint', Sky: 'edit.theme.colour.sky', Plum: 'edit.theme.colour.plum',
};
const MOOD: Record<BackgroundMood, TranslationKey> = { light: 'edit.theme.mood.light', warm: 'edit.theme.mood.warm', dark: 'edit.theme.mood.dark' };
const RADIUS: Record<string, TranslationKey> = { 4: 'edit.theme.corners.sharp', 12: 'edit.theme.corners.soft', 20: 'edit.theme.corners.round' };
const SIZE: Record<string, TranslationKey> = { 0.9: 'edit.theme.size.small', 1: 'edit.theme.size.default', 1.15: 'edit.theme.size.large', 1.3: 'edit.theme.size.larger' };

/** Cloth photographs, the same ones the shelf covers use (assets/images/brand/SOURCES.txt). */
const CLOTH_TEXTURE = {
  green: require('../../../assets/images/brand/cloth-green.webp'),
  lal: require('../../../assets/images/brand/cloth-red.webp'),
  neel: require('../../../assets/images/brand/cloth-blue.webp'),
  kraft: require('../../../assets/images/brand/cloth-brown.webp'),
  haldi: require('../../../assets/images/brand/cloth-haldi.webp'),
  ocean: require('../../../assets/images/brand/cloth-teal.webp'),
} as const;

export function ThemePanel({ theme, disabled, onApply }: {
  theme: KalamTheme; disabled?: boolean; onApply(ops: SpecPatchOp[], summary: string): void;
}) {
  const k = useKalamTheme();
  const t = useT(k.uiLanguage);
  const radiusValue = RADIUS_OPTIONS.reduce((best, o) => (Math.abs(Number(o.value) - theme.radius) < Math.abs(Number(best.value) - theme.radius) ? o : best)).value;
  const sizeValue = TEXT_SIZES.reduce((best, o) => (Math.abs(Number(o.value) - theme.fontScale) < Math.abs(Number(best.value) - theme.fontScale) ? o : best)).value;
  // Honest note when the contrast guard has to darken the chosen colour on buttons.
  const adjusted = resolveAppTheme(theme, NO_MODES).colors.primary !== theme.primary.toUpperCase();
  const mood = currentMood(theme);

  const swatches = (list: typeof PRIMARY_SWATCHES, current: string | undefined, token: 'primary' | 'secondary', titleKey: TranslationKey) => (
    <View role="radiogroup" aria-label={t(titleKey)} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
      {list.map((s) => {
        const on = (current ?? '').toUpperCase() === s.hex.toUpperCase();
        const name = t(COLOUR[s.name] ?? 'edit.theme.colour.graphite');
        return (
          <Pressable
            key={s.hex}
            role="radio"
            aria-checked={on}
            accessibilityLabel={name}
            onPress={() => onApply([{ op: 'setThemeToken', token, value: s.hex }], t(token === 'primary' ? 'edit.theme.summary.main' : 'edit.theme.summary.second', { name }))}
            {...webData({ kPress: '' })}
            style={{ width: k.touchTarget, height: k.touchTarget, alignItems: 'center', justifyContent: 'center', borderRadius: k.radius.press }}
          >
            <View
              style={{
                width: 34, height: 34, borderRadius: 10, backgroundColor: s.hex, alignItems: 'center', justifyContent: 'center',
                borderWidth: on ? 2.5 : 0, borderColor: k.colors.surface,
                outlineColor: on ? k.colors.primary : 'transparent', outlineWidth: on ? 1.75 : 0, outlineStyle: 'solid',
              }}
            >
              {on ? <Check size={18} color={readableOn(s.hex, palette.paper.ink, palette.paper.sheet)} strokeWidth={3} /> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );

  return (
    <View style={{ gap: 28, opacity: disabled ? 0.6 : 1 }} pointerEvents={disabled ? 'none' : 'auto'}>
      <View style={{ gap: 10 }}>
        <Text variant="h4" nativeID="cover-label">{t('edit.theme.cover')}</Text>
        <Text variant="bodySmall" tone="secondary">{t('edit.theme.coverHint')}</Text>
        <View role="radiogroup" aria-labelledby="cover-label" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {THEME_PRESETS.map((p) => {
            const cloth = clothForPreset(p);
            const on = theme.preset === p;
            const name = t(PRESET[p]);
            return (
              <Pressable
                key={p}
                role="radio"
                aria-checked={on}
                accessibilityLabel={name}
                onPress={() => onApply(presetOps(p), t('edit.theme.summary.cover', { name }))}
                {...webData({ kPress: '' })}
                style={({ pressed }) => ({
                  width: 116, minHeight: Math.max(k.touchTarget + 40, 96), padding: 8, paddingLeft: 14, justifyContent: 'flex-end',
                  borderTopLeftRadius: 4, borderBottomLeftRadius: 4, borderTopRightRadius: 9, borderBottomRightRadius: 9,
                  backgroundColor: cloths[cloth].cloth, overflow: 'hidden',
                  outlineColor: on ? k.colors.primary : 'transparent', outlineWidth: on ? 2.5 : 0, outlineStyle: 'solid', outlineOffset: 2,
                  transform: [{ translateY: pressed && !k.reducedMotion ? 1 : 0 }],
                })}
              >
                {k.accessModes.highContrast ? null : (
                  <Image source={CLOTH_TEXTURE[cloth]} resizeMode="cover" aria-hidden style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%', opacity: 0.55 }} />
                )}
                <View aria-hidden style={{ position: 'absolute', left: 5, top: 6, bottom: 6, borderLeftWidth: 1.25, borderStyle: 'dashed', borderColor: withAlpha(palette.paper.sheet, 0.35) }} />
                <View style={{ backgroundColor: clothLabel.bg, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 4, flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1.5, borderColor: cloths[cloth].cloth }}>
                  {on ? <Check size={14} color={clothLabel.fg} strokeWidth={3} /> : null}
                  <Text variant="caption" weight="semibold" numberOfLines={2} style={{ color: clothLabel.fg, flexShrink: 1 }}>{name}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={{ gap: 10 }}>
        <Text variant="h4">{t('edit.theme.main')}</Text>
        {swatches(PRIMARY_SWATCHES, theme.primary, 'primary', 'edit.theme.main')}
        {adjusted ? <Text variant="bodySmall" tone="muted">{t('edit.theme.adjusted')}</Text> : null}
      </View>

      <View style={{ gap: 10 }}>
        <Text variant="h4">{t('edit.theme.second')}</Text>
        {swatches(ACCENT_SWATCHES, theme.secondary, 'secondary', 'edit.theme.second')}
      </View>

      <SegmentedControl<BackgroundMood | ''>
        label={t('edit.theme.background')}
        options={(Object.keys(BACKGROUND_MOODS) as BackgroundMood[]).map((m) => ({ value: m, label: t(MOOD[m]) }))}
        value={mood ?? ''}
        onChange={(m) => { if (m) onApply(moodOps(m), t('edit.theme.summary.background', { name: t(MOOD[m]) })); }}
      />
      <SegmentedControl
        label={t('edit.theme.cornersLabel')}
        options={RADIUS_OPTIONS.map((o) => ({ value: o.value, label: t(RADIUS[o.value] ?? 'edit.theme.corners.soft') }))}
        value={radiusValue}
        onChange={(v) => onApply([{ op: 'setThemeNumber', token: 'radius', value: Number(v) }], t('edit.theme.summary.corners', { name: t(RADIUS[v] ?? 'edit.theme.corners.soft') }))}
      />
      <SegmentedControl
        label={t('edit.theme.sizeLabel')}
        options={TEXT_SIZES.map((o) => ({ value: o.value, label: t(SIZE[o.value] ?? 'edit.theme.size.default') }))}
        value={sizeValue}
        onChange={(v) => onApply([{ op: 'setThemeNumber', token: 'fontScale', value: Number(v) }], t('edit.theme.summary.size', { name: t(SIZE[v] ?? 'edit.theme.size.default') }))}
      />
    </View>
  );
}
