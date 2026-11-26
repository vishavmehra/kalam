/**
 * Sample values for a formula (docs/14 §8.2 step 7, §8.5). The formula is calculated here, on this
 * device, by the formula engine. It reads the person's own entries when every collection it uses has
 * some. Otherwise it uses made-up entries and says so. Typed values (`form.x`) are always made up,
 * because nothing has been typed yet. Nothing in this file talks to a model.
 */
import type { KeyValueRepository, RecordRepository, RecordValue } from '../contracts';
import { evaluateFormula, formulaDependencies, localDate } from '../formula';
import { collectionName, formatNumber, humanize } from '../assistant';
import type { KalamSpec } from '../spec/schema';
import { COPY } from './copy';
import type { AssistScope, FieldShape } from './scope';
import { shapeOf } from './scope';
import type { SampleInput, SampleTable, SampleValues } from './types';

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
  /** Numbers the person typed into the example. They replace the made-up ones for number fields. */
  typed?: Readonly<Record<string, number>>;
}

export type SampleOutcome =
  | { ok: true; samples: SampleValues; warnings: string[] }
  | { ok: false; reason: 'calc_failed' | 'not_single_value' };

type Entries = Record<string, Array<Record<string, unknown>>>;

/** The person's own entries, only for the collections the formula reads, and only if all of them have some. */
async function readEntries(ids: readonly string[], deps: SampleDeps, warnings: string[]): Promise<Entries | undefined> {
  if (!ids.length || !deps.records) return undefined;
  try {
    const read = await Promise.all(ids.map(async (id) => [id, (await deps.records!.list(deps.appId, id)).map((r) => r.values)] as const));
    return read.every(([, rows]) => rows.length > 0) ? Object.fromEntries(read) : undefined;
  } catch {
    warnings.push(COPY.readFailed);
    return undefined;
  }
}

interface Counters { values: Record<string, unknown>; rows: SampleInput[]; madeUp: boolean }

/** Counters the formula reads. Real ones are listed with their real values. If they cannot be read, they are made up (3). */
async function readCounters(ids: readonly string[], a: AssistScope, lang: string, deps: SampleDeps, warnings: string[]): Promise<Counters> {
  const out: Counters = { values: {}, rows: [], madeUp: false };
  if (!ids.length) return out;
  let stored: Record<string, unknown> | undefined;
  if (deps.state) {
    try { stored = await deps.state.all(deps.appId); } catch { warnings.push(COPY.readCountersFailed); }
  }
  out.madeUp = !stored;
  for (const id of ids) {
    const value = stored ? (Object.hasOwn(stored, id) ? stored[id] : undefined) : SAMPLE_COUNTER;
    out.values[id] = value;
    out.rows.push({ label: a.counters[id] ?? humanize(id), value: show(value, lang) });
  }
  return out;
}

/** Every name written in the formula, outside quoted text. Over-approximate on purpose: it only picks table columns. */
const usedNames = (formula: string): Set<string> => new Set(formula.replace(/'(?:[^'\\]|\\.)*'/g, ' ').match(/[A-Za-z_]\w*/g) ?? []);

/** The made-up entries, with only the fields the formula reads, so the person can check the result by hand. */
function tablesOf(spec: KalamSpec, formula: string, entries: Entries): SampleTable[] {
  const used = usedNames(formula);
  return Object.entries(entries).map(([id, rows]) => {
    const fields = Object.entries(spec.collections[id]?.fields ?? {});
    const read = fields.filter(([fid]) => used.has(fid));
    const columns = read.length ? read : fields.slice(0, 1);
    return {
      title: collectionName(spec, id),
      columns: columns.map(([, f]) => f.label),
      rows: rows.map((row) => columns.map(([fid]) => show(row[fid], spec.lang))),
    };
  });
}

export async function computeSamples(spec: KalamSpec, formula: string, a: AssistScope, deps: SampleDeps): Promise<SampleOutcome> {
  const dep = formulaDependencies(formula);
  const ids = dep.collections.filter((id) => Object.hasOwn(spec.collections, id));
  const warnings: string[] = [];
  const real = await readEntries(ids, deps, warnings);
  const counters = await readCounters(dep.state, a, spec.lang, deps, warnings);

  // In the order they sit on the screen, so the first value typed gets the biggest sample ("total", then "paid").
  const onScreen = Object.keys(a.form);
  const place = (id: string): number => (onScreen.includes(id) ? onScreen.indexOf(id) : onScreen.length);
  const typedIds = [...dep.form].sort((x, y) => place(x) - place(y));

  const run = (entries: Entries | undefined): SampleOutcome => {
    const madeUpEntries = ids.length > 0 && !entries;
    const collections: Entries = entries ?? Object.fromEntries(ids.map((id) => [id, sampleRows(spec, id, deps.now)]));
    const inputs: SampleInput[] = [];
    const form: Record<string, unknown> = {};
    typedIds.forEach((id, n) => {
      const field = a.form[id];
      const given = deps.typed?.[id];
      form[id] = field?.type === 'number' && typeof given === 'number' && Number.isFinite(given) ? given : typedSample(field, n, deps.now);
      inputs.push({ id, label: field?.label ?? humanize(id), value: show(form[id], spec.lang), ...(field?.type === 'number' ? { editable: true } : {}) });
    });
    inputs.push(...counters.rows);

    const result = evaluateFormula(formula, { collections, form, state: counters.values, now: deps.now });
    if (!result.ok) return { ok: false, reason: 'calc_failed' };
    if (Array.isArray(result.value)) return { ok: false, reason: 'not_single_value' };
    const value = result.value as SampleValues['result'];
    const extra = value === null ? [COPY.warnNoValue] : [];

    const typed = typedIds.length > 0 || counters.madeUp;
    const kind: SampleValues['kind'] = !ids.length && !typed && !dep.state.length ? 'constant' : madeUpEntries || typed ? 'examples' : 'entries';
    const count = entries ? Object.values(entries).reduce((n, rows) => n + rows.length, 0) : undefined;
    const label =
      kind === 'constant' ? COPY.sampleConstant
        : kind === 'entries' ? (count === undefined ? COPY.sampleCounters : COPY.sampleEntries(count))
          : madeUpEntries && typed ? COPY.sampleExamplesBoth
            : madeUpEntries ? COPY.sampleExamplesEntries
              : entries ? COPY.sampleMixed : COPY.sampleExamplesInputs;
    return {
      ok: true,
      warnings: extra,
      samples: {
        kind, label, inputs, result: value, resultText: show(value, spec.lang),
        ...(kind === 'entries' && count !== undefined ? { entries: count } : {}),
        ...(madeUpEntries ? { tables: tablesOf(spec, formula, collections) } : {}),
      },
    };
  };

  const first = run(real);
  if (first.ok) return { ...first, warnings: [...warnings, ...first.warnings] };
  if (!real || first.reason !== 'calc_failed') return first;
  // The person's own entries are too many for the formula engine here. Show it on examples and say why.
  const retry = run(undefined);
  return retry.ok ? { ...retry, warnings: [...warnings, COPY.warnTooManyEntries, ...retry.warnings] } : first;
}
