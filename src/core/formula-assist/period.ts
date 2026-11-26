/**
 * Periods a formula cannot express. A formula has `today` and the current month and nothing else, so a
 * request for "last week" must be refused, never quietly answered with this month's number.
 * Kept in its own file with no imports from the assistant index, so core/assistant can use it too
 * without a cycle (it only reads the leaf text helpers).
 */
import type { KalamSpec } from '../spec/schema';
import { stems, words } from '../assistant/text';

const PERIOD = new RegExp(
  '\\b(weeks?|weekly|weekdays?|years?|yearly|annual(?:ly)?|monthly|daily|quarters?|yesterday|tomorrow|fortnight|ago|'
  + '(?:last|previous|prior|next|past) (?:months?|\\d+ (?:days?|months?|weeks?|years?)))\\b',
);

/** Every name the app itself uses: collections, fields, choice options, units and component labels. */
function namesIn(spec: KalamSpec): string[] {
  const out: string[] = [];
  const add = (x: unknown): void => { if (typeof x === 'string') out.push(x); };
  for (const [id, c] of Object.entries(spec.collections)) {
    add(id);
    add(c.label);
    for (const [fid, f] of Object.entries(c.fields)) {
      add(fid);
      add(f.label);
      if (f.type === 'enum') f.options.forEach(add);
      if (f.type === 'number') add(f.unit);
    }
  }
  for (const s of spec.screens) {
    for (const c of s.children) {
      const rec = c as unknown as Record<string, unknown>;
      add(rec.label);
      add(rec.unit);
      if (Array.isArray(rec.options)) rec.options.forEach(add);
    }
  }
  return out;
}

/** True when the request names a period the formula language cannot write. */
export function unsupportedPeriod(request: string, spec: KalamSpec): boolean {
  const m = PERIOD.exec(words(request).join(' '));
  if (!m?.[1]) return false;
  // A period word that is part of the app's own names ("Week", "Weekly", a unit of "weeks") is fine.
  const known = new Set(namesIn(spec).flatMap((x) => stems(x.replace(/_+/g, ' '))));
  return !stems(m[1]).every((t) => known.has(t));
}
