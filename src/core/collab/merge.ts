/**
 * Deterministic sync logic with no I/O (docs/14 §17.4-17.5): which entries changed on this device,
 * how two edits of one entry combine, and how a design is packed for upload and checked on the way back.
 *
 * Conflict rule: record ids, record versions and a three-way merge per field. A field changed on one
 * side only takes that side's value. A field changed on both sides to different values is a conflict
 * the person decides; until then their own value stays on screen. Nothing is overwritten silently.
 */
import type { KalamRecord, RecordValue } from '../contracts';
import { gunzipFromBase64, gzipToBase64, sha256Hex } from '../bazaar/codec';
import { stripClaimedTrust } from '../bazaar/install';
import { migrateSpec } from '../spec/migrate';
import { LOCAL_MEDIA_REF, type KalamCollection, type KalamSpec } from '../spec/schema';
import { validateSpec } from '../spec/validate';
import { COLLAB_LIMITS, syncValueSchema, type ConflictField, type LocalSpace, type RemoteSpace, type SyncValue, type SyncValues } from './model';

/** JSON with sorted keys, so the same design always hashes the same. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** The design without what differs per device: its local id, local version number and save times. */
export function designHash(spec: KalamSpec): string {
  const { createdAt: _c, updatedAt: _u, ...meta } = spec.meta;
  return sha256Hex(canonicalJson({ ...spec, id: '', version: 0, meta }));
}

/** Values that may leave the device: fields of the collection only, never photos (lead decision 3). */
export function syncable(values: Record<string, RecordValue>, collection: KalamCollection | undefined): SyncValues {
  const out: SyncValues = {};
  if (!collection) return out;
  for (const [field, def] of Object.entries(collection.fields)) {
    if (def.type === 'image' || !Object.prototype.hasOwnProperty.call(values, field)) continue;
    const v = values[field];
    if (typeof v === 'string' && LOCAL_MEDIA_REF.test(v)) continue;
    const parsed = syncValueSchema.safeParse(v ?? null);
    if (parsed.success) out[field] = parsed.data;
  }
  return out;
}

const at = (v: SyncValues, k: string): SyncValue => (Object.prototype.hasOwnProperty.call(v, k) ? (v[k] ?? null) : null);
const keysOf = (...vs: SyncValues[]) => [...new Set(vs.flatMap((v) => Object.keys(v)))];

/** Missing and null are the same value. */
export function sameValues(a: SyncValues, b: SyncValues): boolean {
  return keysOf(a, b).every((k) => at(a, k) === at(b, k));
}

/** Three-way merge. `merged` keeps `mine` for every clashing field. */
export function merge3(base: SyncValues, mine: SyncValues, theirs: SyncValues): { merged: SyncValues; clashes: ConflictField[] } {
  const merged: SyncValues = {};
  const clashes: ConflictField[] = [];
  for (const k of keysOf(base, mine, theirs)) {
    const b = at(base, k);
    const m = at(mine, k);
    const t = at(theirs, k);
    if (m === t || t === b) merged[k] = m;
    else if (m === b) merged[k] = t;
    else {
      merged[k] = m;
      clashes.push({ field: k, mine: m, theirs: t });
    }
  }
  return { merged, clashes };
}

export interface LocalChange {
  remoteId: string;
  localId: string;
  collectionId: string;
  kind: 'create' | 'update' | 'delete';
  values: SyncValues;
  /** The version this device last saw; the cloud refuses the write if it moved on. */
  baseVersion: number;
}

/**
 * Pending changes = this device's entries compared with what it last agreed with the cloud. Deriving
 * the queue from the data (rather than logging each write) means an edit made offline, or while the
 * app was closed, is never lost: it is still different from its base the next time sync runs.
 */
export function localChanges(local: Record<string, KalamRecord[]>, state: Pick<LocalSpace, 'tracked' | 'conflicts'>, spec: KalamSpec): LocalChange[] {
  const parked = new Set(state.conflicts.map((c) => c.id));
  const byLocal = new Map<string, string>();
  for (const [remoteId, t] of Object.entries(state.tracked)) if (!t.deleted && t.localId) byLocal.set(t.localId, remoteId);
  const seen = new Set<string>();
  const out: LocalChange[] = [];
  for (const [collectionId, rows] of Object.entries(local)) {
    const collection = spec.collections[collectionId];
    if (!collection) continue;
    for (const r of rows) {
      const values = syncable(r.values, collection);
      const remoteId = byLocal.get(r.id);
      if (!remoteId) {
        out.push({ remoteId: r.id, localId: r.id, collectionId, kind: 'create', values, baseVersion: 0 });
        continue;
      }
      seen.add(remoteId);
      const t = state.tracked[remoteId];
      if (t && !parked.has(remoteId) && !sameValues(values, t.base)) {
        out.push({ remoteId, localId: r.id, collectionId, kind: 'update', values, baseVersion: t.version });
      }
    }
  }
  for (const [remoteId, t] of Object.entries(state.tracked)) {
    if (t.deleted || !t.localId || seen.has(remoteId) || parked.has(remoteId) || !spec.collections[t.collectionId]) continue;
    out.push({ remoteId, localId: t.localId, collectionId: t.collectionId, kind: 'delete', values: {}, baseVersion: t.version });
  }
  return out;
}

/**
 * Photos never leave a device, so entries from other people arrive without them. In a shared app a photo
 * field therefore cannot be required, or those entries could never be saved here. Same object when nothing changes.
 */
export function sharedDesign(spec: KalamSpec): KalamSpec {
  let changed = false;
  const collections: KalamSpec['collections'] = {};
  for (const [id, c] of Object.entries(spec.collections)) {
    const fields: KalamCollection['fields'] = {};
    for (const [fid, f] of Object.entries(c.fields)) {
      if (f.type === 'image' && f.required) {
        changed = true;
        const { required: _r, ...rest } = f;
        fields[fid] = rest;
      } else fields[fid] = f;
    }
    collections[id] = { ...c, fields };
  }
  return changed ? { ...spec, collections } : spec;
}

export type PackedSpec ={ ok: true; specGz: string; specHash: string } | { ok: false; code: 'spec_too_big' };

export function packSpec(spec: KalamSpec): PackedSpec {
  const json = JSON.stringify(spec);
  if (new TextEncoder().encode(json).length > COLLAB_LIMITS.specBytes) return { ok: false, code: 'spec_too_big' };
  return { ok: true, specGz: gzipToBase64(json), specHash: sha256Hex(json) };
}

export type UnpackedSpec = { ok: true; spec: KalamSpec } | { ok: false; code: 'spec_invalid' | 'spec_newer' };

/**
 * A design from the cloud is untrusted even when it comes from a collaborator: gunzip with a size cap,
 * hash check, migrate and full validation on this device. AI-step checks are per device, so claimed
 * ones are dropped (same as a Bazaar install).
 */
export function unpackSpec(space: Pick<RemoteSpace, 'specGz' | 'specHash'>): UnpackedSpec {
  let json: string;
  let raw: unknown;
  try {
    json = gunzipFromBase64(space.specGz, COLLAB_LIMITS.specBytes);
    if (sha256Hex(json) !== space.specHash) return { ok: false, code: 'spec_invalid' };
    raw = JSON.parse(json);
  } catch {
    return { ok: false, code: 'spec_invalid' };
  }
  const migrated = migrateSpec(raw);
  if (!migrated.ok || !migrated.spec) return { ok: false, code: 'spec_newer' };
  const checked = validateSpec(migrated.spec);
  if (!checked.ok || !checked.spec) return { ok: false, code: 'spec_invalid' };
  return { ok: true, spec: stripClaimedTrust(checked.spec) };
}
