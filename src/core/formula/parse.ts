/**
 * Formula parsing + AST whitelist (docs/05 §8.4). jsep parses; nothing from jsep's output is
 * trusted until `checkStructure` has accepted every node. Scope-aware checks (unknown fields,
 * collections, form/state keys) live in `validateFormula` (./validate.ts).
 */
import jsep from 'jsep';
import { LIMITS } from '../spec/schema';

export type Node = jsep.Expression;
export type Ident = jsep.Identifier;
export type Member = jsep.MemberExpression;
export type Call = jsep.CallExpression;
export type Lit = jsep.Literal;
export type Bin = jsep.BinaryExpression;
export type Un = jsep.UnaryExpression;
export type Cond = jsep.ConditionalExpression;

export const FORMULA_FUNCTIONS = [
  'sum', 'count', 'avg', 'min', 'max', 'filter', 'if', 'round', 'abs', 'len', 'concat', 'month',
] as const;
export type FormulaFunction = (typeof FORMULA_FUNCTIONS)[number];
const FUNCTION_SET: ReadonlySet<string> = new Set(FORMULA_FUNCTIONS);

/** `===`/`!==` are accepted as aliases of `==`/`!=` (models write them constantly). */
export const BINARY_OPS: ReadonlySet<string> = new Set([
  '+', '-', '*', '/', '%', '==', '!=', '===', '!==', '<', '<=', '>', '>=', '&&', '||',
]);
const UNARY_OPS: ReadonlySet<string> = new Set(['-', '+', '!']);

/** Names that can never appear as identifiers or properties (defence in depth). */
const FORBIDDEN_NAMES: ReadonlySet<string> = new Set([
  'constructor', 'prototype', 'this', 'window', 'globalthis', 'globalThis', 'self', 'document', 'eval',
  'function', 'Function', 'process', 'require', 'import', 'module', 'exports', 'undefined',
]);

const ARITY: Record<FormulaFunction, [number, number]> = {
  sum: [1, 50], count: [1, 50], avg: [1, 50], min: [1, 50], max: [1, 50], concat: [1, 50],
  filter: [2, 2], if: [3, 3], round: [1, 2], abs: [1, 1], len: [1, 1], month: [1, 1],
};

const MAX_DEPTH = 32;

export function isForbiddenName(name: string): boolean {
  return name.startsWith('_') || FORBIDDEN_NAMES.has(name);
}
export const isIdent = (n: Node): n is Ident => n.type === 'Identifier';
export const isCall = (n: Node): n is Call => n.type === 'CallExpression';
export const isFilterCall = (n: Node): n is Call =>
  isCall(n) && isIdent(n.callee) && n.callee.name === 'filter';

// ─── `where` sugar (docs/05 §8.1, ADR-031) ───────────────────────────────────
// `count(doses where date == today)` is shorthand for `count(filter(doses, date == today))`. The same
// works for sum, avg, min and max with a field: `sum(expenses.amount where category == 'Food')` means
// `sum(filter(expenses, category == 'Food').amount)`. jsep has no such operator, so a parse hook reads
// `<expression> where <expression>` into an internal node, and `rewriteWhere` turns every valid one
// into a plain filter() call before the whitelist runs. Anything left over is rejected by
// `checkStructure`, so no `where` node can ever reach the evaluator.
const WHERE_NODE = 'WhereExpression';
const WHERE_AGGREGATES: ReadonlySet<string> = new Set(['count', 'sum', 'avg', 'min', 'max']);
const IDENT_PART = /[\p{L}\p{N}_$]/u;
interface WhereNode { type: typeof WHERE_NODE; source: Node; condition: Node }
const isWhere = (n: unknown): n is WhereNode => typeof n === 'object' && n !== null && (n as { type?: unknown }).type === WHERE_NODE;
const isNode = (n: unknown): n is Node => typeof n === 'object' && n !== null && typeof (n as { type?: unknown }).type === 'string';

// ponytail: the hook is registered on jsep's shared parser, which only this module uses. It only fires
// where jsep would otherwise report a syntax error, so existing formulas parse exactly as before.
jsep.hooks.add('after-expression', function whereSugar(env) {
  const source = env.node;
  if (!source || !this.expr.startsWith('where', this.index) || IDENT_PART.test(this.expr.charAt(this.index + 5))) return;
  this.index += 5;
  this.gobbleSpaces();
  const condition = this.gobbleExpression();
  if (!condition) this.throwError('Expected a condition after where');
  if (isWhere(condition)) this.throwError('Use only one "where" in each argument');
  env.node = { type: WHERE_NODE, source, condition } as unknown as Node;
});

/** `source where condition` as a filter() call, or undefined when source is not a collection or a field of one. */
function whereToFilter({ source, condition }: WhereNode): Node | undefined {
  const filter = (collection: Node): Call =>
    ({ type: 'CallExpression', callee: { type: 'Identifier', name: 'filter' }, arguments: [collection, condition] }) as Call;
  const isCollection = (n: Node) => isIdent(n) || isFilterCall(n);
  if (isCollection(source)) return filter(source);
  const m = source as Member;
  if (m.type === 'MemberExpression' && !m.computed && isCollection(m.object)) return { ...m, object: filter(m.object) };
  return undefined;
}

/** Replaces `where` forms that sit directly inside count/sum/avg/min/max with filter() calls. */
function rewriteWhere(node: Node, depth = 0): Node {
  if (depth > MAX_DEPTH) return node; // checkStructure reports the nesting
  const n = node as unknown as Record<string, unknown>;
  for (const key of Object.keys(n)) {
    const v = n[key];
    if (Array.isArray(v)) n[key] = v.map((x) => (isNode(x) ? rewriteWhere(x, depth + 1) : x));
    else if (isNode(v)) n[key] = rewriteWhere(v, depth + 1);
  }
  if (isCall(node) && isIdent(node.callee) && WHERE_AGGREGATES.has(node.callee.name)) {
    node.arguments = node.arguments.map((a) => (isWhere(a) ? whereToFilter(a) ?? a : a));
  }
  return node;
}

function describeNode(type: string): string {
  switch (type) {
    case WHERE_NODE:
      return '"where" can only follow a collection (orders) or one of its fields (orders.amount), inside count(), sum(), avg(), min() or max()';
    case 'Compound': case 'SequenceExpression': return 'Only one expression is allowed (no "," or ";")';
    case 'ThisExpression': return '"this" is not allowed';
    case 'ArrayExpression': return 'Lists like [1, 2] are not allowed';
    default: return `"${type}" is not allowed in formulas`;
  }
}

/** Scope-free whitelist. Returns human-readable problems (empty = structurally safe). */
export function checkStructure(root: Node): string[] {
  const errors: string[] = [];
  const visit = (node: Node, depth: number): void => {
    if (depth > MAX_DEPTH) { errors.push('Formula is nested too deeply'); return; }
    switch (node.type) {
      case 'Literal': {
        const v = (node as jsep.Literal).value;
        if (!(v === null || typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean')) {
          errors.push('Unsupported literal');
        }
        return;
      }
      case 'Identifier': {
        const { name } = node as Ident;
        if (isForbiddenName(name)) errors.push(`"${name}" is not allowed`);
        return;
      }
      case 'MemberExpression': {
        const m = node as Member;
        if (m.computed) { errors.push('Square-bracket access is not allowed'); return; }
        if (m.optional) { errors.push('"?." is not allowed'); return; }
        if (!isIdent(m.property) || isForbiddenName(m.property.name)) {
          errors.push(`".${isIdent(m.property) ? m.property.name : '?'}" is not allowed`);
          return;
        }
        if (m.object.type === 'MemberExpression') {
          errors.push('Only one "." is allowed (for example orders.amount)');
          return;
        }
        if (!isIdent(m.object) && !isFilterCall(m.object)) {
          errors.push('"." can only follow a collection, form, state or filter(...)');
          return;
        }
        visit(m.object, depth + 1);
        return;
      }
      case 'CallExpression': {
        const c = node as Call;
        if (!isIdent(c.callee)) { errors.push('Only built-in functions can be called'); return; }
        const fn = c.callee.name;
        if (!FUNCTION_SET.has(fn)) { errors.push(`Function "${fn}" is not available`); return; }
        const [lo, hi] = ARITY[fn as FormulaFunction];
        if (c.arguments.length < lo || c.arguments.length > hi) {
          errors.push(`${fn}() takes ${lo === hi ? lo : `${lo} to ${hi}`} argument${hi === 1 ? '' : 's'}`);
        }
        if (fn === 'filter' && c.arguments[0] && !isIdent(c.arguments[0]) && !isFilterCall(c.arguments[0])) {
          errors.push('filter() needs a collection as its first argument');
        }
        for (const a of c.arguments) visit(a, depth + 1);
        return;
      }
      case 'BinaryExpression': {
        const b = node as jsep.BinaryExpression;
        if (!BINARY_OPS.has(b.operator)) { errors.push(`Operator "${b.operator}" is not allowed`); return; }
        visit(b.left, depth + 1);
        visit(b.right, depth + 1);
        return;
      }
      case 'UnaryExpression': {
        const u = node as jsep.UnaryExpression;
        if (!UNARY_OPS.has(u.operator)) { errors.push(`Operator "${u.operator}" is not allowed`); return; }
        visit(u.argument, depth + 1);
        return;
      }
      case 'ConditionalExpression': {
        const t = node as jsep.ConditionalExpression;
        visit(t.test, depth + 1);
        visit(t.consequent, depth + 1);
        visit(t.alternate, depth + 1);
        return;
      }
      default:
        errors.push(describeNode(node.type));
    }
  };
  visit(root, 0);
  return errors;
}

export type Compiled = { ok: true; ast: Node } | { ok: false; errors: string[] };

// ponytail: tiny unbounded-until-full cache, cleared wholesale; switch to LRU if formula churn grows.
const cache = new Map<string, Compiled>();
const CACHE_MAX = 512;

/** Parse + structural whitelist, memoised by source text. */
export function compileFormula(src: unknown): Compiled {
  if (typeof src !== 'string' || src.trim() === '') return { ok: false, errors: ['Formula is empty'] };
  if (src.length > LIMITS.formulaLength) {
    return { ok: false, errors: [`Formula is longer than ${LIMITS.formulaLength} characters`] };
  }
  const hit = cache.get(src);
  if (hit) return hit;
  let result: Compiled;
  try {
    const ast = rewriteWhere(jsep(src));
    const errors = checkStructure(ast);
    result = errors.length ? { ok: false, errors } : { ok: true, ast };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Could not read formula';
    result = { ok: false, errors: [`Syntax error: ${msg}`] };
  }
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(src, result);
  return result;
}
