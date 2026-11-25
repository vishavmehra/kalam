/**
 * Sample values for a formula (docs/14 §8.2 step 7, §8.5). The formula is calculated here, on this
 * device, by the formula engine. It reads the person's own entries when every collection it uses has
 * some. Otherwise it uses made-up entries and says so. Typed values (`form.x`) are always made up,
 * because nothing has been typed yet. Nothing in this file talks to a model.
 */
import type { KeyValueRepository, RecordRepository, RecordValue } from '../contracts';
import { evaluateFormula, formulaDependencies, localDate } from '../formula';
import { formatNumber, humanize } from '../assistant';
import type { KalamSpec } from '../spec/schema';
import { COPY } from './copy';
import type { AssistScope, FieldShape } from './scope';
import { shapeOf } from './scope';
import type { SampleInput, SampleValues } from './types';

const ROWS = 5;
const NUMBERS = [120, 80, 300, 45, 210];
const TYPED_NUMBERS = [1000, 250, 40, 12, 7];
const DAYS_BACK = [0, 0, 2, 12, 45];
const SAMPLE_COUNTER = 3;

const clamp = (v: number, f: FieldShape): number => Math.min(f.max ?? Infinity, Math.max(f.min ?? -Infinity, v));
const daysAgo = (now: Date, n: number): string => localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - n));

function sampleCell(f: FieldShape, i: number, now: Date): RecordValue {
  switch (f.type) {
    case 'number': return clamp(NUMBERS[i % NUMBERS.length] as number, f);
    case 'date': return daysAgo(now, DAYS_BACK[i % DAYS_BACK.length] as number);
    case 'boolean': return i % 2 === 0;
    case 'enum': return f.options?.[i % f.options.length] ?? null;
    default: return `${f.label} ${i + 1}`;
  }
}

/** Made-up entries for one collection. Dates run back from today so "today" and "this month" find some. */
export function sampleRows(spec: KalamSpec, collectionId: string, now: Date): Array<Record<string, RecordValue>> {
  const fields = Object.hasOwn(spec.collections, collectionId) ? Object.entries(spec.collections[collectionId]?.fields ?? {}) : [];
  return Array.from({ length: ROWS }, (_, i) => Object.fromEntries(fields.map(([id, def]) => [id, sampleCell(shapeOf(def), i, now)])));
}

/** A value for something the person would type. Choices use their first option. */
function typedSample(f: FieldShape | undefined, n: number, now: Date): RecordValue {
  if (!f) return TYPED_NUMBERS[n % TYPED_NUMBERS.length] as number;
  switch (f.type) {
    case 'number': return clamp(TYPED_NUMBERS[n % TYPED_NUMBERS.length] as number, f);
    case 'enum': return f.options?.[0] ?? null;
    case 'date': return localDate(now);
    case 'boolean': return true;
    default: return 'Sample';
  }
}

function show(v: unknown, lang: string): string {
  if (typeof v === 'number') return formatNumber(v, lang);
  if (typeof v === 'boolean') return v ? COPY.yesText : COPY.noText;
  return v === null || v === undefined ? COPY.noValue : String(v);
}

export interface SampleDeps {
  records?: Pick<RecordRepository, 'list'>;
  state?: Pick<KeyValueRepository, 'all'>;
  appId: string;
  now: Date;
}

export type SampleOutcome =
  | { ok: true; samples: SampleValues; warnings: string[] }
  | { ok: false; reason: 'calc_failed' | 'not_single_value' };

export async function computeSamples(spec: KalamSpec, formula: string, a: AssistScope, deps: SampleDeps): Promise<SampleOutcome> {
  const dep = formulaDependencies(formula);
  const ids = dep.collections.filter((id) => Object.hasOwn(spec.collections, id));
  const warnings: string[] = [];

  // The person's own entries, only for the collections the formula reads, and only if all of them have some.
  let real: Record<string, Array<Record<string, unknown>>> | undefined;
  if (ids.length && deps.records) {
    try {
      const read = await Promise.all(ids.map(async (id) => [id, (await deps.records!.list(deps.appId, id)).map((r) => r.values)] as const));
      if (read.every(([, rows]) => rows.length > 0)) real = Object.fromEntries(read);
    } catch {
      warnings.push(COPY.readFailed);
    }
  }
  const madeUpEntries = ids.length > 0 && !real;
  const collections = real ?? Object.fromEntries(ids.map((id) => [id, sampleRows(spec, id, deps.now)]));

  const inputs: SampleInput[] = [];
  const form: Record<string, unknown> = {};
  // In the order they sit on the screen, so the first value typed gets the biggest sample ("total", then "paid").
  const onScreen = Object.keys(a.form);
  const place = (id: string): number => (onScreen.includes(id) ? onScreen.indexOf(id) : onScreen.length);
  [...dep.form].sort((x, y) => place(x) - place(y)).forEach((id, n) => {
    const field = a.form[id];
    form[id] = typedSample(field, n, deps.now);
    inputs.push({ label: field?.label ?? humanize(id), value: show(form[id], spec.lang) });
  });

  let state: Record<string, unknown> = {};
  if (dep.state.length) {
    if (deps.state) {
      try { state = await deps.state.all(deps.appId); } catch { warnings.push(COPY.readFailed); }
    } else {
      dep.state.forEach((id) => {
        state[id] = SAMPLE_COUNTER;
        inputs.push({ label: a.counters[id] ?? humanize(id), value: String(SAMPLE_COUNTER) });
      });
    }
  }

  const result = evaluateFormula(formula, { collections, form, state, now: deps.now });
  if (!result.ok) return { ok: false, reason: 'calc_failed' };
  if (Array.isArray(result.value)) return { ok: false, reason: 'not_single_value' };
  const value = result.value as SampleValues['result'];
  if (value === null) warnings.push(COPY.warnNoValue);

  const typed = inputs.length > 0;
  const kind: SampleValues['kind'] = !ids.length && !typed && !dep.state.length ? 'constant' : madeUpEntries || typed ? 'examples' : 'entries';
  const entries = real ? Object.values(real).reduce((n, rows) => n + rows.length, 0) : undefined;
  const label =
    kind === 'constant' ? COPY.sampleConstant
      : kind === 'entries' ? (entries === undefined ? COPY.sampleCounters : COPY.sampleEntries(entries))
        : madeUpEntries && typed ? COPY.sampleExamplesBoth
          : madeUpEntries ? COPY.sampleExamplesEntries
            : real ? COPY.sampleMixed : COPY.sampleExamplesInputs;
  return {
    ok: true,
    warnings,
    samples: { kind, label, inputs, result: value, resultText: show(value, spec.lang), ...(kind === 'entries' ? { entries } : {}) },
  };
}
