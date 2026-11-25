/**
 * Deterministic question → formula planning. Handles the everyday questions without any model:
 * "how many orders", "total amount this month", "average weight", "how many tasks are done".
 *
 * The rule that keeps it honest: every word of the question must be accounted for (a trigger word,
 * a collection, a field, a period, an enum option or a filler). If anything is left over, such as
 * "pending" or "more than 500", the planner steps aside and the on-device model gets the question,
 * so a qualifier is never silently dropped.
 */
import type { FormulaValue } from '../contracts';
import type { KalamCollection, KalamField, KalamSpec } from '../spec/schema';
import { collectionName, formatNumber, lower, mentions, namesOf, singular, stems, words } from './text';

export interface PlannedFormula {
  formula: string;
  /** Plain-language sentence for the calculated value. */
  say(value: FormulaValue): string;
}

/** Trigger words and fillers that carry no data meaning. Stemmed once, here. */
const STOP = new Set(stems(
  `how many much what whats which is are was were do does did i we you me my mine have has had there the a an of in on for
   to all so far now right currently at this tell give show please can number count total sum add up altogether overall
   average avg mean highest largest biggest maximum max lowest smallest minimum min it that here app record entry item
   together each every`,
));

type Agg = 'count' | 'sum' | 'avg' | 'min' | 'max';
const ADJECTIVE: Record<Exclude<Agg, 'count'>, string> = { sum: 'total', avg: 'average', min: 'lowest', max: 'highest' };

export const NOTHING_YET = 'There is nothing to work out yet. Add some entries and ask again.';

const aggregateOf = (n: string): Agg | undefined => {
  if (/\b(average|avg|mean)\b/.test(n)) return 'avg';
  if (/\b(highest|largest|biggest|maximum|max)\b/.test(n)) return 'max';
  if (/\b(lowest|smallest|minimum|min)\b/.test(n)) return 'min';
  if (/\b(how many|number of|count)\b/.test(n)) return 'count';
  if (/\b(total|sum|add up|altogether)\b/.test(n)) return 'sum';
  return undefined;
};

export function planFormula(spec: KalamSpec, question: string): PlannedFormula | undefined {
  const n = words(question).join(' ');
  const agg = aggregateOf(n);
  if (!agg) return undefined;
  const qs = stems(question);
  const qset = new Set(qs);
  const left = new Set(qs);
  const eat = (tokens: readonly string[]) => tokens.forEach((t) => left.delete(t));

  // Collection: mentioned by name, or the only one the app has.
  const all = Object.entries(spec.collections);
  const named = all.filter(([id, c]) => namesOf(c.label, id).some((t) => mentions(t, qset)));
  if (named.length > 1) return undefined;
  let target: [string, KalamCollection] | undefined = named[0] ?? (all.length === 1 && agg === 'count' ? all[0] : undefined);
  if (named[0]) namesOf(named[0][1].label, named[0][0]).filter((t) => mentions(t, qset)).forEach(eat);

  // Field for sum / avg / min / max: the best-named number field, or the only one there is.
  let field: { id: string; def: KalamField } | undefined;
  if (agg !== 'count') {
    const pool = named[0] ? [named[0]] : all;
    const numbers = pool.flatMap(([cid, c]) => Object.entries(c.fields)
      .filter(([, f]) => f.type === 'number')
      .map(([fid, def]) => ({ cid, fid, def, score: Math.max(0, ...namesOf(def.label, fid).filter((t) => mentions(t, qset)).map((t) => t.length)) })));
    const best = Math.max(0, ...numbers.map((x) => x.score));
    const hits = best > 0 ? numbers.filter((x) => x.score === best) : numbers.length === 1 ? numbers : [];
    if (hits.length !== 1) return undefined;
    const hit = hits[0];
    namesOf(hit.def.label, hit.fid).filter((t) => mentions(t, qset)).forEach(eat);
    field = { id: hit.fid, def: hit.def };
    target = all.find(([id]) => id === hit.cid);
  }
  if (!target) return undefined;
  const [cid, collection] = target;

  // Period: "today" / "this month" need exactly one sensible date field.
  const today = /\btoday\b/.test(n);
  const month = /\bthis month\b/.test(n);
  if (today && month) return undefined;
  const conditions: string[] = [];
  let period = '';
  if (today || month) {
    const dates = Object.entries(collection.fields).filter(([, f]) => f.type === 'date');
    const dateId = dates.length === 1 ? dates[0][0] : dates.find(([id, f]) => id === 'date' || stems(f.label).join(' ') === 'date')?.[0];
    if (!dateId) return undefined;
    conditions.push(today ? `${dateId} == today` : `month(${dateId}) == month(today)`);
    period = today ? ' today' : ' this month';
    eat(today ? ['today'] : stems('this month'));
  }

  // Enum values named in the question ("done", "Food") become exact-match filters.
  const qualifiers: string[] = [];
  for (const [fid, def] of Object.entries(collection.fields)) {
    if (def.type !== 'enum') continue;
    const hits = def.options.filter((o) => {
      const t = stems(o);
      return t.length > 0 && t.every((x) => left.has(x)) && !/['\\]/.test(o);
    });
    if (hits.length > 1) return undefined;
    if (hits[0]) {
      conditions.push(`${fid} == '${hits[0]}'`);
      qualifiers.push(` with ${lower(def.label)} ${hits[0]}`);
      eat(stems(hits[0]));
    }
  }

  if ([...left].some((t) => !STOP.has(t))) return undefined;

  const base = conditions.length ? `filter(${cid}, ${conditions.join(' && ')})` : cid;
  const formula = agg === 'count' ? `count(${base})` : `${agg}(${base}.${field?.id})`;
  const tail = `${qualifiers.join('')}${period}`;
  const label = collectionName(spec, cid);
  return {
    formula,
    say(value) {
      if (typeof value !== 'number') return NOTHING_YET;
      const num = formatNumber(value, spec.lang);
      if (agg === 'count') return `You have ${num} ${value === 1 ? lower(singular(label)) : lower(label)}${tail}.`;
      const unit = field?.def.type === 'number' && field.def.unit ? ` ${field.def.unit}` : '';
      return `The ${ADJECTIVE[agg]} ${lower(field?.def.label ?? 'value')}${tail} is ${num}${unit}.`;
    },
  };
}
