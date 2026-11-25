/** Theme customiser (docs/02 §12.3): preset, main and second colour, background mood, corners, text size. */
import { Check } from 'lucide-react-native';
import { Pressable, View } from 'react-native';
import type { AccessModes, SpecPatchOp } from '@/core/contracts';
import { THEME_PRESETS, type KalamTheme } from '@/core/spec/schema';
import { THEME_PRESET_TOKENS } from '@/core/templates/themes';
import { Chip, SegmentedControl, Text, useKalamTheme } from '@/design';
import { resolveAppTheme } from '@/runtime/engine/theme';
import {
  ACCENT_SWATCHES, BACKGROUND_MOODS, type BackgroundMood, currentMood, moodOps, PRESET_LABELS, PRIMARY_SWATCHES, RADIUS_OPTIONS,
  TEXT_SIZES, presetOps,
} from './edit-model';

const NO_MODES: AccessModes = { large: false, highContrast: false, simple: false, readAloud: false, leftHanded: false };

export function ThemePanel({ theme, disabled, onApply }: {
  theme: KalamTheme; disabled?: boolean; onApply(ops: SpecPatchOp[], summary: string): void;
}) {
  const k = useKalamTheme();
  const radiusValue = RADIUS_OPTIONS.reduce((best, o) => (Math.abs(Number(o.value) - theme.radius) < Math.abs(Number(best.value) - theme.radius) ? o : best)).value;
  const sizeValue = TEXT_SIZES.reduce((best, o) => (Math.abs(Number(o.value) - theme.fontScale) < Math.abs(Number(best.value) - theme.fontScale) ? o : best)).value;
  // Honest note when the contrast guard has to darken the chosen colour on buttons.
  const adjusted = resolveAppTheme(theme, NO_MODES).colors.primary !== theme.primary.toUpperCase();

  return (
    <View style={{ gap: 24, opacity: disabled ? 0.6 : 1 }} pointerEvents={disabled ? 'none' : 'auto'}>
      <View style={{ gap: 10 }}>
        <Text variant="h4">Look</Text>
        <View role="radiogroup" aria-label="Theme preset" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {THEME_PRESETS.map((p) => {
            const tokens = THEME_PRESET_TOKENS[p];
            const on = theme.preset === p;
            return (
              <Pressable
                key={p}
                role="radio"
                aria-checked={on}
                accessibilityLabel={PRESET_LABELS[p]}
                onPress={() => onApply(presetOps(p), `Theme: ${PRESET_LABELS[p]}`)}
                style={({ pressed }) => ({
                  flexGrow: 1, flexBasis: 140, minHeight: k.touchTarget + 16, padding: 10, gap: 8,
                  borderRadius: k.radius.md, borderWidth: on ? 2 : 1,
                  borderColor: on ? k.colors.primary : k.colors.border,
                  backgroundColor: tokens.background ?? k.colors.surface,
                  transform: [{ scale: pressed ? 0.98 : 1 }],
                })}
              >
                <View style={{ flexDirection: 'row', gap: 4 }}>
                  {[tokens.primary, tokens.secondary, tokens.text].map((c, i) => (
                    <View key={i} style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: c, borderWidth: 1, borderColor: 'rgba(0,0,0,0.12)' }} />
                  ))}
                </View>
                <Text variant="bodySmall" weight="semibold" style={{ color: tokens.text }}>{PRESET_LABELS[p]}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={{ gap: 10 }}>
        <Text variant="h4">Main colour</Text>
        <View role="radiogroup" aria-label="Main colour" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
          {PRIMARY_SWATCHES.map((s) => {
            const on = theme.primary.toUpperCase() === s.hex.toUpperCase();
            return (
              <Pressable
                key={s.hex}
                role="radio"
                aria-checked={on}
                accessibilityLabel={s.name}
                onPress={() => onApply([{ op: 'setThemeToken', token: 'primary', value: s.hex }], `Main colour: ${s.name}`)}
                style={{ width: k.touchTarget, height: k.touchTarget, alignItems: 'center', justifyContent: 'center' }}
              >
                <View
                  style={{
                    width: 36, height: 36, borderRadius: 18, backgroundColor: s.hex, alignItems: 'center', justifyContent: 'center',
                    borderWidth: on ? 3 : 0, borderColor: k.colors.surface,
                    outlineColor: on ? s.hex : 'transparent', outlineWidth: on ? 2 : 0, outlineStyle: 'solid',
                  }}
                >
                  {on ? <Check size={18} color="#FFFFFF" strokeWidth={3} /> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
        {adjusted ? (
          <Text variant="bodySmall" tone="muted">
            Buttons use a slightly deeper shade of this colour so their text stays readable.
          </Text>
        ) : null}
      </View>

      <View style={{ gap: 10 }}>
        <Text variant="h4">Second colour</Text>
        <View role="radiogroup" aria-label="Second colour" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
          {ACCENT_SWATCHES.map((s) => {
            const on = (theme.secondary ?? '').toUpperCase() === s.hex.toUpperCase();
            return (
              <Pressable
                key={s.hex}
                role="radio"
                aria-checked={on}
                accessibilityLabel={s.name}
                disabled={disabled}
                onPress={() => onApply([{ op: 'setThemeToken', token: 'secondary', value: s.hex }], `Second colour: ${s.name}`)}
                style={{ width: k.touchTarget, height: k.touchTarget, alignItems: 'center', justifyContent: 'center' }}
              >
                <View
                  style={{
                    width: 36, height: 36, borderRadius: 18, backgroundColor: s.hex, alignItems: 'center', justifyContent: 'center',
                    borderWidth: on ? 3 : 0, borderColor: k.colors.surface,
                    outlineColor: on ? s.hex : 'transparent', outlineWidth: on ? 2 : 0, outlineStyle: 'solid',
                  }}
                >
                  {on ? <Check size={18} color="#1C2430" strokeWidth={3} /> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={{ gap: 10 }}>
        <Text variant="h4" nativeID="mood-label">Background</Text>
        <View role="radiogroup" aria-labelledby="mood-label" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {(Object.keys(BACKGROUND_MOODS) as BackgroundMood[]).map((m) => (
            <Chip
              key={m}
              role="radio"
              label={BACKGROUND_MOODS[m].label}
              selected={currentMood(theme) === m}
              onPress={() => onApply(moodOps(m), `Background: ${BACKGROUND_MOODS[m].label}`)}
            />
          ))}
        </View>
      </View>

      <SegmentedControl
        label="Corners"
        options={RADIUS_OPTIONS}
        value={radiusValue}
        onChange={(v) => {
          const o = RADIUS_OPTIONS.find((x) => x.value === v);
          onApply([{ op: 'setThemeNumber', token: 'radius', value: Number(v) }], `Corners: ${o?.label ?? v}`);
        }}
      />
      <SegmentedControl
        label="Text size"
        options={TEXT_SIZES}
        value={sizeValue}
        onChange={(v) => {
          const o = TEXT_SIZES.find((x) => x.value === v);
          onApply([{ op: 'setThemeNumber', token: 'fontScale', value: Number(v) }], `Text size: ${o?.label ?? v}`);
        }}
      />
    </View>
  );
}
