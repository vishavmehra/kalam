import { Calculator, Check, Info, TriangleAlert } from 'lucide-react-native';
import { type ReactNode, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import type { SpecPatchOp } from '@/core/contracts';
import type { FormulaFailure, FormulaSuggestion, SampleTable } from '@/core/formula-assist';
import type { KalamSpec } from '@/core/spec/schema';
import { Button, Chip, fontFamilies, SourceBadge, Surface, Text, TextField, useKalamTheme } from '@/design';

import { COPY } from './copy';
import { parseTyped } from './model';
import { useFormulaHelper } from './use-formula-helper';

export interface FormulaHelperProps {
  spec: KalamSpec;
  /** Entries are read for this app only. */
  appId: string;
  /** The stat whose formula this sets. */
  componentId: string;
  /** What the stat uses now, shown for comparison. */
  currentExpr?: string;
  /** Receives the edit ops and a one-line summary for the history. The editor applies them. */
  onUse(ops: SpecPatchOp[], summary: string): void;
  disabled?: boolean;
}

function Field({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <View style={{ gap: 4 }}>
      <Text variant="caption" tone="muted">{caption}</Text>
      {children}
    </View>
  );
}

function Code({ children }: { children: string }) {
  return (
    <Surface tone="paper" bordered={false} padded={10} radius="md">
      <Text selectable variant="bodySmall" style={{ fontFamily: fontFamilies.mono }}>{children}</Text>
    </Surface>
  );
}

/** The made-up entries the result was worked out on, so it can be checked by hand. */
function MadeUpEntries({ tables }: { tables: SampleTable[] }) {
  return (
    <View style={{ gap: 10 }}>
      {tables.map((t) => (
        <View key={t.title} style={{ gap: 4 }}>
          <Text variant="caption" tone="muted">{COPY.madeUpIn(t.title)}</Text>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            {t.columns.map((c) => <Text key={c} variant="bodySmall" weight="medium" tone="secondary" style={{ flex: 1 }}>{c}</Text>)}
          </View>
          {t.rows.map((row, i) => (
            <View
              key={`${i}:${row.join('|')}`}
              accessible
              accessibilityLabel={row.map((cell, n) => `${t.columns[n]}: ${cell}`).join(', ')}
              style={{ flexDirection: 'row', gap: 12 }}
            >
              {row.map((cell, n) => <Text key={t.columns[n]} variant="bodySmall" numeric style={{ flex: 1 }}>{cell}</Text>)}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

interface CardProps {
  r: FormulaSuggestion;
  problem?: FormulaFailure;
  onUse(): void;
  onClear(): void;
  onCheck(formula: string): void;
  /** The person is editing again, so the last refusal no longer applies. */
  onEdit(): void;
  onTry(texts: Record<string, string>): void;
  disabled?: boolean;
}

/** The formula, what it means in words, and the sample. Every part comes from the checked suggestion. */
function SuggestionCard({ r, problem, onUse, onClear, onCheck, onEdit, onTry, disabled }: CardProps) {
  const theme = useKalamTheme();
  const s = r.sampleValues;
  const [text, setText] = useState(r.formula);
  const changed = text.trim() !== r.formula;
  // Example numbers the person may change: what they typed, or the made-up value shown.
  const editable = s.inputs.filter((i) => i.editable && i.id);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const shown = (id: string, fallback: string): string => typed[id] ?? fallback;
  const invalid = (id: string): boolean => {
    const t = typed[id];
    return t !== undefined && !(id in parseTyped({ [id]: t }));
  };
  const tryNow = () => onTry(Object.fromEntries(editable.map((i) => [i.id as string, shown(i.id as string, i.value)])));
  return (
    <Surface tone="alt" bordered={false} padded={14} style={{ gap: 12 }}>
      <Text variant="bodyLarge" weight="semibold">{r.explanation}</Text>

      <TextField
        label={COPY.formula}
        helper={COPY.formulaHint}
        value={text}
        onChangeText={(v) => { setText(v); onEdit(); }}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        maxLength={300}
        editable={!disabled}
        error={changed && problem ? problem.message : undefined}
      />
      {changed && problem?.problems?.length ? (
        <View style={{ gap: 4 }}>
          {problem.problems.map((p) => <Text key={p} variant="bodySmall" tone="danger">{p}</Text>)}
        </View>
      ) : null}
      {changed ? <Button label={COPY.check} variant="outline" onPress={() => onCheck(text)} disabled={disabled || !text.trim()} /> : null}

      {r.references.length ? (
        <Field caption={COPY.uses}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {r.references.map((name) => <Chip key={name} label={name} />)}
          </View>
        </Field>
      ) : null}
      <Field caption={COPY.tryIt}>
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
            {s.kind === 'constant' ? null : <Chip label={s.kind === 'entries' ? COPY.yours : COPY.example} tone={s.kind === 'entries' ? 'success' : 'warning'} />}
            <Text variant="bodySmall" tone="secondary" style={{ flex: 1 }}>{s.label}</Text>
          </View>
          {s.inputs.filter((i) => !i.editable).map((input) => (
            <View key={input.label} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
              <Text variant="bodySmall" tone="secondary" style={{ flex: 1 }}>{input.label}</Text>
              <Text variant="bodySmall" numeric>{input.value}</Text>
            </View>
          ))}
          {s.tables?.length ? <MadeUpEntries tables={s.tables} /> : null}
          {editable.length ? (
            <View style={{ gap: 8 }}>
              <Text variant="caption" tone="muted">{COPY.valuesCaption}</Text>
              {editable.map((i) => (
                <TextField
                  key={i.id}
                  label={i.label}
                  value={shown(i.id as string, i.value)}
                  onChangeText={(v) => setTyped((t) => ({ ...t, [i.id as string]: v }))}
                  keyboardType="decimal-pad"
                  editable={!disabled}
                  error={invalid(i.id as string) ? COPY.badNumber : undefined}
                />
              ))}
              <Text variant="caption" tone="muted">{COPY.valuesHint}</Text>
              <Button
                label={COPY.tryValues}
                variant="outline"
                onPress={tryNow}
                disabled={disabled || editable.some((i) => invalid(i.id as string))}
              />
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
            <Text weight="medium">{COPY.result}</Text>
            <Text variant="h4" numeric accessibilityLabel={`${COPY.result}: ${s.resultText}`}>{s.resultText}</Text>
          </View>
        </View>
      </Field>
      {r.warnings.map((w) => (
        <View key={w} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
          <TriangleAlert size={18} color={theme.colors.warning} style={{ marginTop: 2 }} />
          <Text variant="bodySmall" tone="warning" style={{ flex: 1 }} accessibilityLabel={`${COPY.warning}: ${w}`}>{w}</Text>
        </View>
      ))}
      <SourceBadge source={r.source} label={r.badge} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Button
          label={COPY.useThis}
          icon={Check}
          onPress={onUse}
          disabled={disabled || changed}
          accessibilityHint={changed ? COPY.useChecked : COPY.useHint}
        />
        <Button label={COPY.clear} variant="ghost" onPress={onClear} />
      </View>
    </Surface>
  );
}

/**
 * "What should this number show?" for one stat. The person describes a calculation, sees the checked
 * formula, a plain sentence about it and an example, and only then taps "Use this".
 */
export function FormulaHelper({ spec, appId, componentId, currentExpr, onUse, disabled }: FormulaHelperProps) {
  const theme = useKalamTheme();
  const h = useFormulaHelper({ spec, appId, componentId, onUse });
  const r = h.result;
  return (
    <View style={{ gap: 12 }}>
      {currentExpr ? (
        <Field caption={COPY.now}><Code>{currentExpr}</Code></Field>
      ) : null}
      <TextField
        label={COPY.inputLabel}
        helper={COPY.hint}
        value={h.request}
        onChangeText={h.setRequest}
        placeholder={COPY.placeholder}
        returnKeyType="go"
        onSubmitEditing={h.suggest}
        maxLength={300}
        editable={!disabled}
      />
      <Button label={COPY.suggest} icon={Calculator} onPress={h.suggest} loading={h.busy} disabled={disabled || !h.request.trim()} />
      <View accessibilityLiveRegion="polite" style={{ gap: 12 }}>
        {h.busy ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }} accessibilityRole="progressbar" accessibilityLabel={COPY.working}>
            <ActivityIndicator color={theme.colors.primary} />
            <Text tone="secondary">{COPY.working}</Text>
          </View>
        ) : null}
        {r && !r.ok ? (
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
            <Info size={18} color={theme.colors.textMuted} style={{ marginTop: 2 }} />
            <Text tone="secondary" style={{ flex: 1 }}>{r.message}</Text>
          </View>
        ) : null}
        {/* Keyed by the revision, so the editable text starts again from each new suggestion and each accepted edit. */}
        {r?.ok ? (
          <SuggestionCard
            key={h.revision}
            r={r}
            problem={h.problem}
            onUse={h.use}
            onClear={h.clear}
            onCheck={h.check}
            onEdit={h.clearProblem}
            onTry={h.tryValues}
            disabled={disabled}
          />
        ) : null}
      </View>
    </View>
  );
}
