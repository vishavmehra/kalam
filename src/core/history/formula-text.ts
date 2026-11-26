/**
 * Plain-English reading of a KalamSpec formula, for history lines such as
 * "adds up Amount where Date is in this month". Uses the project's own formula parser (compileFormula), never evaluates anything.
 * Anything it does not recognise falls back to "works out a new calculation using ...", so it never invents meaning.
 */
import { compileFormula } from '../formula';
import { isCall, isIdent, type Bin, type Call, type Lit, type Member, type Node, type Un } from '../formula/parse';
import { joinWords } from './names';

export interface FormulaNames {
  collection(id: string): string;
  /** Label for a field of one collection. Always looks in that collection first, never at screen components. */
  field(collectionId: string, fieldId: string): string;
  /** Label for a component, counter or field id when no collection is known (`state.water`, `form.amount`). */
  name(id: string): string;
}

/** Reads a field name in the collection a condition is about. */
type Label = (fieldId: string) => string;

const isMember = (n: Node): n is Member => n.type === 'MemberExpression';
const isLit = (n: Node): n is Lit => n.type === 'Literal';
const isBin = (n: Node): n is Bin => n.type === 'BinaryExpression';
const isUn = (n: Node): n is Un => n.type === 'UnaryExpression';
const identName = (n: Node): string | undefined => (isIdent(n) ? n.name : undefined);
const callName = (n: Node): string | undefined => (isCall(n) ? identName(n.callee) : undefined);
const isToday = (n: Node): boolean => identName(n) === 'today';
const isMonthCall = (n: Node): n is Call => callName(n) === 'month';

const COMPARE_WORDS: Record<string, string> = {
  '==': 'is', '===': 'is', '!=': 'is not', '!==': 'is not',
  '>': 'is more than', '>=': 'is at least', '<': 'is less than', '<=': 'is at most',
};
const FLIPPED: Record<string, string> = { '>': '<', '>=': '<=', '<': '>', '<=': '>=' };
const TODAY_WORDS: Record<string, string> = {
  '==': 'is today', '===': 'is today', '!=': 'is not today', '!==': 'is not today', '>': 'is after today', '>=': 'is today or later',
  '<': 'is before today', '<=': 'is today or earlier',
};

function literalWords(n: Lit): string {
  if (typeof n.value === 'boolean') return n.value ? 'yes' : 'no';
  return String(n.value);
}

/**
 * Splits a condition into readable clauses such as "Kind is Credit". Undefined when any part is not understood.
 * Every clause names its field, so switching from one date field to another always reads differently.
 */
function clausesOf(cond: Node, label: Label): string[] | undefined {
  if (isBin(cond) && cond.operator === '&&') {
    const l = clausesOf(cond.left, label);
    const r = clausesOf(cond.right, label);
    return l && r ? [...l, ...r] : undefined;
  }
  const field = identName(cond);
  if (field) return [`${label(field)} is ticked`];
  if (isUn(cond) && cond.operator === '!') {
    const f = identName(cond.argument);
    return f ? [`${label(f)} is not ticked`] : undefined;
  }
  if (!isBin(cond) || !(cond.operator in COMPARE_WORDS)) return undefined;
  let { left, right, operator } = cond;
  // month(date) == month(today)
  if (isMonthCall(left) && isMonthCall(right) && (operator === '==' || operator === '===')) {
    const l = left.arguments[0];
    const r = right.arguments[0];
    const f = l && r ? (isToday(r) ? identName(l) : isToday(l) ? identName(r) : undefined) : undefined;
    return f ? [`${label(f)} is in this month`] : undefined;
  }
  // today on the left: flip so the field is on the left
  if (isToday(left) && !isToday(right)) {
    [left, right] = [right, left];
    operator = FLIPPED[operator] ?? operator;
  }
  const f = identName(left);
  if (!f || f === 'today') return undefined;
  if (isToday(right)) {
    const word = TODAY_WORDS[operator];
    return word ? [`${label(f)} ${word}`] : undefined;
  }
  if (isLit(right)) return [`${label(f)} ${COMPARE_WORDS[operator]} ${literalWords(right)}`];
  return undefined;
}

const clauseText = (clauses: string[]): string => `where ${joinWords(clauses)}`;

/**
 * The words for a filter condition, such as "where Date is today and Present is ticked".
 * `collection` is the set of entries the condition filters, so field names come from that set.
 */
export function describeCondition(src: string, names: FormulaNames, collection?: string): string | undefined {
  const c = compileFormula(src);
  if (!c.ok) return undefined;
  const clauses = clausesOf(c.ast, collection ? (f) => names.field(collection, f) : names.name);
  return clauses?.length ? clauseText(clauses) : undefined;
}

interface Phrase {
  verb: string;
  noun: string;
}

/** collection id, optional filter condition and optional field of an aggregate argument */
function sourceOf(arg: Node): { collection: string; filter?: Node; field?: string } | undefined {
  const fromCollection = (n: Node): { collection: string; filter?: Node } | undefined => {
    const id = identName(n);
    if (id) return { collection: id };
    if (callName(n) === 'filter') {
      const [coll, cond] = (n as Call).arguments;
      const inner = coll && identName(coll);
      return inner && cond ? { collection: inner, filter: cond } : undefined;
    }
    return undefined;
  };
  if (isMember(arg) && !arg.computed && isIdent(arg.property)) {
    const base = fromCollection(arg.object);
    return base ? { ...base, field: arg.property.name } : undefined;
  }
  return fromCollection(arg);
}

function aggregate(n: Call, names: FormulaNames): Phrase | undefined {
  const fn = callName(n);
  if (!fn || !['sum', 'avg', 'min', 'max', 'count'].includes(fn)) return undefined;
  const src = n.arguments[0] && sourceOf(n.arguments[0]);
  if (!src) return undefined;
  let tail = '';
  if (src.filter) {
    const clauses = clausesOf(src.filter, (f) => names.field(src.collection, f));
    if (!clauses) return undefined;
    tail = ` ${clauseText(clauses)}`;
  }
  if (fn === 'count') {
    const where = names.collection(src.collection);
    return { verb: `counts the entries in ${where}${tail}`, noun: `the number of entries in ${where}${tail}` };
  }
  if (!src.field) return undefined;
  const f = names.field(src.collection, src.field);
  switch (fn) {
    case 'sum': return { verb: `adds up ${f}${tail}`, noun: `the total of ${f}${tail}` };
    case 'avg': return { verb: `averages ${f}${tail}`, noun: `the average of ${f}${tail}` };
    case 'min': return { verb: `finds the lowest ${f}${tail}`, noun: `the lowest ${f}${tail}` };
    default: return { verb: `finds the highest ${f}${tail}`, noun: `the highest ${f}${tail}` };
  }
}

const OPERATOR_WORDS: Record<string, string> = { '+': 'plus', '-': 'minus', '*': 'times', '/': 'divided by' };
const PRECEDENCE: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2 };

/**
 * True when reading `child` out loud as part of `parent` would change the sum: `a - (b - c)` and `(a + b) * 2` have
 * no spoken form that keeps the brackets, so they are left to the generic sentence instead of being misread.
 */
function needsBrackets(parent: Bin, child: Node, side: 'left' | 'right'): boolean {
  if (!isBin(child) || !(child.operator in PRECEDENCE)) return false;
  const inner = PRECEDENCE[child.operator];
  const outer = PRECEDENCE[parent.operator];
  return inner < outer || (side === 'right' && inner === outer);
}

function phraseOf(n: Node, names: FormulaNames): Phrase | undefined {
  if (isCall(n)) {
    const name = callName(n);
    // abs is not read through: it changes what the number means.
    if (name === 'round' && n.arguments[0]) return phraseOf(n.arguments[0], names);
    return aggregate(n, names);
  }
  if (isLit(n) && typeof n.value === 'number') return { verb: `shows ${n.value}`, noun: String(n.value) };
  if (isBin(n) && n.operator in OPERATOR_WORDS) {
    if (needsBrackets(n, n.left, 'left') || needsBrackets(n, n.right, 'right')) return undefined;
    const l = phraseOf(n.left, names);
    const r = phraseOf(n.right, names);
    if (!l || !r) return undefined;
    const noun = `${l.noun} ${OPERATOR_WORDS[n.operator]} ${r.noun}`;
    return { verb: `works out ${noun}`, noun };
  }
  return undefined;
}

/** Names a formula mentions: form.amount, state.water, plain fields. Used for the fallback sentence. */
function mentions(n: Node, names: FormulaNames, out: string[] = []): string[] {
  if (isMember(n) && !n.computed && isIdent(n.property) && ['form', 'state'].includes(identName(n.object) ?? '')) {
    out.push(names.name(n.property.name));
    return out;
  }
  if (isCall(n)) {
    // The function name is not something the person typed a name for: only look inside its arguments.
    for (const arg of n.arguments) mentions(arg, names, out);
    return out;
  }
  if (isIdent(n)) {
    if (!['today', 'now', 'form', 'state', 'true', 'false'].includes(n.name)) out.push(names.name(n.name));
    return out;
  }
  for (const v of Object.values(n) as unknown[]) {
    const children = Array.isArray(v) ? v : [v];
    for (const child of children) {
      if (child && typeof child === 'object' && 'type' in child) mentions(child as Node, names, out);
    }
  }
  return out;
}

/**
 * A verb phrase that follows "now": "adds up Amount where Date is in this month". Undefined when the formula cannot be read.
 * Calculations it does not recognise get "works out a new calculation using Amount and Rate".
 */
export function describeFormula(src: string, names: FormulaNames): string | undefined {
  const c = compileFormula(src);
  if (!c.ok) return undefined;
  const known = phraseOf(c.ast, names);
  if (known) return known.verb;
  const used = [...new Set(mentions(c.ast, names))].slice(0, 3);
  return used.length ? `works out a new calculation using ${joinWords(used)}` : 'works out a new calculation';
}
