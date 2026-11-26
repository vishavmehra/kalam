/**
 * Rule-based requests, tried before any model (docs/07: deterministic first).
 *  1. Sums, differences, products, quotients and percentages of the values typed on a screen
 *     ("total amount minus amount paid"), or of the stored number fields of an app that has no typed
 *     values on the screen ("remaining as total minus paid" gives sum(orders.total) - sum(orders.paid)).
 *     Every operand must match exactly one number field.
 *  2. Everyday count, total, average, lowest and highest questions about a collection, with today,
 *     this month and choice filters. That is the App Assistant's own planner, reused as it is.
 * The rule that keeps it honest: every word must be accounted for. Anything left over (an extra
 * qualifier, a percentage of something else, a word the rules do not know) hands the request to the
 * model instead of being dropped.
 */
import { namesOf, planFormula, stems, words } from '../assistant';
import type { KalamSpec } from '../spec/schema';
import type { AssistScope, NamedField } from './scope';

export { unsupportedPeriod } from './period';

const LEAD = new Set(stems(
  'calculate compute work out find get give me show tell what whats is are the a an my please can you how much many',
));
/** Words that end the name of the result: "calculate the remaining balance AS total minus paid". */
const CONNECTOR = new Set(stems('as is equals equal be by'));

/** A decimal point is swapped for this letter so "1.5" stays one word (words() would split it). */
const DEC = 'ǂ';
const NUM = new RegExp(`^\\d+(?:${DEC}\\d+)?$`);
const plain = (t: string): string => t.replace(DEC, '.');

/** The request as plain words: decimals stay whole, and "%" or "per cent" become the word "percent". */
const normalise = (request: string): string =>
  words(
    request.toLowerCase()
      .replace(/(\d)\.(?=\d)/g, `$1${DEC}`)
      .replace(/\bper\s+cent\b/g, ' percent ')
      .replace(/%/g, ' percent '),
  ).join(' ');

type Op = '+' | '-' | '*' | '/';
/** `prefixed` patterns may have words before the operator phrase ("calculate the balance by subtracting ..."). */
const PATTERNS: ReadonlyArray<{ re: RegExp; op: Op; swap?: boolean; prefixed?: boolean }> = [
  { re: /^(.*?)\bsubtract(?:ing|ed)? (.+?) from (.+)$/, op: '-', swap: true, prefixed: true },
  { re: /^(.*?)\bmultipl(?:y|ying|ied) (.+?) (?:by|and|with) (.+)$/, op: '*', prefixed: true },
  { re: /^(.*?)\bdivid(?:e|ing|ed) (.+?) by (.+)$/, op: '/', prefixed: true },
  { re: /^(.*?)\badd(?:ing)? (.+?) (?:and|to) (.+)$/, op: '+', prefixed: true },
  { re: /^(.+?) (?:minus|less|take away|without) (.+)$/, op: '-' },
  { re: /^(.+?) (?:plus|added to) (.+)$/, op: '+' },
  { re: /^(.+?) (?:times|multiplied by) (.+)$/, op: '*' },
  // "over" is not here on purpose: "the amount over the budget" is a comparison, not a division.
  { re: /^(.+?) (?:divided by|per) (.+)$/, op: '/' },
];
const PERCENT_OF = new RegExp(`^(.*?)\\b(\\d+(?:${DEC}\\d+)?) percent of (.+)$`);

const isNumeric = (f: NamedField): boolean =>
  f.type === 'number' || (f.type === 'enum' && !!f.options?.length && f.options.every((o) => o.trim() !== '' && Number.isFinite(Number(o))));

/** One thing a request can name: a typed value or a stored number field, as the formula writes it. */
interface Operand { expr: string; /** What it belongs to: `form`, or a collection id. A plain number has none. */ group: string; names: string[][] }

/** A number, or the one operand named by these tokens. */
function resolve(tokens: string[], cands: readonly Operand[]): Operand | undefined {
  const [first] = tokens;
  if (!first) return undefined;
  if (tokens.length === 1 && NUM.test(first)) return { expr: plain(first), group: '', names: [] };
  const within = cands.filter((c) => c.names.some((n) => tokens.every((t) => n.includes(t))));
  if (within.length === 1) return within[0];
  const exact = cands.filter((c) => c.names.some((n) => n.length === tokens.length && n.every((t, i) => t === tokens[i])));
  return exact.length === 1 ? exact[0] : undefined;
}

/** Left side: drop the name of the result ("... as") and leading filler words. */
function left(phrase: string): string[] {
  let t = stems(phrase);
  const at = t.reduce((last, w, i) => (CONNECTOR.has(w) ? i : last), -1);
  if (at >= 0) t = t.slice(at + 1);
  while (t.length && LEAD.has(t[0] as string)) t.shift();
  return t;
}
/** Right side, or a subtracted amount: drop filler words at both ends ("the amount paid please"). */
function right(phrase: string): string[] {
  const t = stems(phrase);
  while (t.length && LEAD.has(t[t.length - 1] as string)) t.pop();
  while (t.length && LEAD.has(t[0] as string)) t.shift();
  return t;
}
/** Words before an operator phrase are fine when they are filler, or the name of the result ("remaining balance by"). */
function prefixOk(before: string): boolean {
  const t = stems(before);
  while (t.length && LEAD.has(t[0] as string)) t.shift();
  return !t.length || CONNECTOR.has(t[t.length - 1] as string);
}

const compatible = (x: Operand, y: Operand): boolean => !x.group || !y.group || x.group === y.group;

function plan(request: string, cands: readonly Operand[]): string | undefined {
  const n = normalise(request);

  // "18 percent of price before tax", with nothing but filler in front of it.
  const pct = PERCENT_OF.exec(n);
  if (pct?.[2] && pct[3] && !left(pct[1] ?? '').length) {
    const of = resolve(right(pct[3]), cands);
    if (of) return `round(${of.expr} * ${plain(pct[2])} / 100, 2)`;
  }

  for (const { re, op, swap, prefixed } of PATTERNS) {
    const m = re.exec(n);
    if (!m) continue;
    const [before, a, b] = prefixed ? [m[1] ?? '', m[2], m[3]] : ['', m[1], m[2]];
    if (!a || !b || !prefixOk(before)) continue;
    const [l, r] = swap ? [b, a] : [a, b];
    const x = resolve(swap ? right(l) : left(l), cands);
    const tail = right(r);
    // "total plus 18%": add or take off a percentage of the first value. Any other use of a percentage is not guessed.
    if (tail.length === 2 && tail[1] === 'percent' && tail[0] && NUM.test(tail[0])) {
      if (x?.group && (op === '+' || op === '-')) return `round(${x.expr} * (1 ${op} ${plain(tail[0])} / 100), 2)`;
      continue;
    }
    const y = resolve(tail, cands);
    if (x && y && compatible(x, y)) return op === '/' ? `round(${x.expr} / ${y.expr}, 2)` : `${x.expr} ${op} ${y.expr}`;
  }
  return undefined;
}

/** Arithmetic on the values typed on the screen. */
export function planArithmetic(request: string, a: AssistScope): string | undefined {
  const cands = Object.values(a.form).filter(isNumeric).map((f): Operand => ({ expr: `form.${f.id}`, group: 'form', names: namesOf(f.label, f.id) }));
  return cands.length ? plan(request, cands) : undefined;
}

/**
 * Arithmetic on stored number fields of one collection, for a stat on a screen with nothing typed:
 * "total minus paid" gives sum(orders.total) - sum(orders.paid).
 */
export function planStoredArithmetic(spec: KalamSpec, request: string, a: AssistScope): string | undefined {
  if (Object.keys(a.form).length) return undefined;
  const cands = Object.entries(spec.collections).flatMap(([cid, c]) =>
    Object.entries(c.fields).filter(([, f]) => f.type === 'number')
      .map(([fid, f]): Operand => ({ expr: `sum(${cid}.${fid})`, group: cid, names: namesOf(f.label, fid) })));
  return cands.length > 1 ? plan(request, cands) : undefined;
}

/** The App Assistant's planner for collection questions, skipped when the app has no collections. */
export function planCollectionFormula(spec: KalamSpec, request: string): string | undefined {
  return Object.keys(spec.collections).length ? planFormula(spec, request)?.formula : undefined;
}
