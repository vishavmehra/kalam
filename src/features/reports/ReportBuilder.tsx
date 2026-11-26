/** Make a report from a few plain choices. Only choices that fit the app's fields are offered. */
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import {
  buildReport, type ReportChoice, type ReportDefinition, reportableFields, type ReportRange, TIME_UNITS, timeSplitFits,
} from '@/core/reports';
import { collectionName, lower } from '@/core/assistant/text';
import type { KalamSpec } from '@/core/spec/schema';
import { Button, Chip, Text } from '@/design';

import { COPY } from './copy';

const PERIODS: ReadonlyArray<{ key: keyof typeof COPY.periods; range: ReportRange }> = [
  { key: 'last7', range: { last: 7, unit: 'day' } },
  { key: 'last4w', range: { last: 4, unit: 'week' } },
  { key: 'last6m', range: { last: 6, unit: 'month' } },
  { key: 'all', range: 'all' },
];

function Choices<T>({ label, options, value, onChange }: {
  label: string; options: ReadonlyArray<{ key: string; label: string; value: T }>; value: string; onChange: (v: T, key: string) => void;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Text variant="caption" tone="muted">{label}</Text>
      <View role="radiogroup" accessibilityLabel={label} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {options.map((o) => <Chip key={o.key} label={o.label} role="radio" selected={o.key === value} onPress={() => onChange(o.value, o.key)} />)}
      </View>
    </View>
  );
}

export function ReportBuilder({ spec, onShow }: { spec: KalamSpec; onShow: (def: ReportDefinition) => void }) {
  const collections = Object.keys(spec.collections);
  const [collection, setCollection] = useState(collections[0] ?? '');
  const [measureKey, setMeasureKey] = useState('count');
  const [splitKey, setSplitKey] = useState('none');
  const [periodKey, setPeriodKey] = useState<string>('last4w');
  const [dateKey, setDateKey] = useState('');
  const fields = useMemo(() => reportableFields(spec, collection), [spec, collection]);
  const periods = PERIODS.map((p) => ({ key: p.key, label: COPY.periods[p.key], value: p.range }));
  const pick = <T,>(list: ReadonlyArray<{ key: string; value: T }>, key: string): T => (list.find((o) => o.key === key) ?? list[0]!).value;
  const period = pick(periods, periodKey);

  const measures = [
    { key: 'count', label: COPY.count, value: { operation: 'count' } as ReportChoice['measure'] },
    ...fields.numbers.flatMap((f) => [
      { key: `sum:${f.id}`, label: COPY.total(lower(f.label)), value: { operation: 'sum', field: f.id } as ReportChoice['measure'] },
      { key: `average:${f.id}`, label: COPY.average(lower(f.label)), value: { operation: 'average', field: f.id } as ReportChoice['measure'] },
    ]),
  ];
  const splits = [
    { key: 'none', label: COPY.nothing, value: { kind: 'none' } as ReportChoice['split'] },
    ...fields.groups.map((f) => ({ key: `field:${f.id}`, label: f.label, value: { kind: 'field', field: f.id } as ReportChoice['split'] })),
    // Only splits that fit the period: no "by month" for the last 7 days.
    ...TIME_UNITS.filter((u) => timeSplitFits(period, u))
      .map((u) => ({ key: `time:${u}`, label: COPY.unit[u], value: { kind: 'time', unit: u } as ReportChoice['split'] })),
  ];
  const split = splits.some((o) => o.key === splitKey) ? splitKey : 'none';
  // With more than one date field the person says which one the period uses.
  const dateChoices = [
    ...fields.dates.map((f) => ({ key: `date:${f.id}`, label: f.label, value: f.id as ReportChoice['dateField'] })),
    { key: 'added', label: COPY.whenAdded, value: null as ReportChoice['dateField'] },
  ];
  const dates = dateChoices.some((o) => o.key === dateKey) ? dateKey : dateChoices[0]!.key;

  return (
    <View style={{ gap: 16 }}>
      {collections.length > 1 ? (
        <Choices
          label={COPY.list}
          options={collections.map((c) => ({ key: c, label: collectionName(spec, c), value: c }))}
          value={collection}
          onChange={(c) => { setCollection(c); setMeasureKey('count'); setSplitKey('none'); setDateKey(''); }}
        />
      ) : null}
      <Choices label={COPY.measure} options={measures} value={measureKey} onChange={(_, k) => setMeasureKey(k)} />
      <Choices label={COPY.period} options={periods} value={periodKey} onChange={(_, k) => setPeriodKey(k)} />
      <Choices label={COPY.splitBy} options={splits} value={split} onChange={(_, k) => setSplitKey(k)} />
      {fields.dates.length > 1 ? <Choices label={COPY.datesFrom} options={dateChoices} value={dates} onChange={(_, k) => setDateKey(k)} /> : null}
      <Button
        label={COPY.showReport}
        variant="secondary"
        onPress={() => onShow(buildReport(spec, {
          collection, measure: pick(measures, measureKey), split: pick(splits, split), period, dateField: pick(dateChoices, dates),
        }))}
      />
    </View>
  );
}
