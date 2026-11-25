/** Name lookups and small word helpers shared by the history describers. Pure TypeScript. */
import type { KalamComponent, KalamComponentType, KalamSpec } from '../spec/schema';

/** `due_date` becomes `Due date`. Used only when an id has no label. */
export function humanize(id: string): string {
  const s = id.replace(/_+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Lowercases a leading capital that starts an ordinary word (`Added` becomes `added`, `GST` stays). */
export const lowerFirst = (s: string): string => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);

export function singular(s: string): string {
  if (/ies$/i.test(s)) return s.replace(/ies$/i, 'y');
  if (/(ss|us|is)$/i.test(s)) return s;
  return s.replace(/s$/i, '');
}

/** Shortens long free text so a history line stays readable. */
export function clip(s: string, max = 40): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** `a, b and c` */
export function joinWords(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** What each component is called in a sentence. */
export const COMPONENT_NOUN: Record<KalamComponentType, string> = {
  text: 'text',
  heading: 'heading',
  number: 'number box',
  textInput: 'text box',
  date: 'date picker',
  choice: 'choice',
  toggle: 'switch',
  counter: 'counter',
  bigButton: 'button',
  list: 'list',
  stat: 'number',
  photo: 'photo',
};

export interface SpecNames {
  screenTitle(id: string): string;
  collectionName(id: string): string;
  /** Singular, lower case: `expense`. */
  recordName(collectionId: string): string;
  /** Label of a field. Looks in `collectionId` first, then in every collection, then in screen components. */
  fieldLabel(fieldId: string, collectionId?: string): string;
  /** Label of a field, component or counter by id. */
  anyName(id: string): string;
  actionName(id: string): string;
  blockName(id: string): string;
  /** `Save button`, `Spent today number`, `“Welcome” heading`. */
  componentRef(c: KalamComponent): string;
}

export function namesFor(spec: KalamSpec): SpecNames {
  const collectionName = (id: string): string => spec.collections[id]?.label || humanize(id);
  const componentLabel = (id: string): string | undefined => {
    for (const s of spec.screens) {
      const c = s.children.find((x) => x.id === id);
      if (c && 'label' in c && c.label) return c.label;
    }
    return undefined;
  };
  const fieldLabel = (fieldId: string, collectionId?: string): string => {
    const inCollection = collectionId ? spec.collections[collectionId]?.fields[fieldId]?.label : undefined;
    if (inCollection) return inCollection;
    for (const col of Object.values(spec.collections)) {
      const f = col.fields[fieldId];
      if (f) return f.label;
    }
    return componentLabel(fieldId) ?? humanize(fieldId);
  };
  return {
    screenTitle: (id) => spec.screens.find((s) => s.id === id)?.title ?? humanize(id),
    collectionName,
    recordName: (id) => lowerFirst(singular(collectionName(id))),
    fieldLabel,
    anyName: (id) => componentLabel(id) ?? fieldLabel(id),
    actionName: (id) => humanize(id),
    blockName: (id) => humanize(id),
    componentRef: (c) => {
      const noun = COMPONENT_NOUN[c.type];
      if (c.type === 'text' || c.type === 'heading') return `“${clip(c.label)}” ${noun}`;
      const label = ('label' in c && c.label) || (c.type === 'list' ? collectionName(c.source) : humanize(c.id));
      const l = label.toLowerCase();
      if (noun.startsWith(l)) return noun.charAt(0).toUpperCase() + noun.slice(1); // label "Date" on a date picker
      return l.includes(noun) ? label : `${label} ${noun}`;
    },
  };
}

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English', hi: 'Hindi', bn: 'Bengali', ta: 'Tamil', te: 'Telugu', mr: 'Marathi', gu: 'Gujarati',
  kn: 'Kannada', ml: 'Malayalam', pa: 'Punjabi', ur: 'Urdu', or: 'Odia', as: 'Assamese', ne: 'Nepali',
  es: 'Spanish', fr: 'French', de: 'German', pt: 'Portuguese', ar: 'Arabic', sw: 'Swahili', id: 'Indonesian',
  zh: 'Chinese', ja: 'Japanese',
};
export const languageLabel = (code: string): string => LANGUAGE_NAMES[code.split('-')[0] ?? code] ?? code;

/** Structural equality for JSON data (key order does not matter). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => k in (b as object) && deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/**
 * Items of `after` that were moved relative to `before`. Only ids present in both lists count.
 * Uses the longest common subsequence, so moving one item reports one item, not everything it jumped over.
 */
export function movedIds(before: readonly string[], after: readonly string[]): string[] {
  const inAfter = new Set(after);
  const inBefore = new Set(before);
  const a = before.filter((id) => inAfter.has(id));
  const b = after.filter((id) => inBefore.has(id));
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const keep = new Set<string>();
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { keep.add(a[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return b.filter((id) => !keep.has(id));
}
