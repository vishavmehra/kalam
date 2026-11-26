/**
 * Saves a clone plan through the local database's repositories (docs/14 §19.3). All or nothing: if any step fails,
 * the new app is removed again (with whatever was copied into it) and the error is raised. The original is only read.
 *
 * The database checks every entry against the design before it is written, and a copy cannot always satisfy that:
 * a picture stays with the original, a link may point at an entry that is not copied yet (or that no longer exists),
 * and an old entry may predate a field that is required now. Instead of failing the whole copy, the required flag of
 * exactly those fields is lifted for the time the entries are written and put back with a second saved version.
 * An entry that still does not fit its list is left out and counted, so the person is told.
 */
import type { AppRepository, KalamRecord, KeyValueRepository, RecordRepository, RecordValue, StoredApp } from '../contracts';
import { relationOf } from '../spec/v11';
import type { KalamSpec } from '../spec/schema';
import { cloneSpec } from '../versioning';
import { CLONE_COPY } from './copy';
import type { ClonePlan, PlannedRecord } from './plan';

export interface CloneStore {
  apps: Pick<AppRepository, 'save' | 'remove'>;
  records: Pick<RecordRepository, 'insert' | 'update'>;
  state: Pick<KeyValueRepository, 'set'>;
}

/** What a finished copy contains. */
export interface CloneOutcome {
  /** The copy as it is saved. */
  app: StoredApp;
  entriesCopied: number;
  /** Entries that no longer fit their list, for example a value the design does not allow any more. */
  skippedEntries: number;
  /** Pictures that stay with the original app. */
  skippedPictures: number;
}

/** Raised when the copy failed and the half-made app could not be removed either. It is still on the shelf. */
export class CloneLeftoverError extends Error {
  readonly code = 'clone_leftover';
  constructor(readonly appId: string, readonly original: unknown) {
    super(CLONE_COPY.errors.leftover);
    this.name = 'CloneLeftoverError';
  }
}

/**
 * Lists to fill first: a list that others link to comes before the lists that link to it, so a link can be
 * rewritten to the new entry the moment it is written. A loop (A links to B, B links to A) is broken at the end:
 * those links are written empty first and filled in once every entry exists.
 */
export function copyOrder(spec: KalamSpec): string[] {
  const ids = Object.keys(spec.collections);
  const parents = new Map<string, Set<string>>(ids.map((c) => [c, new Set<string>()]));
  for (const c of ids) {
    for (const [fid] of Object.entries(spec.collections[c]?.fields ?? {})) {
      const target = relationOf(spec, c, fid)?.collection;
      if (target && target !== c && parents.has(target)) parents.get(c)?.add(target);
    }
  }
  const out: string[] = [];
  const done = new Set<string>();
  while (out.length < ids.length) {
    const ready = ids.filter((c) => !done.has(c) && [...(parents.get(c) ?? [])].every((p) => done.has(p)));
    const next = ready.length ? ready : ids.filter((c) => !done.has(c)).slice(0, 1); // a loop: take one and carry on
    for (const c of next) { out.push(c); done.add(c); }
  }
  return out;
}

/** The link fields of one list, as `field → linked list`. */
function linkFields(spec: KalamSpec, collection: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const fid of Object.keys(spec.collections[collection]?.fields ?? {})) {
    const target = relationOf(spec, collection, fid)?.collection;
    if (target) out.push([fid, target]);
  }
  return out;
}

const groupByList = (records: readonly PlannedRecord[]): Map<string, PlannedRecord[]> => {
  const out = new Map<string, PlannedRecord[]>();
  for (const r of records) out.set(r.collectionId, [...(out.get(r.collectionId) ?? []), r]);
  return out;
};

/** The database refused one entry because it does not fit its list (a plain code, so core needs no storage import). */
const isRecordInvalid = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'record_invalid';

/**
 * Required fields that at least one copied entry cannot fill when it is first written: a picture field (pictures are not
 * copied), a link to an entry that is not copied yet or never existed, and a value the original entry never had.
 * Empty for a plain copy, which then needs only one saved version.
 */
export function fieldsToRelax(plan: ClonePlan): Array<{ collection: string; field: string }> {
  const { spec } = plan.app;
  const byList = groupByList(plan.records);
  const found = new Map<string, { collection: string; field: string }>();
  const seen = new Set<string>(); // source ids of the entries written so far, in the order apply writes them
  for (const collection of copyOrder(spec)) {
    const links = new Set(linkFields(spec, collection).map(([fid]) => fid));
    for (const r of byList.get(collection) ?? []) {
      for (const [fid, def] of Object.entries(spec.collections[collection]?.fields ?? {})) {
        if (!def.required) continue;
        const v = r.values[fid];
        const empty = v === undefined || v === null || v === '';
        const unresolved = links.has(fid) && typeof v === 'string' && v !== '' && !seen.has(v);
        if (def.type === 'image' || empty || unresolved) found.set(`${collection}:${fid}`, { collection, field: fid });
      }
      seen.add(r.sourceId);
    }
  }
  return [...found.values()];
}

/** The design with the required flag lifted from the given fields. */
function withoutRequired(spec: KalamSpec, fields: ReadonlyArray<{ collection: string; field: string }>): KalamSpec {
  const out = cloneSpec(spec);
  for (const { collection, field } of fields) {
    const def = out.collections[collection]?.fields[field];
    if (def) delete def.required;
  }
  return out;
}

export async function applyClonePlan(plan: ClonePlan, store: CloneStore): Promise<CloneOutcome> {
  const { app } = plan;
  const relax = fieldsToRelax(plan);
  const first = await store.apps.save(
    relax.length ? { ...app, spec: withoutRequired(app.spec, relax) } : app,
    { summary: plan.summary, source: 'create', origin: 'user' },
  );
  try {
    const created = new Map<string, string>(); // id in the original → id in the copy
    const later: Array<{ collectionId: string; id: string; values: Record<string, RecordValue> }> = [];
    const byCollection = groupByList(plan.records);
    let copied = 0;
    let skippedEntries = 0;

    for (const collection of copyOrder(app.spec)) {
      const links = linkFields(app.spec, collection);
      for (const r of byCollection.get(collection) ?? []) {
        const values = { ...r.values };
        const fill: Record<string, RecordValue> = {};
        for (const [fid] of links) {
          const old = values[fid];
          if (typeof old !== 'string' || old === '') continue;
          const mapped = created.get(old);
          if (mapped) values[fid] = mapped;
          else { values[fid] = null; fill[fid] = old; } // points at an entry not copied yet, or at nothing
        }
        let row: KalamRecord;
        try {
          row = await store.records.insert(app.id, collection, values);
        } catch (error) {
          if (!isRecordInvalid(error)) throw error;
          skippedEntries++; // this one entry does not fit its list; the others are still copied
          continue;
        }
        copied++;
        created.set(r.sourceId, row.id);
        if (Object.keys(fill).length) later.push({ collectionId: collection, id: row.id, values: fill });
      }
    }
    // Links inside a loop, now that every entry has its new id. A link to an entry that was never copied stays empty.
    for (const l of later) {
      const fixed: Record<string, RecordValue> = {};
      for (const [fid, old] of Object.entries(l.values)) {
        const mapped = typeof old === 'string' ? created.get(old) : undefined;
        if (mapped) fixed[fid] = mapped;
      }
      if (!Object.keys(fixed).length) continue;
      try {
        await store.records.update(app.id, l.collectionId, l.id, fixed);
      } catch (error) {
        if (!isRecordInvalid(error)) throw error; // the link stays empty
      }
    }
    for (const s of plan.state) await store.state.set(app.id, s.key, s.value);
    // The required flags go back, so the copy is the same design as the original.
    const saved = relax.length
      ? await store.apps.save({ ...first, spec: app.spec }, { summary: CLONE_COPY.summaryRules, source: 'edit', origin: 'user' })
      : first;
    return { app: saved, entriesCopied: copied, skippedEntries, skippedPictures: plan.skipped.pictures };
  } catch (error) {
    try {
      await store.apps.remove(app.id);
    } catch {
      throw new CloneLeftoverError(app.id, error); // the half-made copy is still there and the person has to know
    }
    throw error;
  }
}
