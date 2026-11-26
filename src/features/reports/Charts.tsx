/**
 * Bar, line and donut charts drawn with react-native-svg. One series each (one axis). Colours come
 * from the caller's ChartStyle (the shell theme or the app theme), never from literals. Text uses
 * text colours; only the marks carry the series colour.
 */
import { useState } from 'react';
import { type LayoutChangeEvent, Pressable, Text, View } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import { barFractions, barPath, donutArcs, formatValue, lineGeometry, type ReportResult } from '@/core/reports';

import { COPY } from './copy';
import type { ChartStyle } from './chart-style';

export interface ChartProps { result: ReportResult; style: ChartStyle; metric: number }

const BAR_HEIGHT = 12;
/**
 * Slice fill strength in option order. Every slice is also named in the legend and the table.
 * Two only: fainter tints of one colour fall below 3:1 against the surface (WCAG 1.4.11), so a
 * third part draws as bars instead. ponytail: add a checked categorical palette to allow more.
 */
const DONUT_OPACITY = [1, 0.72] as const;
export const DONUT_MAX_SLICES = DONUT_OPACITY.length;

function useWidth(initial = 300) {
  const [width, setWidth] = useState(initial);
  const onLayout = (e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    if (w > 0 && w !== width) setWidth(w);
  };
  return { width, onLayout };
}

const value = (r: ReportResult, v: number | null | undefined, metric: number) => formatValue(v, r.metrics[metric], r.lang);

/** Horizontal bars, one row per group: label and value on a line, the bar under them. */
export function BarChart({ result, style, metric }: ChartProps) {
  const { width, onLayout } = useWidth();
  const fractions = barFractions(result.points.map((p) => p.values[metric] ?? null));
  return (
    <View onLayout={onLayout} style={{ gap: 10 }}>
      {result.points.map((p, i) => (
        <View key={p.key} style={{ gap: 4 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
            <Text style={[style.text.body, { color: style.colors.text, flexShrink: 1 }]} numberOfLines={2}>{p.label}</Text>
            <Text style={[style.text.strong, { color: style.colors.text, fontVariant: ['tabular-nums'] }]}>{value(result, p.values[metric], metric)}</Text>
          </View>
          <Svg width={width} height={BAR_HEIGHT}>
            <Rect x={0} y={0} width={width} height={BAR_HEIGHT} rx={BAR_HEIGHT / 2} fill={style.colors.grid} fillOpacity={0.35} />
            <Path d={barPath(width * fractions[i]!, BAR_HEIGHT)} fill={style.colors.mark} />
          </Svg>
        </View>
      ))}
    </View>
  );
}

/** One line over time. Tap a point to read its value. */
export function LineChart({ result, style, metric }: ChartProps) {
  const { width, onLayout } = useWidth();
  const [selected, setSelected] = useState<number | undefined>(undefined);
  const small = style.text.small.fontSize ?? 12;
  const height = Math.round(150 + small * 2);
  const g = lineGeometry(result.points.map((p) => p.values[metric] ?? null), { width, height, padX: 12, padTop: small + 10, padBottom: small + 12 });
  const first = result.points[0];
  const last = result.points[result.points.length - 1];
  const pick = selected === undefined ? undefined : result.points[selected];
  const hit = Math.max(16, style.target / 2);
  const font = { fontSize: small, fontFamily: style.text.small.fontFamily, fill: style.colors.muted };
  return (
    <View onLayout={onLayout} style={{ gap: 6 }}>
      <Text accessibilityLiveRegion="polite" style={[style.text.small, { color: style.colors.muted }]}>
        {pick ? COPY.pointValue(pick.label, value(result, pick.values[metric], metric)) : COPY.tapPoint}
      </Text>
      <Svg width={width} height={height}>
        {/* Recessive grid: the top of the scale and the zero line. */}
        <Line x1={12} x2={width - 12} y1={g.yOf(g.max)} y2={g.yOf(g.max)} stroke={style.colors.grid} strokeWidth={1} />
        <Line x1={12} x2={width - 12} y1={g.baseline} y2={g.baseline} stroke={style.colors.grid} strokeWidth={1} />
        <SvgText {...font} x={12} y={g.yOf(g.max) - 4}>{value(result, g.max, metric)}</SvgText>
        {g.min < 0 ? <SvgText {...font} x={12} y={g.yOf(g.min) - 4}>{value(result, g.min, metric)}</SvgText> : null}
        {pick ? <Line x1={g.points.find((p) => p.index === selected)?.x ?? 0} x2={g.points.find((p) => p.index === selected)?.x ?? 0} y1={g.yOf(g.max)} y2={g.baseline} stroke={style.colors.grid} strokeWidth={1} /> : null}
        <Path d={g.path} stroke={style.colors.mark} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
        {g.points.map((p) => (
          <G key={p.index}>
            <Circle cx={p.x} cy={p.y} r={p.index === selected ? 6 : 4} fill={style.colors.mark} stroke={style.colors.surface} strokeWidth={2} />
            <Circle cx={p.x} cy={p.y} r={hit} fill="transparent" onPress={() => setSelected(p.index === selected ? undefined : p.index)} />
          </G>
        ))}
        {first ? <SvgText {...font} x={12} y={height - 4}>{first.label}</SvgText> : null}
        {last && last !== first ? <SvgText {...font} x={width - 12} y={height - 4} textAnchor="end">{last.label}</SvgText> : null}
      </Svg>
    </View>
  );
}

/** Parts of a whole. Callers fall back to bars when there are more slices than DONUT_MAX_SLICES. */
export function DonutChart({ result, style, metric }: ChartProps) {
  const size = Math.round(132 * Math.min(1.5, Math.max(1, (style.text.body.fontSize ?? 15) / 15)));
  const values = result.points.map((p) => p.values[metric] ?? null);
  const arcs = donutArcs(values, size, Math.round(size * 0.18));
  const strength = new Map(arcs.map((a, rank) => [a.index, DONUT_OPACITY[Math.min(rank, DONUT_OPACITY.length - 1)]!]));
  const total = values.reduce<number>((s, v) => s + (v && v > 0 ? v : 0), 0);
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 16 }}>
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={size} height={size} style={{ position: 'absolute' }}>
          {arcs.map((a) => <Path key={a.index} d={a.path} fill={style.colors.mark} fillOpacity={strength.get(a.index)} stroke={style.colors.surface} strokeWidth={2} />)}
        </Svg>
        <Text style={[style.text.strong, { color: style.colors.text, fontVariant: ['tabular-nums'] }]}>{value(result, total, metric)}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 160, gap: 8 }}>
        {result.points.map((p, i) => {
          const v = values[i];
          if (!v || v <= 0) return null;
          return (
            <View key={p.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Svg width={12} height={12}><Rect width={12} height={12} rx={3} fill={style.colors.mark} fillOpacity={strength.get(i)} stroke={style.colors.mark} strokeWidth={1} /></Svg>
              <Text style={[style.text.body, { color: style.colors.text, flex: 1 }]}>{p.label}</Text>
              <Text style={[style.text.body, { color: style.colors.muted, fontVariant: ['tabular-nums'] }]}>
                {`${value(result, v, metric)} · ${Math.round((v / total) * 100)}%`}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

/** The same numbers as the chart, as a table for screen readers and for checking. */
export function DataTable({ result, style }: Omit<ChartProps, 'metric'>) {
  const rows = result.points.length ? result.points : [{ key: 'all', label: COPY.overall, values: result.totals, entries: result.entries }];
  const cell = (text: string, header: boolean, first: boolean, key: string) => (
    <Text
      key={key}
      role={header ? 'columnheader' : first ? 'rowheader' : 'cell'}
      style={[header ? style.text.small : first ? style.text.strong : style.text.body, {
        flex: first ? 1.4 : 1, textAlign: first ? 'left' : 'right', color: header ? style.colors.muted : style.colors.text,
        fontVariant: ['tabular-nums'],
      }]}
    >
      {text}
    </Text>
  );
  const line = { flexDirection: 'row' as const, gap: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: style.colors.grid };
  return (
    <View role="table" accessibilityLabel={COPY.tableLabel(result.title)}>
      <View role="row" style={line}>
        {[result.groupLabel || COPY.overall, ...result.metrics.map((m) => m.label)].map((h, i) => cell(h, true, i === 0, `h${i}`))}
      </View>
      {rows.map((p) => (
        <View key={p.key} role="row" style={line}>
          {[p.label, ...p.values.map((v, i) => value(result, v, i))].map((t, i) => cell(t, false, i === 0, `${p.key}${i}`))}
        </View>
      ))}
    </View>
  );
}

/** A plain pressable used by the chart view in both the shell and generated apps. */
export function ChartToggle({ label, expanded, style, onPress }: { label: string; expanded: boolean; style: ChartStyle; onPress: () => void }) {
  return (
    <Pressable
      role="button"
      accessibilityLabel={label}
      accessibilityState={{ expanded }}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: style.target, alignSelf: 'flex-start', justifyContent: 'center', paddingHorizontal: 14,
        borderRadius: style.radius, borderWidth: 1, borderColor: style.colors.grid, opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text style={[style.text.strong, { color: style.colors.text }]}>{label}</Text>
    </Pressable>
  );
}
