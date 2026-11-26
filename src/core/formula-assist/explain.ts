/**
 * Formula to plain English (docs/14 §8.2 step 6). Deterministic: a model never words the explanation,
 * so the sentence the person reads is exactly what the formula does. Covers every function, operator,
 * filter and the `where` shorthand (which the parser has already turned into filter()). Names come from
 * the app's own labels. Anything it does not know becomes a safe generic phrase.
 */
import { formatNumber, humanize, lower } from '../assistant';
import { compileFormula, type FormulaFunction } from '../formula';
import { isCall, isFilterCall, isIdent, type Bin, type Call, type Cond, type Ident, type Lit, type Member, type Node, type Un } from '../formula/parse';
import type { KalamSpec } from '../spec/schema';
import { COPY } from './copy';
import { type AssistScope, assistScope } from './scope';

/** A phrase and how tightly it binds: 0 loose, 1 or, 2 and, 3 equals, 4 order, 5 add, 6 multiply, 7 sign, 9 whole. */
interface Phrase { t: string; p: number }
const ATOM = 9;
const atom = (t: string): Phrase => ({ t, p: ATOM });
const loose = (t: string): Phrase => ({ t, p: 0 });
const wrap = (x: Phrase, min: number): string => (x.p < min ? `(${x.t})` : x.t);

interface Env { spec: KalamSpec; a: AssistScope; refs: Set<string>; record?: string }
class Unsupported extends Error {}

const collectionLabel = (env: Env, id: string): string => lower(env.spec.collections[id]?.label || humanize(id));
const fieldOf = (env: Env, coll: string, id: string) => {
  const fields = Object.hasOwn(env.spec.collections, coll) ? env.spec.collections[coll]?.fields : undefined;
  return fields && Object.hasOwn(fields, id) ? fields[id] : undefined;
};
const fieldLabel = (env: Env, coll: string, id: string): string => lower(fieldOf(env, coll, id)?.label || humanize(id));
function ref(env: Env, coll: string, id: string): void {
  env.refs.add(`${env.spec.collections[coll]?.label || humanize(coll)}: ${fieldOf(env, coll, id)?.label || humanize(id)}`);
}
const joinAnd = (items: string[]): string =>
  items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} ${COPY.and} ${items[items.length - 1]}`;

// ─── Lists of entries: a collection, or filter(...) of one ─────────────────────────────────────────
interface Entries { coll: string; conds: Phrase[] }

function entriesOf(node: Node, env: Env): Entries | undefined {
  if (isIdent(node)) {
    const isField = !!env.record && !!fieldOf(env, env.record, node.name);
    return !isField && Object.hasOwn(env.spec.collections, node.name) ? { coll: node.name, conds: [] } : undefined;
  }
  if (!isFilterCall(node)) return undefined;
  const [source, predicate] = node.arguments;
  const base = source && entriesOf(source, env);
  if (!base || !predicate) return undefined;
  return { coll: base.coll, conds: [...base.conds, phrase(predicate, { ...env, record: base.coll })] };
}

/** "expenses" or "expenses where category is “Food” and date is today". */
function entriesText(e: Entries, env: Env): string {
  env.refs.add(env.spec.collections[e.coll]?.label || humanize(e.coll));
  const label = collectionLabel(env, e.coll);
  if (!e.conds.length) return label;
  return COPY.entriesWhere(label, e.conds.map((c) => (e.conds.length > 1 ? wrap(c, 2) : c.t)).join(` ${COPY.and} `));
}

const asMember = (n: Node): Member | undefined =>
  n.type === 'MemberExpression' && !(n as Member).computed && isIdent((n as Member).property) ? (n as Member) : undefined;

// ─── Functions. Typed over FormulaFunction, so a new function in the grammar fails to compile until described. ──
function aggregate(fn: 'sum' | 'avg' | 'min' | 'max', c: Call, env: Env): Phrase {
  const m = c.arguments.length === 1 && c.arguments[0] ? asMember(c.arguments[0]) : undefined;
  const entries = m && entriesOf(m.object, env);
  if (m && entries) {
    const id = (m.property as Ident).name;
    ref(env, entries.coll, id);
    const isDate = fieldOf(env, entries.coll, id)?.type === 'date';
    const word = isDate && fn === 'min' ? COPY.wordFor.earliest : isDate && fn === 'max' ? COPY.wordFor.latest : COPY.wordFor[fn];
    return atom(COPY.aggregate(word, fieldLabel(env, entries.coll, id), entriesText(entries, env)));
  }
  const args = c.arguments.map((a) => phrase(a, env));
  return atom(COPY.aggregateOf(COPY.wordFor[fn], joinAnd(args.map((x) => (args.length > 1 ? wrap(x, ATOM) : x.t)))));
}

function count(c: Call, env: Env): Phrase {
  const only = c.arguments.length === 1 ? c.arguments[0] : undefined;
  const entries = only && entriesOf(only, env);
  if (entries) return atom(COPY.numberOf(entriesText(entries, env)));
  const m = only && asMember(only);
  const owner = m && entriesOf(m.object, env);
  if (m && owner) {
    const id = (m.property as Ident).name;
    ref(env, owner.coll, id);
    return atom(COPY.filledIn(fieldLabel(env, owner.coll, id), entriesText(owner, env)));
  }
  const args = c.arguments.map((a) => phrase(a, env));
  return atom(COPY.filledInAmong(joinAnd(args.map((x) => wrap(x, ATOM)))));
}

/** A number written directly in the formula, with an optional sign (-1 is a minus sign and a 1 to the parser). */
function constantNumber(n: Node): number | undefined {
  if (n.type === 'Literal') return typeof (n as Lit).value === 'number' ? ((n as Lit).value as number) : undefined;
  if (n.type === 'UnaryExpression' && ((n as Un).operator === '-' || (n as Un).operator === '+')) {
    const inner = constantNumber((n as Un).argument);
    return inner === undefined ? undefined : (n as Un).operator === '-' ? -inner : inner;
  }
  return undefined;
}

const FUNCTIONS: Record<FormulaFunction, (c: Call, env: Env) => Phrase> = {
  sum: (c, env) => aggregate('sum', c, env),
  avg: (c, env) => aggregate('avg', c, env),
  min: (c, env) => aggregate('min', c, env),
  max: (c, env) => aggregate('max', c, env),
  count,
  filter: (c, env) => {
    const entries = entriesOf(c, env);
    if (!entries) throw new Unsupported();
    return atom(COPY.the(entriesText(entries, env)));
  },
  if: (c, env) => conditional(c.arguments[0], c.arguments[1], c.arguments[2], env),
  round: (c, env) => {
    const [x, digits] = c.arguments;
    if (!x) throw new Unsupported();
    // The engine keeps digits between 0 and 10, so the sentence says the same.
    const known = digits ? constantNumber(digits) : undefined;
    const d = known === undefined ? undefined : Math.min(10, Math.max(0, Math.trunc(known)));
    const unknownDigits = digits && known === undefined ? phrase(digits, env) : undefined;
    const tail = unknownDigits ? COPY.roundingBy(wrap(unknownDigits, ATOM)) : COPY.rounding(d);
    return loose(`${wrap(phrase(x, env), 1)}, ${tail}`);
  },
  abs: (c, env) => loose(`${wrap(phrase(need(c.arguments[0]), env), 1)}, ${COPY.noSign}`),
  len: (c, env) => {
    const arg = need(c.arguments[0]);
    const entries = entriesOf(arg, env);
    if (entries) return atom(COPY.numberOf(entriesText(entries, env)));
    const m = asMember(arg);
    const owner = m && entriesOf(m.object, env);
    if (m && owner) {
      const id = (m.property as Ident).name;
      ref(env, owner.coll, id);
      return atom(COPY.valuesIn(fieldLabel(env, owner.coll, id), entriesText(owner, env)));
    }
    return atom(COPY.charactersIn(wrap(phrase(arg, env), ATOM)));
  },
  concat: (c, env) => loose(`${joinAnd(c.arguments.map((a) => wrap(phrase(a, env), ATOM)))} ${COPY.joined}`),
  month: (c, env) => atom(COPY.monthOf(wrap(phrase(need(c.arguments[0]), env), ATOM))),
  week: (c, env) => atom(COPY.weekOf(wrap(phrase(need(c.arguments[0]), env), ATOM))),
  streak: (c, env) => atom(COPY.streakOf(wrap(phrase(need(c.arguments[0]), env), ATOM))),
};

function need(n: Node | undefined): Node {
  if (!n) throw new Unsupported();
  return n;
}

function conditional(test: Node | undefined, a: Node | undefined, b: Node | undefined, env: Env): Phrase {
  return loose(COPY.whenOtherwise(wrap(phrase(need(a), env), 1), phrase(need(test), env).t, wrap(phrase(need(b), env), 1)));
}

// ─── Operators ────────────────────────────────────────────────────────────────────────────────────
const BINARY: Readonly<Record<string, readonly [number, string]>> = {
  '||': [1, COPY.or], '&&': [2, COPY.and],
  '==': [3, COPY.is], '!=': [3, COPY.isNot],
  '<': [4, COPY.lessThan], '<=': [4, COPY.atMost], '>': [4, COPY.moreThan], '>=': [4, COPY.atLeast],
  '+': [5, COPY.plus], '-': [5, COPY.minus], '*': [6, COPY.times], '/': [6, COPY.dividedBy],
};
const ASSOCIATIVE = new Set(['||', '&&', '+', '*']);

const monthArg = (n: Node): Node | undefined => (isCall(n) && isIdent(n.callee) && n.callee.name === 'month' ? n.arguments[0] : undefined);
const isNow = (n: Node | undefined): boolean => !!n && isIdent(n) && (n.name === 'today' || n.name === 'now');

function binary(b: Bin, env: Env): Phrase {
  const op = b.operator === '===' ? '==' : b.operator === '!==' ? '!=' : b.operator;
  const [l, r] = [monthArg(b.left), monthArg(b.right)];
  if ((op === '==' || op === '!=') && l && r) {
    const negate = op === '!=';
    if (isNow(r)) return { t: `${phrase(l, env).t} ${negate ? COPY.isNot : COPY.is} ${COPY.thisMonth}`, p: 3 };
    if (isNow(l)) return { t: `${phrase(r, env).t} ${negate ? COPY.isNot : COPY.is} ${COPY.thisMonth}`, p: 3 };
    return { t: `${phrase(l, env).t} ${COPY.and} ${phrase(r, env).t} ${negate ? COPY.areNot : COPY.are} ${COPY.sameMonth}`, p: 3 };
  }
  const left = phrase(b.left, env);
  const right = phrase(b.right, env);
  if (op === '%') return atom(COPY.remainder(wrap(left, 6), wrap(right, 7)));
  const entry = BINARY[op];
  if (!entry) throw new Unsupported();
  const [prec, word] = entry;
  return { t: `${wrap(left, prec)} ${word} ${wrap(right, ASSOCIATIVE.has(op) ? prec : prec + 1)}`, p: prec };
}

// ─── Values and names ─────────────────────────────────────────────────────────────────────────────
function identifier(name: string, env: Env): Phrase {
  if (name === 'today') return atom(COPY.today);
  if (name === 'now') return atom(COPY.currentTime);
  if (env.record && fieldOf(env, env.record, name)) {
    ref(env, env.record, name);
    return atom(fieldLabel(env, env.record, name));
  }
  if (Object.hasOwn(env.spec.collections, name)) return atom(COPY.allOf(entriesText({ coll: name, conds: [] }, env)));
  if (name === 'selected') return atom(COPY.openedEntry);
  return atom(lower(humanize(name)));
}

function member(m: Member, env: Env): Phrase {
  const prop = (m.property as Ident).name;
  if (isIdent(m.object) && m.object.name === 'form') {
    const label = lower(env.a.form[prop]?.label ?? humanize(prop));
    env.refs.add(env.a.form[prop]?.label ?? humanize(prop));
    return atom(label);
  }
  if (isIdent(m.object) && m.object.name === 'state') {
    const label = env.a.counters[prop] ?? humanize(prop);
    env.refs.add(label);
    return atom(COPY.counterNamed(lower(label)));
  }
  const entries = entriesOf(m.object, env);
  if (!entries) throw new Unsupported();
  ref(env, entries.coll, prop);
  return atom(COPY.everyEntry(fieldLabel(env, entries.coll, prop), entriesText(entries, env)));
}

function literal(n: Lit, env: Env): Phrase {
  const v = n.value;
  if (v === null) return atom(COPY.empty);
  if (typeof v === 'number') return atom(formatNumber(v, env.spec.lang));
  if (typeof v === 'string') return atom(`“${v}”`);
  if (typeof v === 'boolean') return atom(v ? COPY.yes : COPY.no);
  throw new Unsupported();
}

function inner(node: Node, env: Env): Phrase {
  switch (node.type) {
    case 'Literal': return literal(node as Lit, env);
    case 'Identifier': return identifier((node as Ident).name, env);
    case 'MemberExpression': return member(node as Member, env);
    case 'CallExpression': {
      const c = node as Call;
      const fn = isIdent(c.callee) ? c.callee.name : '';
      if (!Object.hasOwn(FUNCTIONS, fn)) throw new Unsupported();
      return FUNCTIONS[fn as FormulaFunction](c, env);
    }
    case 'BinaryExpression': return binary(node as Bin, env);
    case 'UnaryExpression': {
      const u = node as Un;
      const x = phrase(u.argument, env);
      if (u.operator === '+') return x;
      if (u.operator === '!') return { t: `${COPY.not} ${wrap(x, 7)}`, p: 7 };
      if (u.operator === '-') return u.argument.type === 'Literal' ? atom(`-${x.t}`) : { t: `${COPY.minus} ${wrap(x, 7)}`, p: 7 };
      throw new Unsupported();
    }
    case 'ConditionalExpression': {
      const t = node as Cond;
      return conditional(t.test, t.consequent, t.alternate, env);
    }
    default: throw new Unsupported();
  }
}

/** One node, or a safe generic phrase when it is something this describer does not know. */
function phrase(node: Node, env: Env): Phrase {
  try {
    return inner(node, env);
  } catch (e) {
    if (e instanceof Unsupported) return atom(COPY.unknownPart);
    throw e;
  }
}

export interface FormulaDescription {
  explanation: string;
  /** Collections, fields and counters the formula reads, as people name them. */
  references: string[];
}

export interface DescribeOptions {
  /** Screen the formula sits on, for the labels of typed values (`form.<id>`). */
  screenId?: string;
  scope?: AssistScope;
}

export function describeFormula(formula: string, spec: KalamSpec, opts: DescribeOptions = {}): FormulaDescription {
  const compiled = compileFormula(formula);
  if (!compiled.ok) return { explanation: COPY.unreadable, references: [] };
  const env: Env = { spec, a: opts.scope ?? assistScope(spec, opts.screenId), refs: new Set() };
  try {
    return { explanation: `${COPY.shows} ${phrase(compiled.ast, env).t}.`, references: [...env.refs] };
  } catch {
    return { explanation: `${COPY.shows} ${COPY.unknownPart}.`, references: [...env.refs] };
  }
}

/** docs/14 §8.2 step 6: the formula in plain English, using the app's own field and collection labels. */
export const explainFormula = (formula: string, spec: KalamSpec, opts?: DescribeOptions): string =>
  describeFormula(formula, spec, opts).explanation;

/** Names of the grammar functions this describer covers; a test compares it with the parser's list. */
export const DESCRIBED_FUNCTIONS: readonly string[] = Object.keys(FUNCTIONS);
