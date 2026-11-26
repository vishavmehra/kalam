/**
 * KalamSpec 1.1 helpers shared by the validator, the compiler and the runtime. Pure: no React,
 * no storage, no clock.
 */
import type { AccessModes, RecordValue } from '../contracts';
import {
  type KalamComponent, type KalamImportance, type KalamLayoutNode, type KalamRelation, type KalamScreen, type KalamSpec, LIMITS, type OnDeleteRule,
  type PermissionKind, type SuggestedMode, V11_COMPONENT_TYPES,
} from './schema';

const own = (o: object, k: string | undefined): boolean => k !== undefined && Object.prototype.hasOwnProperty.call(o, k);
const V11_TYPES: ReadonlySet<string> = new Set(V11_COMPONENT_TYPES);

/** True when the document needs format 1.1 to be read (an older Kalam would reject it). */
export function usesV11(spec: KalamSpec): boolean {
  if (spec.permissions || spec.accessibility || spec.settings || spec.localization) return true;
  for (const col of Object.values(spec.collections)) {
    for (const f of Object.values(col.fields)) if ((f.type === 'text' && f.ref) || f.type === 'image') return true;
  }
  if (Object.values(spec.actions).some((a) => a.type === 'update' && a.set)) return true;
  return spec.screens.some((s) => !!s.layout || s.children.some((c) => V11_TYPES.has(c.type) || !!c.style || !!c.importance || (c.type === 'photo' && !!c.field)));
}

/**
 * The Simple-mode level of a component (docs/10 §4.3): its `importance`, else `secondary: true` (the 1.0 flag) means
 * secondary, else standard. Strict `=== true`: on a list `secondary` is the second-line field id, not the flag.
 */
export function importanceOf(c: Pick<KalamComponent, 'importance' | 'secondary'>): KalamImportance {
  if (c.importance) return c.importance;
  return c.secondary === true ? 'secondary' : 'standard';
}

/** Every component on every screen, in order (layout never hides a component from this list). */
export function allComponents(spec: KalamSpec): KalamComponent[] {
  return spec.screens.flatMap((s) => s.children);
}

// ─── Relations ────────────────────────────────────────────────────────────────
export function relationOf(spec: KalamSpec, collection: string | undefined, field: string): KalamRelation | undefined {
  if (!own(spec.collections, collection)) return undefined;
  const fields = spec.collections[collection as string].fields;
  const f = own(fields, field) ? fields[field] : undefined;
  return f?.type === 'text' ? f.ref : undefined;
}

/**
 * Rewrites links after a restore gave some entries new ids (`moved`: old id → new id). Pure: returns
 * a copy and leaves `values` alone. Only link fields change, and only when their value was moved.
 */
export function remapLinks(
  spec: KalamSpec, collection: string, values: Readonly<Record<string, RecordValue>>, moved: ReadonlyMap<string, string>,
): Record<string, RecordValue> {
  let out: Record<string, RecordValue> | undefined;
  for (const [field, value] of Object.entries(values)) {
    const next = typeof value === 'string' && relationOf(spec, collection, field) ? moved.get(value) : undefined;
    if (next !== undefined) (out ??= { ...values })[field] = next;
  }
  return out ?? { ...values };
}

export interface IncomingRelation {
  /** Collection that holds the link. */
  collection: string;
  field: string;
  rule: OnDeleteRule;
}

/** Links that point at `collection` (who is affected when one of its entries is deleted). */
export function incomingRelations(spec: KalamSpec, collection: string): IncomingRelation[] {
  const out: IncomingRelation[] = [];
  for (const [cid, col] of Object.entries(spec.collections)) {
    for (const [fid, f] of Object.entries(col.fields)) {
      if (f.type === 'text' && f.ref?.collection === collection) out.push({ collection: cid, field: fid, rule: f.ref.onDelete ?? 'restrict' });
    }
  }
  return out;
}

const SHOWABLE: ReadonlySet<string> = new Set(['text', 'number', 'date', 'enum']);

/** Field of the linked collection that people see: `display`, else its first plain text field. */
export function relationDisplayField(spec: KalamSpec, relation: KalamRelation): string | undefined {
  if (!own(spec.collections, relation.collection)) return undefined;
  const fields = spec.collections[relation.collection].fields;
  if (relation.display && own(fields, relation.display)) return relation.display;
  const entries = Object.entries(fields);
  return (
    entries.find(([, f]) => f.type === 'text' && !f.ref)?.[0] ??
    entries.find(([, f]) => SHOWABLE.has(f.type))?.[0]
  );
}

// ─── Sections ─────────────────────────────────────────────────────────────────
/** Capabilities the app needs, read from its components (deterministic, never from a model). */
export function requiredPermissions(spec: KalamSpec): PermissionKind[] {
  const out: PermissionKind[] = [];
  const all = allComponents(spec);
  if (all.some((c) => c.type === 'photo')) out.push('camera');
  if (all.some((c) => c.type === 'reminder')) out.push('notifications');
  return out;
}

/** Key in the app's key-value state that remembers "Not now" for the suggested modes. Reserved. */
export const SUGGESTED_MODES_KEY = 'kalam_suggested_modes';

/**
 * Modes the app suggests that the person does not use yet, to OFFER (docs/10: Access Modes belong
 * to the person). Nothing is switched on here: the caller shows the offer and only an explicit
 * "Turn on" changes the person's own modes, which they can switch off again in Settings.
 * Empty after "Not now" (`state[SUGGESTED_MODES_KEY] === 'dismissed'`).
 */
export function offeredAccessModes(
  spec: KalamSpec, modes: AccessModes, state?: Readonly<Record<string, unknown>>,
): SuggestedMode[] {
  if (state?.[SUGGESTED_MODES_KEY] === 'dismissed') return [];
  return [...new Set(spec.accessibility?.suggestedModes ?? [])].filter((m) => !modes[m]);
}

/**
 * `lang` as a locale Intl accepts, else 'en'. The schema's tag pattern lets through tags such as
 * 'en-abc' that make localeCompare and toLocaleLowerCase throw, which would break the screen.
 */
export function safeLocale(lang: string | undefined): string {
  try {
    return Intl.getCanonicalLocales(lang || 'en')[0] ?? 'en';
  } catch {
    return 'en';
  }
}

/** Currency a money value is shown in: the stat's own, else the app's setting, else Kalam's default. */
export const DEFAULT_CURRENCY = 'INR';
export function statCurrency(spec: Pick<KalamSpec, 'settings'>, stat: { currency?: string }): string {
  return stat.currency ?? spec.settings?.currency ?? DEFAULT_CURRENCY;
}

// ─── Fields that only Kalam may write ─────────────────────────────────────────
/** True when a signature component on a screen of `collection` stores into `field`. */
export function isSignatureField(spec: KalamSpec, collection: string | undefined, field: string): boolean {
  return spec.screens.some((s) => s.form === collection && s.children.some((c) => c.type === 'signature' && c.field === field));
}

/**
 * A link (record id) or a signature. These hold values only Kalam's own controls produce, so model
 * output, typed text and voice must never be written into them.
 */
export function isMachineField(spec: KalamSpec, collection: string | undefined, field: string): boolean {
  return !!relationOf(spec, collection, field) || isSignatureField(spec, collection, field);
}

// ─── Layout edits (used by core/edit/apply.ts) ────────────────────────────────
type LayoutList = Array<string | KalamLayoutNode>;

/** Removes `id` from every group of the screen; groups left empty go too, and so does an empty layout. Mutates. */
export function removeFromLayout(screen: KalamScreen, id: string): void {
  if (!screen.layout) return;
  const prune = (list: LayoutList, depth: number): LayoutList =>
    list.flatMap((child): LayoutList => {
      if (typeof child === 'string') return child === id ? [] : [child];
      if (depth >= LIMITS.layoutDepth) return [child];
      const children = prune(child.children, depth + 1);
      return children.length ? [{ ...child, children }] : [];
    });
  const next = prune(screen.layout, 0) as KalamLayoutNode[];
  if (next.length) screen.layout = next;
  else delete screen.layout;
}

/**
 * Moves `id` one place up or down inside its group (a group's order comes from the layout, not from
 * `children`). Returns false when `id` is in no group, so the caller moves it in `children` instead.
 * At the edge of its group it stays where it is. Mutates.
 */
export function moveInLayout(screen: KalamScreen, id: string, direction: 'up' | 'down'): boolean {
  const find = (list: LayoutList, depth: number): LayoutList | undefined => {
    if (list.includes(id)) return list;
    if (depth >= LIMITS.layoutDepth) return undefined;
    for (const child of list) {
      const hit = typeof child === 'string' ? undefined : find(child.children, depth + 1);
      if (hit) return hit;
    }
    return undefined;
  };
  const list = screen.layout ? find(screen.layout, 0) : undefined;
  if (!list) return false;
  const from = list.indexOf(id);
  const to = from + (direction === 'up' ? -1 : 1);
  if (to >= 0 && to < list.length) [list[from], list[to]] = [list[to], list[from]];
  return true;
}

// ─── Terminology (docs/05 §9.7) ───────────────────────────────────────────────
export interface TerminologyRules {
  /** Words that must come out exactly as written. */
  keep: string[];
  /** Words with a fixed translation in this language. */
  fixed: Array<{ term: string; text: string }>;
}

/** Rules for translating into `lang` (exact tag first, then its base language: `hi-IN` → `hi`). */
export function terminologyFor(spec: KalamSpec, lang: string): TerminologyRules {
  const base = lang.split('-')[0];
  const rules: TerminologyRules = { keep: [], fixed: [] };
  for (const t of spec.localization?.terminology ?? []) {
    if (t.keep) rules.keep.push(t.term);
    const tr = t.translations;
    const text = tr && (own(tr, lang) ? tr[lang] : own(tr, base) ? tr[base] : undefined);
    if (text) rules.fixed.push({ term: t.term, text });
  }
  return rules;
}

/** Scripts written without spaces between words: there a term can only be found as a substring. */
const NO_SPACES = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Whole-word, case-insensitive match ('Art' is not in 'Smart', 'Sew' is not in 'sewing'). Lower-cases
 * without the device's locale, so the check gives the same answer on every phone. A vowel sign after
 * the word (Devanagari and friends) counts as part of the word.
 */
function has(hay: string, needle: string): boolean {
  const h = hay.toLowerCase();
  const n = needle.toLowerCase().trim();
  if (!n) return false;
  if (NO_SPACES.test(n)) return h.includes(n);
  return new RegExp(`(?:^|[^\\p{L}\\p{N}\\p{M}])${escapeRe(n)}(?=$|[^\\p{L}\\p{N}\\p{M}])`, 'u').test(h);
}

/**
 * Deterministic check of a translation against the rules. Returns the terms that were broken, so
 * the caller can reject or flag the result. Only terms present in the source count.
 */
export function brokenTerms(rules: TerminologyRules, source: string, translated: string): string[] {
  const out: string[] = [];
  for (const term of rules.keep) if (has(source, term) && !has(translated, term)) out.push(term);
  for (const { term, text } of rules.fixed) if (has(source, term) && !has(translated, text)) out.push(term);
  return out;
}
