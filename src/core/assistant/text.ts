/**
 * Small text helpers shared by the assistant's deterministic parts. Question words and the names in
 * a spec are reduced to the same light stems so "orders", "order" and "Order" all line up.
 */
import type { KalamSpec } from '../spec/schema';

/** Letters and numbers (marks kept so Hindi words stay whole), lower-cased, Latin accents removed. */
export const words = (s: string): string[] =>
  s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').normalize('NFC').match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];

/** Light plural strip. Applied to both sides of every comparison, so it only has to be consistent. */
export const stem = (w: string): string => (w.length > 3 ? w.replace(/ies$/, 'y').replace(/(?<![su])s$/, '') : w);
export const stems = (s: string): string[] => words(s).map(stem);

/** Every token of `name` appears in the question. */
export const mentions = (name: readonly string[], qset: ReadonlySet<string>): boolean =>
  name.length > 0 && name.every((t) => qset.has(t));

/** The names a person might use for a collection or field: its label and its id read as words. */
export const namesOf = (label: string | undefined, id: string): string[][] =>
  [label, id.replace(/_+/g, ' ')].filter((x): x is string => !!x).map(stems).filter((t) => t.length > 0);

export const humanize = (id: string): string => {
  const s = id.replace(/_+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
};
export const lower = (s: string): string => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
export const singular = (s: string): string => {
  if (/ies$/i.test(s)) return s.replace(/ies$/i, 'y');
  if (/(ss|us|is)$/i.test(s)) return s;
  return s.replace(/s$/i, '');
};
export const quote = (s: string): string => `“${s}”`;
export const collectionName = (spec: KalamSpec, id: string): string => spec.collections[id]?.label || humanize(id);

/** 1240.5 → "1,240.5". Two decimals at most. */
export function formatNumber(n: number, lang: string): string {
  const r = Math.round(n * 100) / 100;
  try { return new Intl.NumberFormat(lang, { maximumFractionDigits: 2 }).format(r); } catch { return String(r); }
}
