/**
 * A report as a chart: one-sentence summary, the chart (an image to screen readers, named by the
 * summary), and a control that shows the same numbers as a table. Fades in, unless motion is reduced.
 */
import { useEffect, useRef, useState } from 'react';
import { Animated, Platform, Text, View } from 'react-native';

import type { ChartKind, ReportResult } from '@/core/reports';
import { motion, useReducedMotion } from '@/design';

import { BarChart, ChartToggle, DataTable, DONUT_MAX_SLICES, DonutChart, LineChart } from './Charts';
import type { ChartStyle } from './chart-style';
import { COPY } from './copy';

export interface ChartViewProps {
  result: ReportResult;
  kind: ChartKind | 'table';
  style: ChartStyle;
  /** Which metric the chart draws. The table shows all of them. */
  metric?: number;
  /** Hide the summary line when the caller already shows it. */
  hideSummary?: boolean;
}

/** Donuts only for a few positive parts of a whole, and lines only with two or more points. */
export function fitKind(result: ReportResult, kind: ChartKind | 'table', metric = 0): ChartKind | 'table' {
  const values = result.points.map((p) => p.values[metric] ?? 0);
  if (kind === 'donut' && (values.some((v) => v < 0) || values.filter((v) => v > 0).length > DONUT_MAX_SLICES)) return 'bar';
  if (kind === 'line' && result.points.length < 2) return 'bar';
  return kind;
}

export function ChartView({ result, kind, style, metric = 0, hideSummary }: ChartViewProps) {
  const reduced = useReducedMotion();
  const [table, setTable] = useState(kind === 'table');
  const fade = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  useEffect(() => {
    if (reduced) { fade.setValue(1); return; }
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: motion.small, useNativeDriver: Platform.OS !== 'web' }).start();
  }, [result, reduced, fade]);

  const shown = fitKind(result, kind, metric);
  const Chart = shown === 'line' ? LineChart : shown === 'donut' ? DonutChart : BarChart;
  return (
    <View style={{ gap: 12 }}>
      {hideSummary ? null : <Text style={[style.text.body, { color: style.colors.text }]}>{result.summary}</Text>}
      <Animated.View style={{ opacity: fade, transform: [{ translateY: fade.interpolate({ inputRange: [0, 1], outputRange: [4, 0] }) }] }}>
        {table || shown === 'table' ? (
          <DataTable result={result} style={style} />
        ) : (
          <View accessible role="img" accessibilityLabel={COPY.chartLabel(result.summary)}>
            <Chart result={result} style={style} metric={metric} />
          </View>
        )}
      </Animated.View>
      {kind === 'table' ? null : (
        <ChartToggle label={table ? COPY.showChart : COPY.showTable} expanded={table} style={