/** Display + action components: text, heading, stat, big button, counter. */
import { Minus, Plus } from 'lucide-react-native';
import { memo, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { RecordValue } from '@/core/contracts';
import type { ComponentOf } from '@/core/spec/schema';
import { EMPTY_STAT, evaluate, formatStat, formulaContext, formulaReads, type CollectionValues } from '../engine/data';
import type { RuntimeTheme } from '../engine/theme';
import { useComponentBounds } from '../layout';
import { font, Pressy, tabular } from './kit';

export const TextBlock = memo(function TextBlock({ c, t }: { c: ComponentOf<'text'>; t: RuntimeTheme }) {
  const bounds = useComponentBounds(c.id);
  return (
    <Text {...bounds} accessibilityLabel={c.a11yLabel} style={[font(t, 16, '400', 1.5), { color: t.colors.text }]}>
      {c.label}
    </Text>
  );
});

export const Heading = memo(function Heading({ c, t }: { c: ComponentOf<'heading'>; t: RuntimeTheme }) {
  const bounds = useComponentBounds(c.id);
  return (
    <Text
      {...bounds}
      accessibilityRole="header"
      accessibilityLabel={c.a11yLabel}
      style={[font(t, 20, '600', 1.3), { color: t.colors.text, marginTop: t.space * 0.5 }]}
    >
      {c.label}
    </Text>
  );
});

/**
 * Stat. Re-evaluates only when its inputs change: records always; the form or app state only if
 * the expression actually reads them (so typing elsewhere doesn't recompute every stat).
 */
export const Stat = memo(function Stat({ c, t, lang, collections, form, state }: {
  c: ComponentOf<'stat'>; t: RuntimeTheme; lang: string; collections: CollectionValues;
  form: Record<string, RecordValue>; state: Record<string, RecordValue>;
}) {
  const bounds = useComponentBounds(c.id);
  const reads = formulaReads(c.expr);
  const formDep = reads.form ? form : null;
  const stateDep = reads.state ? state : null;
  const text = useMemo(
    () => formatStat(c, evaluate(c.expr, formulaContext(collections, formDep ?? {}, stateDep ?? {}, new Date())), lang),
    [c, collections, formDep, stateDep, lang],
  );
  return (
    <View
      {...bounds}
      accessible
      accessibilityLabel={`${c.a11yLabel ?? c.label}: ${text === EMPTY_STAT ? 'not available' : text}`}
      // Larger text → wider minimum, so stats reflow to one column instead of truncating.
      style={[styles.stat, { flexBasis: Math.round(150 * t.fontScale), backgroundColor: t.colors.surface, borderColor: t.colors.border, borderWidth: t.borderWidth, borderRadius: t.radius, padding: t.space }]}
    >
      <Text style={[font(t, 13, '500'), { color: t.colors.textMuted }]}>{c.label}</Text>
      <Text style={[font(t, 30, '600', 1.15), tabular, { color: t.colors.text, letterSpacing: -0.5 }]}>
        {text}
      </Text>
    </View>
  );
});

export const BigButton = memo(function BigButton({ c, t, busy, onPress }: {
  c: ComponentOf<'bigButton'>; t: RuntimeTheme; busy: boolean; onPress(): void;
}) {
  const bounds = useComponentBounds(c.id);
  const tone = c.tone ?? 'primary';
  const bg = tone === 'primary' ? t.colors.primary : tone === 'danger' ? t.colors.danger : t.colors.surface;
  const fg = tone === 'primary' ? t.colors.onPrimary : tone === 'danger' ? t.colors.onDanger : t.colors.primaryText;
  return (
    <Pressy
      {...bounds}
      accessibilityRole="button"
      accessibilityLabel={c.a11yLabel ?? c.label}
      accessibilityState={{ busy, disabled: busy }}
      disabled={busy}
      onPress={onPress}
      style={[
        styles.button,
        {
          minHeight: Math.max(t.target, 56),
          borderRadius: t.radius,
          backgroundColor: bg,
          borderWidth: tone === 'secondary' || t.highContrast ? Math.max(1, t.borderWidth) : 0,
          borderColor: tone === 'secondary' ? t.colors.primaryText : t.colors.text,
        },
      ]}
    >
      <Text style={[font(t, 17, '600', 1.25), { color: fg, textAlign: 'center' }]}>{c.label}</Text>
    </Pressy>
  );
});

export const Counter = memo(function Counter({ c, t, value, onStep }: {
  c: ComponentOf<'counter'>; t: RuntimeTheme; value: number; onStep(op: 'increment' | 'decrement'): void;
}) {
  const bounds = useComponentBounds(c.id);
  const atMin = c.min !== undefined && value <= c.min;
  const atMax = c.max !== undefined && value >= c.max;
  const size = Math.max(t.target, 52);
  const step = (op: 'increment' | 'decrement', disabled: boolean, label: string) => (
    <Pressy
      key={op}
      accessibilityRole="button"
      accessibilityLabel={`${label} ${c.label}`}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => onStep(op)}
      style={[styles.stepBtn, { width: size, height: size, borderRadius: size / 2, backgroundColor: t.colors.primarySoft, borderWidth: t.highContrast ? 2 : 0, borderColor: t.colors.text }]}
    >
      {op === 'increment'
        ? <Plus size={22 * t.fontScale} color={t.colors.primaryText} strokeWidth={2.5} />
        : <Minus size={22 * t.fontScale} color={t.colors.primaryText} strokeWidth={2.5} />}
    </Pressy>
  );
  // Left-handed: the frequent action (+) sits on the leading edge. Reading order is unchanged.
  const controls = t.mirror
    ? [step('increment', atMax, 'Increase'), step('decrement', atMin, 'Decrease')]
    : [step('decrement', atMin, 'Decrease'), step('increment', atMax, 'Increase')];
  return (
    <View
      {...bounds}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={c.a11yLabel ?? c.label}
      accessibilityValue={{ now: value, min: c.min, max: c.max }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'increment' && !atMax) onStep('increment');
        if (e.nativeEvent.actionName === 'decrement' && !atMin) onStep('decrement');
      }}
      style={[styles.counter, { backgroundColor: t.colors.surface, borderColor: t.colors.border, borderWidth: t.borderWidth, borderRadius: t.radius, padding: t.space }]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[font(t, 14, '500'), { color: t.colors.textMuted }]}>{c.label}</Text>
        <Text style={[font(t, 34, '600', 1.1), tabular, { color: t.colors.text }]}>{value}</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 10 }}>{controls}</View>
    </View>
  );
});

const styles = StyleSheet.create({
  stat: { flexGrow: 1, gap: 4 },
  button: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, paddingVertical: 12 },
  counter: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepBtn: { alignItems: 'center', justifyContent: 'center' },
});
