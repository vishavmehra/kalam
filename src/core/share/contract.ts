/**
 * Checks a link against the two apps as they are now. Run on every use, never cached: an app may have
 * been edited, restored or updated from the Bazaar since the link was made (docs/14 §16.5).
 */
import type { KalamCollection, KalamField, KalamFieldType, KalamSpec } from '../spec/schema';
import { listingIdFromBasedOn } from '../bazaar/model';
import { humanize, SHARE_COPY, TYPE_NAME, type NameContext } from './copy';
import type { ShareField, ShareLink } from './model';

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

export type LinkProblemCode =
  | 'revoked'
  | 'source_app_missing' | 'destination_app_missing'
  | 'source_collection_missing' | 'destination_collection_missing'
  | 'source_field_missing' | 'destination_field_missing'
  | 'source_type_changed' | 'destination_type_changed'
  | 'destination_choices_missing';

export interface LinkProblem {
  code: LinkProblemCode;
  /** Plain sentence for the person. Contains names from the app designs, never entry values. */
  message: string;
  field?: string;
}
export type LinkHealth = { ok: true } | { ok: false; problems: LinkProblem[] };

export const collectionOf = (spec: KalamSpec, id: string): KalamCollection | undefined =>
  has(spec.collections, id) ? spec.collections[id] : undefined;
export const fieldOf = (collection: KalamCollection, id: string): KalamField | undefined =>
  has(collection.fields, id) ? collection.fields[id] : undefined;
export const collectionLabel = (spec: KalamSpec, id: string): string => collectionOf(spec, id)?.label || humanize(id);
export const fieldLabel = (collection: KalamCollection | undefined, id: string): string =>
  (collection && fieldOf(collection, id)?.label) || humanize(id);

/** The value type travels as the link's type. A choice may land in a text field, nothing else converts. */
export function typesCompatible(linkType: KalamFieldType, targetType: KalamFieldType): boolean {
  return linkType === targetType || (linkType === 'enum' && targetType === 'text');
}

/** Installed from the Bazaar: someone else made the design (docs/12). Detected from the design's own record of it. */
export function isFromBazaar(spec: KalamSpec | undefined): boolean {
  return !!spec && spec.meta.source === 'import' && !!listingIdFromBasedOn(spec.meta.basedOn);
}

function problem(code: LinkProblemCode, ctx: NameContext, field?: string): LinkProblem {
  const make = SHARE_COPY.problem[code] as (c: NameContext) => string;
  return { code, message: make(ctx), ...(field ? { field } : {}) };
}

/**
 * Is this link still safe to use? Every problem found is returned so the person sees them all at once.
 * `write` links also need the destination to accept the choices of a choice field.
 */
export function checkLink(link: ShareLink, source: KalamSpec | undefined, destination: KalamSpec | undefined): LinkHealth {
  const problems: LinkProblem[] = [];
  if (link.status === 'revoked') return { ok: false, problems: [problem('revoked', { source: '', destination: '' })] };
  if (!source) problems.push(problem('source_app_missing', { source: '', destination: '' }));
  if (!destination) problems.push(problem('destination_app_missing', { source: '', destination: '' }));
  if (!source || !destination) return { ok: false, problems };

  const ctx: NameContext = { source: source.name, destination: destination.name };
  const from = collectionOf(source, link.sourceCollection);
  const to = collectionOf(destination, link.destinationCollection);
  if (!from) problems.push(problem('source_collection_missing', { ...ctx, list: collectionLabel(source, link.sourceCollection) }));
  if (!to) problems.push(problem('destination_collection_missing', { ...ctx, list: collectionLabel(destination, link.destinationCollection) }));
  if (from && to) {
    for (const f of link.fields) problems.push(...checkField(link, f, from, to, ctx));
  }
  return problems.length ? { ok: false, problems } : { ok: true };
}

function checkField(link: ShareLink, f: ShareField, from: KalamCollection, to: KalamCollection, ctx: NameContext): LinkProblem[] {
  const out: LinkProblem[] = [];
  const name = f.label ?? humanize(f.source);
  const src = fieldOf(from, f.source);
  const dst = fieldOf(to, f.target);
  if (!src) out.push(problem('source_field_missing', { ...ctx, field: name }, f.source));
  else if (src.type !== f.type) {
    out.push(problem('source_type_changed', { ...ctx, field: name, was: TYPE_NAME[f.type], now: TYPE_NAME[src.type] }, f.source));
  }
  if (!dst) out.push(problem('destination_field_missing', { ...ctx, field: fieldLabel(to, f.target) }, f.target));
  else if (!typesCompatible(f.type, dst.type)) {
    out.push(problem('destination_type_changed', { ...ctx, field: fieldLabel(to, f.target), was: TYPE_NAME[f.type], now: TYPE_NAME[dst.type] }, f.target));
  } else if (link.access === 'write' && src?.type === 'enum' && dst.type === 'enum') {
    const missing = src.options.filter((o) => !dst.options.includes(o));
    if (missing.length) {
      out.push(problem('destination_choices_missing', { ...ctx, field: fieldLabel(to, f.target), choices: missing.slice(0, 5).join(', ') }, f.target));
    }
  }
  return out;
}

export interface MappingSuggestion {
  source: string;
  target: string;
  type: KalamFieldType;
  /** Why this pair was suggested. */
  reason: 'same_name' | 'same_label';
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Fields of the destination list a source field of `type` may fill. */
export function compatibleTargets(destination: KalamCollection, type: KalamFieldType): string[] {
  return Object.entries(destination.fields).filter(([, f]) => typesCompatible(type, f.type)).map(([id]) => id);
}

/**
 * Pairs fields with the same name, then the same label, whose types fit. Each field is used once.
 * Plain rules, no AI: the person reviews and changes every pair before the link is made.
 */
export function suggestMappings(from: KalamCollection, to: KalamCollection): MappingSuggestion[] {
  const out: MappingSuggestion[] = [];
  const taken = new Set<string>();
  const used = new Set<string>();
  const pass = (reason: MappingSuggestion['reason'], same: (sid: string, s: KalamField, tid: string, t: KalamField) => boolean) => {
    for (const [sid, s] of Object.entries(from.fields)) {
      if (used.has(sid)) continue;
      const hit = Object.entries(to.fields).find(([tid, t]) => !taken.has(tid) && typesCompatible(s.type, t.type) && same(sid, s, tid, t));
      if (!hit) continue;
      used.add(sid);
      taken.add(hit[0]);
      out.push({ source: sid, target: hit[0], type: s.type, reason });
    }
  };
  pass('same_name', (sid, _s, tid) => sid === tid);
  pass('same_label', (_sid, s, _tid, t) => norm(s.label) !== '' && norm(s.label) === norm(t.label));
  // Keep the source list's own field order.
  const order = Object.keys(from.fields);
  return out.sort((a, b) => order.indexOf(a.source) - order.indexOf(b.source));
}

/** Labels of required destination fields that no mapped field fills (a `write` link could never be accepted). */
export function unmappedRequired(to: KalamCollection, mappedTargets: readonly string[]): string[] {
  const mapped = new Set(mappedTargets);
  return Object.entries(to.fields).filter(([id, f]) => f.required && !mapped.has(id)).map(([, f]) => f.label);
}
