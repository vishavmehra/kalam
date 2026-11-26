import { useMemo, useState } from 'react';
import { View } from 'react-native';

import type { SpecPatchOp } from '@/core/contracts';
import type { KalamSpec } from '@/core/spec/schema';
import { Chip, Text } from '@/design';

import { COPY } from './copy';
import { FormulaHelper } from './FormulaHelper';
import { statChoices } from './model';

export interface StatFormulaPanelProps {
  spec: KalamSpec;
  appId: string;
  disabled?: boolean;
  /** Same shape as the theme panel: the editor applies the ops as one change with this summary. */
  onApply(ops: SpecPatchOp[], summary: string): void;
}

/**
 * The editor panel for the numbers (stats) of an app: pick one, then describe what it should show.
 * Self-contained, so the editor only needs to place it next to the theme panel.
 */
export function StatFormulaPanel({ spec, appId, disabled, onApply }: StatFormulaPanelProps) {
  const stats = useMemo(() => statChoices(spec), [spec]);
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const current = stats.find((s) => s.id === picked) ?? stats[0];
  if (!current) return <Text tone="secondary">{COPY.noStats}</Text>;
  return (
    <View style={{ gap: 16 }}>
      <View style={{ gap: 4 }}>
        <Text variant="h4">{COPY.panelTitle}</Text>
        <Text variant="bodySmall" tone="secondary">{COPY.panelHint}</Text>
      </View>
      {stats.length > 1 ? (
        <View role="radiogroup" accessibilityLabel={COPY.pickLabel} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {stats.map((s) => (
            <Chip key={s.id} label={s.label} role="radio" selected={s.id === current.id} onPress={() => setPicked(s.id)} />
          ))}
        </View>
      ) : null}
      {/* Keyed by the stat, so a new number starts with a clean request. */}
      <FormulaHelper
        key={current.id}
        spec={spec}
        appId={appId}
        componentId={current.id}
        currentExpr={current.expr}
        onUse={onApply}
        disabled={disabled}
      />
    </View>
  );
}
