/**
 * Whitelist evaluator (docs/05 §8.5). Walks only AST shapes accepted by `checkStructure`, reads data
 * through own-property lookups (no prototype access), and stops after LIMITS.formulaSteps steps.
 * Semantics: null-safe (missing values → null, never throws to the caller), division by zero → null,
 * date strings 'YYYY-MM-DD' compare lexicographically, `today` is the local date, `now` epoch ms.
 */
import type { FormulaContext, FormulaResult, FormulaValue } from '../contracts';
import { addDays, parseCivil, startOf } from '../reports/dates';
import { LIMITS } from '../spec/schema';
import {
  compileFormula, isIdent, type Bin, type Call, type Cond, type Ident, type Lit, type Member, type Node, type Un,
} from './parse';

type Rec = Readonly<Record<string, unknown>>;
type Val = number | string | boolean | null | readonly unknown[];

class FormulaError extends Error {}

const NUMERIC = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i;
const own = (obj: object, k: string): boolean => Object.prototype.hasOwnProperty.call(obj, k);

/** Coerces a stored value to a formula value; anything exotic becomes null. */
function norm(v: unknown): Val {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' || typeof v === 'boolean') return v;
  return null;
}

export function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const t = v.trim();
    return t !== '' && NUMERIC.test(t) ? Number(t) : null;
  }
  return null;
}

export function truthy(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0 && !Number.isNaN(v);
  if (typeof v === 'string') return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

function text(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.map(text).filter(Boolean).join(', ');
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return String(v);
  return '';
}

function equals(a: Val, b: Val): boolean {
  if (a === null || b === null) return a === b;
  if (typeof a === typeof b) return a === b;
  const na = toNumber(a);
  const nb = toNumber(b);
  return na !== null && nb !== null && na === nb;
}

/** Negative/zero/positive, or null when the values are not comparable. */
function compare(a: Val, b: Val): number | null {
  if (a === null || b === null) return null;
  if (typeof a === 'string' && typeof b === 'string') {
    const na = toNumber(a);
    const nb = toNumber(b);
    if (na !== null && nb !== null) return na - nb;
    return a < b ? -1 : a > b ? 1 : 0;
  }
  const na = toNumber(a);
  const nb = toNumber(b);
  return na !== null && nb !== null ? na - nb : null;
}

const finite = (n: number): number | null => (Number.isFinite(n) ? n : null);

export function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function roundTo(x: number, digits: number): number {
  const f = 10 ** digits;
  return (Math.sign(x) * Math.round(Math.abs(x) * f * (1 + Number.EPSILON))) / f;
}

class Evaluator {
  private steps = 0;
  constructor(private readonly ctx: FormulaContext) {}

  private tick(n = 1): void {
    this.steps += n;
    if (this.steps > LIMITS.formulaSteps) throw new FormulaError('Formula is too complex to calculate');
  }

  private records(v: unknown, what: string): readonly Rec[] {
    if (!Array.isArray(v)) throw new FormulaError(`${what} needs a collection`);
    return v as readonly Rec[];
  }

  private flatten(args: Node[], record: Rec | undefined): unknown[] {
    const out: unknown[] = [];
    for (const a of args) {
      const v = this.eval(a, record);
      if (Array.isArray(v)) {
        this.tick(v.length);
        out.push(...v);
      } else out.push(v);
    }
    return out;
  }

  private identifier(name: string, record: Rec | undefined): Val {
    if (name === 'today') return localDate(this.ctx.now);
    if (name === 'now') return this.ctx.now.getTime();
    const cols = this.ctx.collections;
    if (record && own(record, name)) return norm(record[name]);
    if (own(cols, name)) return cols[name] ?? [];
    // The entry opened from a list (its id). A field or collection of that name wins, so old apps keep working.
    if (name === 'selected') return this.ctx.selected ?? null;
    if (record) return null; // field without a value on this record
    throw new FormulaError(`Unknown name "${name}"`);
  }

  private member(m: Member, record: Rec | undefined): Val {
    const prop = (m.property as Ident).name;
    if (isIdent(m.object)) {
      const obj = m.object.name;
      if (obj === 'form') return own(this.ctx.form, prop) ? norm(this.ctx.form[prop]) : null;
      if (obj === 'state') return own(this.ctx.state, prop) ? norm(this.ctx.state[prop]) : null;
    }
    const recs = this.records(this.eval(m.object, record), `".${prop}"`);
    this.tick(recs.length);
    return recs.map((r) => (r && typeof r === 'object' && own(r, prop) ? norm(r[prop]) : null));
  }

  private call(c: Call, record: Rec | undefined): Val {
    const fn = (c.callee as Ident).name;
    const args = c.arguments;
    switch (fn) {
      case 'if': {
        const [cond, a, b] = args as [Node, Node, Node];
        return truthy(this.eval(cond, record)) ? this.eval(a, record) : this.eval(b, record);
      }
      case 'filter': {
        const [source, predicate] = args as [Node, Node];
        const recs = this.records(this.eval(source, record), 'filter()');
        const kept: Rec[] = [];
        for (const r of recs) {
          this.tick();
          if (r && typeof r === 'object' && truthy(this.eval(predicate, r))) kept.push(r);
        }
        return kept;
      }
      case 'sum': {
        let total = 0;
        for (const v of this.flatten(args, record)) total += toNumber(v) ?? 0;
        return finite(total);
      }
      case 'count': {
        if (args.length === 1) {
          const v = this.eval(args[0] as Node, record);
          if (Array.isArray(v)) return v.filter((x) => x !== null && x !== undefined).length;
          return v === null ? 0 : 1;
        }
        return this.flatten(args, record).filter((x) => x !== null && x !== undefined).length;
      }
      case 'avg': {
        const nums = this.flatten(args, record).map(toNumber).filter((n): n is number => n !== null);
        return nums.length ? finite(nums.reduce((s, n) => s + n, 0) / nums.length) : null;
      }
      case 'min': case 'max': {
        const vals = this.flatten(args, record).map(norm).filter((v) => v !== null && !Array.isArray(v));
        if (!vals.length) return null;
        const pick = (a: Val, b: Val) => {
          const d = compare(a, b);
          if (d === null) return a;
          return fn === 'min' ? (d <= 0 ? a : b) : d >= 0 ? a : b;
        };
        const nums = vals.filter((v) => toNumber(v) !== null);
        // Dates/text compare as strings only when nothing numeric is present.
        const pool = nums.length ? nums.map((v) => toNumber(v) as number) : vals;
        return pool.reduce<Val>((acc, v) => pick(acc, v as Val), pool[0] as Val);
      }
      case 'round': {
        const x = toNumber(this.eval(args[0] as Node, record));
        if (x === null) return null;
        const d = args[1] ? toNumber(this.eval(args[1], record)) ?? 0 : 0;
        return finite(roundTo(x, Math.min(10, Math.max(0, Math.trunc(d)))));
      }
      case 'abs': {
        const x = toNumber(this.eval(args[0] as Node, record));
        return x === null ? null : Math.abs(x);
      }
      case 'len': {
        const v = this.eval(args[0] as Node, record);
        if (Array.isArray(v)) return v.length;
        return text(v).length;
      }
      case 'concat': return this.flatten(args, record).map(text).join('');
      case 'month': {
        // 'YYYY-MM' from a date ('YYYY-MM-DD…', e.g. `today`) or epoch ms (e.g. `now`), in local time.
        const v = this.eval(args[0] as Node, record);
        if (typeof v === 'string') return /^\d{4}-\d{2}/.test(v) ? v.slice(0, 7) : null;
        if (typeof v === 'number' && Number.isFinite(v)) return localDate(new Date(v)).slice(0, 7);
        return null;
      }
      case 'week': {
        // The Monday that starts the date's week, 'YYYY-MM-DD', so the year is always part of it.
        const v = this.eval(args[0] as Node, record);
        const date = typeof v === 'number' && Number.isFinite(v) ? localDate(new Date(v)) : parseCivil(v);
        return date ? startOf(date, 'week') : null;
      }
      case 'streak': {
        // Days in a row with an entry, ending today (or yesterday while today has none yet).
        const days = new Set(this.flatten(args, record).map(parseCivil).filter((d): d is string => !!d));
        const today = localDate(this.ctx.now);
        let day = days.has(today) ? today : addDays(today, -1);
        let n = 0;
        while (days.has(day)) {
          this.tick();
          n++;
          day = addDays(day, -1);
        }
        return n;
      }
      default: throw new FormulaError(`Function "${fn}" is not available`);
    }
  }

  private binary(op: string, left: Node, right: Node, record: Rec | undefined): Val {
    if (op === '&&') return truthy(this.eval(left, record)) && truthy(this.eval(right, record));
    if (op === '||') return truthy(this.eval(left, record)) || truthy(this.eval(right, record));
    const a = this.eval(left, record);
    const b = this.eval(right, record);
    switch (op) {
      case '==': case '===': return equals(a, b);
      case '!=': case '!==': return !equals(a, b);
      case '<': { const d = compare(a, b); return d !== null && d < 0; }
      case '<=': { const d = compare(a, b); return d !== null && d <= 0; }
      case '>': { const d = compare(a, b); return d !== null && d > 0; }
      case '>=': { const d = compare(a, b); return d !== null && d >= 0; }
      case '+': {
        const textual = (v: Val) => typeof v === 'string' && toNumber(v) === null;
        if (textual(a) || textual(b)) return text(a) + text(b);
        const x = toNumber(a);
        const y = toNumber(b);
        return x === null || y === null ? null : finite(x + y);
      }
      default: {
        const x = toNumber(a);
        const y = toNumber(b);
        if (x === null || y === null) return null;
        if (op === '-') return finite(x - y);
        if (op === '*') return finite(x * y);
        if (op === '/') return y === 0 ? null : finite(x / y);
        if (op === '%') return y === 0 ? null : finite(x % y);
        throw new FormulaError(`Operator "${op}" is not allowed`);
      }
    }
  }

  eval(node: Node, record: Rec | undefined): Val {
    this.tick();
    switch (node.type) {
      case 'Literal': return norm((node as Lit).value);
      case 'Identifier': return this.identifier((node as Ident).name, record);
      case 'MemberExpression': return this.member(node as Member, record);
      case 'CallExpression': return this.call(node as Call, record);
      case 'BinaryExpression': {
        const b = node as Bin;
        return this.binary(b.operator, b.left, b.right, record);
      }
      case 'UnaryExpression': {
        const u = node as Un;
        const v = this.eval(u.argument, record);
        if (u.operator === '!') return !truthy(v);
        const n = toNumber(v);
        if (n === null) return null;
        return u.operator === '-' ? -n : n;
      }
      case 'ConditionalExpression': {
        const t = node as Cond;
        return truthy(this.eval(t.test, record)) ? this.eval(t.consequent, record) : this.eval(t.alternate, record);
      }
      default: throw new FormulaError(`"${node.type}" is not allowed in formulas`);
    }
  }
}

/** Evaluates a formula against app data. Never throws. */
export function evaluateFormula(src: string, ctx: FormulaContext): FormulaResult {
  const compiled = compileFormula(src);
  if (!compiled.ok) return { ok: false, error: compiled.errors.join('; ') };
  try {
    const value = new Evaluator(ctx).eval(compiled.ast, ctx.record);
    return { ok: true, value: value as FormulaValue };
  } catch (e) {
    if (e instanceof FormulaError) return { ok: false, error: e.message };
    // RangeError (deep recursion) or anything unexpected: report, never crash the runtime.
    return { ok: false, error: 'Formula could not be calculated' };
  }
}
