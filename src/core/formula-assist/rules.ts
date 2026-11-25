/**
 * Rule-based requests, tried before any model (docs/07: deterministic first).
 *  1. Sums, differences, products, quotients and percentages of the values typed on a screen
 *     ("total amount minus amount paid"). Every operand must match exactly one number field.
 *  2. Everyday count, total, average, lowest and highest questions about a collection, with today,
 *     this month and choice filters. That is the App Assistant's own planner, reused as it is.
 * Anything left over after matching hands the request to the model instead of being dropped.
 */
import { namesOf, planFormula, stems, words } from '../assistant';
import type { KalamSpec } from '../spec/schema';
import type { AssistScope, NamedField } from './scope';

const LEAD = new Set(stems(
  'calculate compute work out find get give me show tell what whats is are the a an my please can you how much many',
));
/** Words that end the name of the result: "calculate the remaining balance AS total minus paid". */
const CONNECTOR = new Set(stems('as is equals equal be by'));

type Op = '+' | '-' | '*' | '/';
const PATTERNS: ReadonlyArray<{ re: RegExp; op: Op; swap?: boolean }> = [
  { re: /\bsubtract(?:ing|ed)? (.+?) from (.+)$/, op: '-', swap: true },
  { re: /\bmultipl(?:y|ying|ied) (.+?) (?:by|and|with) (.+)$/, op: '*' },
  { re: /\bdivid(?:e|ing|ed) (.+?) by (.+)$/, op: '/' },
  { re: /\badd(?:ing)? (.+?) (?:and|to) (.+)$/, op: '+' },
  { re: /^(.+?) (?:minus|less|take away|without) (.+)$/, op: '-' },
  { re: /^(.+?) (?:plus|added to) (.+)$/, op: '+' },
  { re: /^(.+?) (?:times|multiplied by) (.+)$/, op: '*' },
  { re: /^(.+?) (?:divided by|over|per) (.+)$/, op: '/' },
];
const PERCENT = /(\d+(?:\.\d+)?)\s*(?:%|percent|per cent)\s+of\s+(.+)$/;

const isNumeric = (f: NamedField): boolean =>
  f.type === 'number' || (f.type === 'enum' && !!f.options?.length && f.options.every((o) => o.trim() !== '' && Number.isFinite(Number(o))));

/** A typed number field named by these tokens (exactly one), or a plain number. */
function operand(tokens: string[], fields: NamedField[]): string | undefined {
  if (!tokens.length) return undefined;
  const [first] = tokens;
  if (tokens.length === 1 && first && /^\d+$/.test(first)) return first;
  const names = (f: NamedField) => namesOf(f.label, f.id);
  const within = fields.filter((f) => names(f).some((n) => tokens.every((t) => n.includes(t))));
  if (within.length === 1) return `form.${(within[0] as NamedField).id}`;
  const exact = fields.filter((f) => names(f).some((n) => n.length === tokens.length && n.every((t, i) => t === tokens[i])));
  return exact.length === 1 ? `form.${(exact[0] as NamedField).id}` : undefined;
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

export function planArithmetic(request: string, a: AssistScope): string | undefined {
  const fields = Object.values(a.form).filter(isNumeric);
  if (!fields.length) return undefined;

  const pct = PERCENT.exec(request.toLowerCase());
  if (pct?.[1] && pct[2]) {
    const of = operand(right(words(pct[2]).join(' ')), fields);
    if (of) return `round(${of} * ${pct[1]} / 100, 2)`;
  }

  const n = words(request).join(' ');
  for (const { re, op, swap } of PATTERNS) {
    const m = re.exec(n);
    if (!m?.[1] || !m[2]) continue;
    const [l, r] = swap ? [m[2], m[1]] : [m[1], m[2]];
    const x = operand(swap ? right(l) : left(l), fields);
    const y = operand(right(r), fields);
    if (x && y) return op === '/' ? `round(${x} / ${y}, 2)` : `${x} ${op} ${y}`;
  }
  return undefined;
}

/** Words for periods a formula cannot express: it has `today` and the current month, nothing else. */
const PERIOD = /\b(weeks?|weekly|weekdays?|years?|yearly|quarters?|yesterday|tomorrow|fortnight|(?:last|previous|prior|next|past) (?:month|\d+ days?))\b/;

export function unsupportedPeriod(request: string, spec: KalamSpec): boolean {
  const m = PERIOD.exec(words(request).join(' '));
  if (!m?.[1]) return false;
  // A field or collection that is itself called "Year" or "Week" is fine.
  const named: string[] = [];
  for (const [id, c] of Object.entries(spec.collections)) {
    named.push(id, c.label ?? '');
    for (const [fid, f] of Object.entries(c.fields)) named.push(fid, f.label);
  }
  for (const s of spec.screens) for (const c of s.children) if ('label' in c && typeof c.label === 'string') named.push(c.label);
  const known = new Set(named.flatMap((x) => stems(x.replace(/_+/g, ' '))));
  return !stems(m[1]).every((t) => known.has(t));
}

/** The App Assistant's planner for collection questions, skipped when the app has no collections. */
export function planCollectionFormula(spec: KalamSpec, request: string): string | undefined {
  return Object.keys(spec.collections).length ? planFormula(spec, request)?.formula : undefined;
}
