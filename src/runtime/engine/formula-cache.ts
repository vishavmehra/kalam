/**
 * Formula memoisation (docs/09 §8.6, docs/05 §8.6). A result is reused only when everything the formula can see
 * is unchanged, so it is never stale. The key holds:
 *   app id, spec version, formula engine version, the expression, the content version of every collection the
 *   formula names, the form and counter values it reads, `selected` when it reads it, and today's date.
 *   The date is always in the key, not only for `today`: `streak(...)` reads the date inside the evaluator, so a
 *   formula can depend on the day without the word `today`. The cost is one recalculation a day.
 * A formula that reads `now` is not cached. A list predicate (`record` set) is not cached either.
 *
 * A collection's version moves only when its rows change in content. Rows are rebuilt on every records snapshot,
 * so identity says nothing; content is compared once per snapshot and shared by every formula. Editing the app
 * raises its spec version, which retires the whole cache. Pure TypeScript.
 */
import type { FormulaContext, FormulaResult } from '@/core/contracts';
import { formulaDependencies, localDate } from '@/core/formula';
import { evaluate } from './data';

/** Raise when the evaluator's meaning changes (a new function, a changed rule), so old answers are dropped. */
export const FORMULA_ENGINE_VERSION = 1;

type Rows = ReadonlyArray<Readonly<Record<string, unknown>>>;

function sameRow(a: Readonly<Record<string, unknown>>, b: Readonly<Record<string, unknown>>): boolean {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) if (!Object.prototype.hasOwnProperty.call(b, k) || a[k] !== b[k]) return false;
  return true;
}

function sameRows(a: Rows, b: Rows): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!sameRow(a[i], b[i])) return false;
  return true;
}

interface Reads {
  /** Collections named anywhere in the text; see `readsOf`. */
  names: string[];
  form: string[];
  state: string[];
  selected: boolean;
  now: boolean;
}

const readsMemo = new Map<string, Reads>();

/**
 * What an expression reads. form and state names come from formulaDependencies (exact). Collection names also
 * include every word of the text: formulaDependencies skips bare names inside a filter() test, but such a name
 * can be another collection (`filter(a, x == count(b))`), and missing it would leave a stale answer.
 */
function readsOf(expr: string): Reads {
  let r = readsMemo.get(expr);
  if (!r) {
    const d = formulaDependencies(expr);
    r = {
      names: [...new Set([...d.collections, ...(expr.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [])])].sort(),
      form: d.form, state: d.state,
      selected: /\bselected\b/.test(expr), now: /\bnow\b/.test(expr),
    };
    if (readsMemo.size >= 500) readsMemo.clear();
    readsMemo.set(expr, r);
  }
  return r;
}

export interface FormulaCache {
  readonly appId: string;
  readonly specVersion: number;
  evaluate(expr: string, ctx: FormulaContext, lang?: string): FormulaResult;
  clear(): void;
  readonly size: number;
  readonly stats: { hits: number; misses: number };
}

/** One cache per running app and spec version. `max` is the number of answers kept (oldest used leaves first). */
export function createFormulaCache(appId: string, specVersion: number, max = 300): FormulaCache {
  const answers = new Map<string, FormulaResult>();
  const seen = new Map<string, { rows: Rows; version: number }>();
  const stats = { hits: 0, misses: 0 };

  const versionOf = (name: string, rows: Rows | undefined): string => {
    if (!rows) return `${name}#-`;
    const entry = seen.get(name);
    if (!entry) seen.set(name, { rows, version: 1 });
    else if (entry.rows !== rows) {
      if (!sameRows(entry.rows, rows)) entry.version++;
      entry.rows = rows;
    }
    return `${name}#${seen.get(name)!.version}`;
  };
  const value = (v: unknown) => JSON.stringify(v ?? null);

  return {
    appId,
    specVersion,
    evaluate(expr, ctx, lang) {
      const r = readsOf(expr);
      if (ctx.record || r.now) return evaluate(expr, ctx, lang);
      const key = [
        appId, specVersion, FORMULA_ENGINE_VERSION, lang ?? '', expr,
        r.names.filter((n) => Object.prototype.hasOwnProperty.call(ctx.collections, n)).map((n) => versionOf(n, ctx.collections[n])).join(','),
        r.form.map((k) => `${k}=${value(ctx.form[k])}`).join(','),
        r.state.map((k) => `${k}=${value(ctx.state[k])}`).join(','),
        r.selected ? (ctx.selected ?? '') : '',
        localDate(ctx.now),
      ].join('\u0001');
      const hit = answers.get(key);
      if (hit) {
        stats.hits++;
        answers.delete(key);
        answers.set(key, hit);
        return hit;
      }
      stats.misses++;
      const result = evaluate(expr, ctx, lang);
      answers.set(key, result);
      if (answers.size > max) answers.delete(answers.keys().next().value as string);
      return result;
    },
    clear() {
      answers.clear();
      seen.clear();
    },
    get size() {
      return answers.size;
    },
    stats,
  };
}

const MAX_APPS = 8;
const caches = new Map<string, FormulaCache>();

/**
 * The cache for an app at a spec version. Asking with a new version drops the old one, so saving, restoring
 * or editing the design invalidates every cached answer of that app. At most 8 apps keep a cache.
 */
export function formulaCacheFor(appId: string, specVersion: number): FormulaCache {
  const have = caches.get(appId);
  if (have && have.specVersion === specVersion) return have;
  const next = createFormulaCache(appId, specVersion);
  caches.delete(appId);
  caches.set(appId, next);
  if (caches.size > MAX_APPS) caches.delete(caches.keys().next().value as string);
  return next;
}
