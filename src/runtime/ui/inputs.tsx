/** Form inputs for generated apps: number, text, date, choice, toggle. Labels sit above fields. */
import { Check } from 'lucide-react-native';
import { memo, useState, type ReactNode } from 'react';
import { StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import type { RecordValue } from '@/core/contracts';
import type { ComponentOf } from '@/core/spec/schema';
import type { RuntimeTheme } from '../engine/theme';
import type { FieldDef } from '../engine/types';
import { useComponentBounds } from '../layout';
import { useOptionLabel } from '../translation/option-labels';
import { DateInput } from './DateInput';
import { font, Pressy } from './kit';

export interface InputProps<C> {
  c: C;
  t: RuntimeTheme;
  def?: FieldDef;
  value: RecordValue | undefined;
  error?: string;
  onChange(value: RecordValue): void;
  onFocus(): void;
}

export function FieldShell({ t, componentId, label, required, error, nativeID, children }: {
  /** KalamSpec component id, so edit by drawing can find the field on screen. */
  t: RuntimeTheme; componentId: string; label: string; required?: boolean; error?: string; nativeID: string; children: ReactNode;
}) {
  const bounds = useComponentBounds(componentId);
  return (
    <View {...bounds} style={{ gap: 6 }}>
      <Text nativeID={nativeID} style={[font(t, 14, '500'), { color: t.colors.text }]}>
        {label}
        {required ? <Text style={{ color: t.colors.textMuted }}> (required)</Text> : null}
      </Text>
      {children}
      {error ? (
        <Text nativeID={`${nativeID}_err`} accessibilityLiveRegion="polite" style={[font(t, 13, '500'), { color: t.colors.danger }]}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * Marks a field invalid for assistive tech and points it at its error text (docs/10 §7.3).
 * React Native has no typed `aria-invalid`; react-native-web forwards it to the DOM.
 */
export function invalidProps(labelId: string, error?: string, required?: boolean): object {
  return {
    'aria-invalid': !!error,
    ...(error ? { 'aria-describedby': `${labelId}_err` } : {}),
    ...(required ? { 'aria-required': true } : {}),
  };
}

export function fieldBox(t: RuntimeTheme, focused: boolean, error?: string) {
  return {
    minHeight: t.target,
    borderRadius: Math.min(t.radius, 16),
    borderWidth: focused || error ? Math.max(2, t.borderWidth) : t.borderWidth,
    borderColor: error ? t.colors.danger : focused ? t.colors.focus : t.colors.border,
    backgroundColor: t.colors.surface,
    paddingHorizontal: 14,
  } as const;
}

function useFocus(onFocus: () => void) {
  const [focused, setFocused] = useState(false);
  return {
    focused,
    handlers: { onFocus: () => { setFocused(true); onFocus(); }, onBlur: () => setFocused(false) },
  };
}

const display = (v: RecordValue | undefined) => (v === null || v === undefined ? '' : String(v));

export const NumberField = memo(function NumberField({ c, t, def, value, error, onChange, onFocus }: InputProps<ComponentOf<'number'>>) {
  const { focused, handlers } = useFocus(onFocus);
  const id = `lbl_${c.id}`;
  return (
    <FieldShell t={t} componentId={c.id} label={c.label} required={def?.required} error={error} nativeID={id}>
      <View style={[fieldBox(t, focused, error), styles.row]}>
        <TextInput
          {...handlers}
          accessibilityLabel={c.a11yLabel ?? c.label}
          accessibilityLabelledBy={id}
          {...invalidProps(id, error, def?.required)}
          value={display(value)}
          onChangeText={onChange}
          placeholder={c.placeholder}
          placeholderTextColor={t.colors.textMuted}
          keyboardType="decimal-pad"
          inputMode="decimal"
          style={[styles.input, font(t, 17, '500'), { color: t.colors.text }]}
        />
        {def?.unit ? <Text style={[font(t, 15), { color: t.colors.textMuted }]}>{def.unit}</Text> : null}
      </View>
    </FieldShell>
  );
});

export const TextField = memo(function TextField({ c, t, def, value, error, onChange, onFocus }: InputProps<ComponentOf<'textInput'>>) {
  const { focused, handlers } = useFocus(onFocus);
  const id = `lbl_${c.id}`;
  return (
    <FieldShell t={t} componentId={c.id} label={c.label} required={def?.required} error={error} nativeID={id}>
      <View style={[fieldBox(t, focused, error), c.multiline && { paddingVertical: 10 }]}>
        <TextInput
          {...handlers}
          accessibilityLabel={c.a11yLabel ?? c.label}
          accessibilityLabelledBy={id}
          {...invalidProps(id, error, def?.required)}
          value={display(value)}
          onChangeText={onChange}
          placeholder={c.placeholder}
          placeholderTextColor={t.colors.textMuted}
          multiline={c.multiline}
          maxLength={def?.maxLength}
          style={[styles.input, font(t, 17), { color: t.colors.text }, c.multiline && { minHeight: 96, textAlignVertical: 'top' }]}
        />
      </View>
    </FieldShell>
  );
});

export const DateField = memo(function DateField({ c, t, def, value, error, onChange, onFocus }: InputProps<ComponentOf<'date'>>) {
  const { focused, handlers } = useFocus(onFocus);
  const id = `lbl_${c.id}`;
  return (
    <FieldShell t={t} componentId={c.id} label={c.label} required={def?.required} error={error} nativeID={id}>
      <DateInput
        t={t}
        label={c.a11yLabel ?? c.label}
        labelledBy={id}
        value={display(value)}
        onChange={onChange}
        boxStyle={fieldBox(t, focused, error)}
        {...handlers}
      />
    </FieldShell>
  );
});

export const ChoiceField = memo(function ChoiceField({ c, t, def, value, error, onChange, onFocus }: InputProps<ComponentOf<'choice'>>) {
  const options = c.options ?? def?.options ?? [];
  // Shows a translated name when the app is viewed in another language; the stored value stays `o`.
  const optionLabel = useOptionLabel();
  const id = `lbl_${c.id}`;
  return (
    <FieldShell t={t} componentId={c.id} label={c.label} required={def?.required} error={error} nativeID={id}>
      <View accessibilityRole="radiogroup" accessibilityLabelledBy={id} style={styles.chips}>
        {options.map((o) => {
          const on = value === o;
          return (
            <Pressy
              key={o}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={optionLabel(o)}
              onPress={() => {
                onFocus();
                // Tapping the selected option again clears an optional choice.
                onChange(on && !def?.required ? null : o);
              }}
              style={[
                styles.chip,
                {
                  minHeight: t.target,
                  borderRadius: Math.min(t.radius, 999),
                  borderWidth: t.borderWidth,
                  borderColor: on ? t.colors.primary : t.colors.border,
                  backgroundColor: on ? t.colors.primary : t.colors.surface,
                },
              ]}
            >
              {on ? <Check size={16 * t.fontScale} color={t.colors.onPrimary} strokeWidth={2.5} /> : null}
              <Text style={[font(t, 15, on ? '600' : '400'), { color: on ? t.colors.onPrimary : t.colors.text }]}>{optionLabel(o)}</Text>
            </Pressy>
          );
        })}
      </View>
    </FieldShell>
  );
});

export const ToggleField = memo(function ToggleField({ c, t, value, onChange, onFocus }: InputProps<ComponentOf<'toggle'>>) {
  const bounds = useComponentBounds(c.id);
  const on = value === true;
  const toggle = (
    <Switch
      value={on}
      onValueChange={(v) => {
        onFocus();
        onChange(v);
      }}
      accessibilityLabel={c.a11yLabel ?? c.label}
      trackColor={{ true: t.colors.primary, false: t.colors.border }}
      thumbColor={t.colors.surface}
    />
  );
  return (
    <View
      {...bounds}
      style={[
        styles.toggleRow,
        { minHeight: t.target, borderRadius: Math.min(t.radius, 16), backgroundColor: t.colors.surface, borderColor: t.colors.border, borderWidth: t.borderWidth },
      ]}
    >
      {t.mirror ? toggle : null}
      <Text style={[font(t, 16, '500'), { color: t.colors.text, flex: 1 }]}>{c.label}</Text>
      {t.mirror ? null : toggle}
    </View>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  // The field box draws its own focus border, so the browser outline would double it.
  input: { flex: 1, paddingVertical: 10, outlineWidth: 0 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, justifyContent: 'center' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 6 },
});
