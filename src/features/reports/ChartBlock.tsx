/**
 * Runtime renderer for the proposed KalamSpec v1.1 `chart` component. Reads one collection's
 * records, computes the numbers with the report engine and draws them in the app's own theme.
 * Mount from KalamRuntime once schema.ts accepts the component (see the R1 report).
 */
import { memo, useMemo } from 'react';
import { Text, View } from 'react-native';

import type { KalamRecord } from '@/core/contracts';
import { type ChartComponent, chartToReport, runReport } from '@/core/reports';
import type { KalamSpec } from '@/core/spec/schema';
import type { RuntimeTheme } from '@/runtime/engine/theme';
import { useComponentBounds } from '@/runtime/layout';
import { font } from '@/runtime/ui/kit';

import type { ChartStyle } from './chart-style';
import { ChartView } from './ChartView';
import { COPY, STATUS_TITLE } from './copy';

/** Chart style from a generated app's resolved theme (contrast already guarded there). */
export function appChartStyle(t: RuntimeTheme): ChartStyle {
  return {
    colors: { text: t.colors.text, muted: t.colors.textMuted, grid: t.colors.border, surface: t.colors.surface, mark: t.colors.primaryText },
    text: { small: font(t, 12, '500', 1.3), body: font(t, 14), strong: font(t, 16, '600', 1.3) },
    target: t.target,
    radius: t.radius,
  };
}

export const ChartBlock = memo(function ChartBlock({ c, t, spec, records }: {
  c: ChartComponent; t: RuntimeTheme; spec: KalamSpec; records: readonly KalamRecord[];
}) {
  const bounds = useComponentBounds(c.id);
  const style = useMemo(() => appChartStyle(t), [t]);
  const outcome = useMemo(() => runReport(spec, chartToReport(c), records, { now: new Date() }), [spec, c, records]);
  const muted = [style.text.body, { color: style.colors.muted }];
  let body;
  if (!outcome.ok) body = <Text style={muted}>{outcome.errors[0]}</Text>;
  else if (outcome.result.status === 'empty') {
    body = (
      <View style={{ gap: 2 }}>
        <Text style={[style.text.strong, { color: style.colors.text }]}>{COPY.empty}</Text>
        <Text style={muted}>{COPY.emptyHint}</Text>
      </View>
    );
  } else if (outcome.result.status !== 'ok') {
    body = (
      <View style={{ gap: 2 }}>
        <Text style={[style.text.strong, { color: style.colors.text }]}>{STATUS_TITLE[outcome.result.status]}</Text>
        <Text style={muted}>{[outcome.result.summary, ...outcome.result.details].join(' ')}</Text>
      </View>
    );
  } else {
    body = <ChartView result={outcome.result} kind={c.chart} style={style} />;
  }
  return (
    <View
      {...bounds}
      accessibilityHint={c.a11yDescription}
      style={{ gap: t.space * 0.75, padding: t.space, backgroundColor: t.colors.surface, borderColor: t.colors.border, borderWidth: t.borderWidth, borderRadius: t.radius }}
    >
      <Text role="heading" accessibilityLabel={c.a11yLabel} style={[font(t, 16, '600', 1.3), { color: t.colors.text }]}>{c.label}</Text>
      {body}
    </View>
  );
});
