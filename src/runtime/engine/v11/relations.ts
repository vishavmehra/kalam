/**
 * Relations between collections (KalamSpec 1.1): picking a linked entry, showing it, and what a
 * delete does to entries that link to it (restrict, cascade, clear). Pure planning plus one
 * executor that goes through RuntimeServices.
 */
import type { KalamRecord, RecordValue } from '@/core/contracts';
import type { KalamRelation, KalamSpec } from '@/core/spec/schema';
import { incomingRelations, isMachineField, isSignatureField, relationDisplayField, relationOf, safeLocale } from '@/core/spec/v11';
import type { ActionResult, EngineEnv, RuntimeState } from '../types';
import { applyOps, deletePlanOps } from '../transaction';
import { v11Words } from './copy';
import { isSignature } from './signature';

export { relationOf };

const text = (v: RecordValue | undefined): string =>
  v === null || v === undefined ? '' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v);

export interface RelationOption {
  id: string;
  label: string;
}

/** Entries a link can point at, labelled by the display field and sorted by that label. */
export function relationOptions(spec: KalamSpec, relation: KalamRelation, records: readonly KalamRecord[]): RelationOption[] {
  const field = relationDisplayField(spec, relation);
  const locale = safeLocale(spec.lang);
  const words = v11Words(spec.lang);
  return records
    .map((r) => ({ id: r.id, label: (field ? text(r.values[field]).trim() : '') || words.untitled }))
    .sort((a, b) => a.label.localeCompare(b.label, locale, { numeric: true, sensitivity: 'base' }));
}

/** What a stored link shows: the linked entry's label, "Missing entry", or undefined when empty. */
export function relationLabel(
  spec: KalamSpec, relation: KalamRelation, records: readonly KalamRecord[], value: RecordValue | undefined,
): string | undefined {
  if (typeof value !== 'string' || value === '') return undefined;
  const hit = records.find((r) => r.id === value);
  const words = v11Words(spec.lang);
  if (!hit) return words.missingLink;
  const field = relationDisplayField(spec, relation);
  return (field ? text(hit.values[field]).trim() : '') || words.untitled;
}

export interface DeletePlan {
  /** A `restrict` link (or too many entries) stops the delete; nothing may be changed. */
  blocked?: { collection: string; count: number; tooMany?: boolean };
  /** Entries deleted with it, deepest first, so a failure never leaves a child without its parent's rule. */
  cascade: Array<{ collection: string; id: string }>;
  /** Links set to empty. */
  clear: Array<{ collection: string; id: string; field: string }>;
}

/** Most entries one delete may remove along with it. */
export const MAX_CASCADE = 500;

/**
 * Works out everything one delete touches. Follows cascades breadth first with a visited set, so
 * self links and loops end. A `restrict` anywhere in the chain blocks the whole delete.
 */
export function planDelete(
  spec: KalamSpec, collection: string, id: string, records: Readonly<Record<string, readonly KalamRecord[]>>,
): DeletePlan {
  const key = (c: string, r: string) => `${c}\u0000${r}`;
  const doomed = new Set<string>([key(collection, id)]);
  const queue: Array<{ collection: string; id: string }> = [{ collection, id }];
  const cascade: DeletePlan['cascade'] = [];
  const clear: DeletePlan['clear'] = [];
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i];
    for (const link of incomingRelations(spec, node.collection)) {
      const linked = (records[link.collection] ?? []).filter(
        (r) => r.values[link.field] === node.id && !doomed.has(key(link.collection, r.id)),
      );
      if (!linked.length) continue;
      if (link.rule === 'restrict') return { blocked: { collection: link.collection, count: linked.length }, cascade: [], clear: [] };
      for (const r of linked) {
        if (link.rule === 'clear') {
          clear.push({ collection: link.collection, id: r.id, field: link.field });
          continue;
        }
        doomed.add(key(link.collection, r.id));
        cascade.push({ collection: link.collection, id: r.id });
        queue.push({ collection: link.collection, id: r.id });
        if (cascade.length > MAX_CASCADE) return { blocked: { collection: link.collection, count: cascade.length, tooMany: true }, cascade: [], clear: [] };
      }
    }
  }
  // An entry that is deleted anyway needs no link cleared.
  return { cascade: cascade.reverse(), clear: clear.filter((c) => !doomed.has(key(c.collection, c.id))) };
}

/** Plain message for a blocked plan. */
export function blockedMessage(spec: KalamSpec, plan: DeletePlan): string | undefined {
  if (!plan.blocked) return undefined;
  const words = v11Words(spec.lang);
  if (plan.blocked.tooMany) return words.deleteTooMany;
  const c = plan.blocked.collection;
  const name = (Object.prototype.hasOwnProperty.call(spec.collections, c) && spec.collections[c].label) || c.replace(/_/g, ' ');
  return words.deleteBlocked(plan.blocked.count, name);
}

/**
 * The confirm question, with what else the delete changes: the question on the first line and one line for each
 * consequence after it, so the confirm sheet can set the consequences apart (ui/overlays.tsx ConfirmSheet).
 */
export function confirmWithRelations(base: string, plan: DeletePlan, lang?: string): string {
  const words = v11Words(lang);
  const extra = [
    plan.cascade.length ? words.alsoDeletes(plan.cascade.length) : '',
    plan.clear.length ? words.alsoClears(plan.clear.length) : '',
  ].filter(Boolean);
  return extra.length ? `${base}\n${extra.join('\n')}` : base;
}

/**
 * Runs a plan as one unit: linked entries deepest first, then the entry itself, then clears links
 * (transaction.ts `applyOps`). The local database runs the list as ONE storage transaction, so it
 * either all happens or none of it does. A repository without `batch` falls back to one write at a
 * time, where a failure part way can only leave links to a deleted entry, which already read
 * "Missing entry"; it never empties a link whose entry is still there. Returns undefined when every
 * write went through, else how many writes had gone through before the one that failed (0: nothing changed).
 */
export async function applyDeletePlan(env: EngineEnv, collection: string, id: string, plan: DeletePlan): Promise<number | undefined> {
  const done = await applyOps(env.services.records, env.appId, deletePlanOps(plan, collection, id));
  return done.ok ? undefined : done.rolledBack ? 0 : done.failedAt;
}

/** What a plan touches, independent of the order storage returned the entries in. */
const planKey = (p: DeletePlan): string => JSON.stringify([
  p.blocked ?? null,
  p.cascade.map((d) => `${d.collection}\u0000${d.id}`).sort(),
  p.clear.map((c) => `${c.collection}\u0000${c.id}\u0000${c.field}`).sort(),
]);

/**
 * Drop-in for a confirmed delete that respects links. Returns a failed result when blocked; the
 * caller's own confirm and navigation stay as they are.
 */
export async function deleteWithRelations(
  env: EngineEnv, state: RuntimeState, collection: string, id: string, confirmText: string,
): Promise<ActionResult> {
  const words = v11Words(env.spec.lang);
  const plan = planDelete(env.spec, collection, id, env.data.records);
  const blocked = blockedMessage(env.spec, plan);
  if (blocked) return { ok: false, state, error: 'validation_failed', effects: [{ type: 'toast', message: blocked, tone: 'warning' }] };
  if (!(await env.services.confirm(confirmWithRelations(confirmText, plan, env.spec.lang)))) return { ok: false, error: 'cancelled', state, effects: [] };
  // An entry linked while the question was open (another tab, an import) must not be missed: plan
  // again from storage, and stop if the delete would now do something other than what was confirmed.
  let fresh: DeletePlan;
  try {
    fresh = planDelete(env.spec, collection, id, await env.services.records.listAll(env.appId));
  } catch {
    return { ok: false, state, error: 'storage_failed', effects: [{ type: 'toast', message: words.deleteFailed, tone: 'error' }] };
  }
  if (planKey(fresh) !== planKey(plan)) {
    return { ok: false, state, error: 'validation_failed', effects: [{ type: 'toast', message: words.deleteChanged, tone: 'warning' }] };
  }
  const failedAfter = await applyDeletePlan(env, collection, id, fresh);
  if (failedAfter !== undefined) {
    const message = failedAfter ? words.deletePartly : words.deleteFailed;
    return { ok: false, state, error: 'storage_failed', effects: [{ type: 'toast', message, tone: 'error' }] };
  }
  return { ok: true, state, effects: [] };
}

// ─── Values from outside Kalam's own controls ─────────────────────────────────
/**
 * Fields of `collection` a model, voice or import may fill: everything except links and signatures,
 * which only the picker and the pad write (dispatch.ts outputFields for an extract with no list).
 */
export function aiWritableFields(spec: KalamSpec, collection: string): string[] {
  if (!Object.prototype.hasOwnProperty.call(spec.collections, collection)) return [];
  return Object.keys(spec.collections[collection].fields).filter((f) => !isMachineField(spec, collection, f));
}

/**
 * Values Kalam's own controls did not make, as field → message: a link that names no entry of its
 * collection, or a signature field holding anything but a signature. Call before an insert or
 * update, so free text (a typed or spoken name, a model's guess) is never stored in either.
 */
export function machineValueErrors(
  spec: KalamSpec, collection: string, values: Readonly<Record<string, RecordValue>>,
  records: Readonly<Record<string, readonly KalamRecord[]>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  const words = v11Words(spec.lang);
  for (const [field, value] of Object.entries(values)) {
    if (value === null || value === undefined || value === '') continue;
    const relation = relationOf(spec, collection, field);
    if (relation && !(records[relation.collection] ?? []).some((r) => r.id === value)) out[field] = words.linkNotFound;
    else if (!relation && isSignatureField(spec, collection, field) && !isSignature(value)) out[field] = words.signatureNotDrawn;
  }
  return out;
}

/** Rewrites links after a restore gave some entries new ids. One copy, in the spec module (storage restore uses it too). */
export { remapLinks } from '@/core/spec/v11';
