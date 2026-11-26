/**
 * Cloning an app (docs/14 §19). Pure planning: nothing is read from or written to storage here.
 *
 * - The copy gets a new id, version 1, new dates and no history of its own. The original is never touched.
 * - Default is the design only, with the standard look (docs/14 §19.2). The look and the entries are opt in, and
 *   entries are copied only after an explicit confirmation.
 * - Links between entries are carried over: `applyClonePlan` gives every copied entry a new id and rewrites the
 *   links to match, so the copy never points back at the original's entries.
 * - Pictures stay with the original (they are local files). A copied entry that had one simply has no picture.
 */
import type { KalamRecord, RecordValue, StoredApp } from '../contracts';
import { appIdSchema, LIMITS, type KalamSpec } from '../spec/schema';
import { validateSpec } from '../spec/validate';
import { themeFromPreset } from '../templates/themes';
import { cloneSpec } from '../versioning';
import { CLONE_COPY } from './copy';

/**
 * The three choices on the clone sheet, from least to most copied (docs/14 §19.2 lists four). Decisions:
 *  - "Structure and selected sample configuration" is not a separate choice: a template's sample data belongs to the
 *    gallery preview (§12.5), and an app a person already owns has no sample configuration to pick. Its saved values
 *    (counters, switches) travel with the entries, in the last choice.
 *  - The last choice keeps the original's look. Entries with the standard look would be a fourth choice that nobody
 *    asked for; the look can be changed on the copy in one step.
 */
export const CLONE_MODES = ['design', 'design_theme', 'with_records'] as const;
export type CloneMode = (typeof CLONE_MODES)[number];
export const DEFAULT_CLONE_MODE: CloneMode = 'design';

export interface CloneRequest {
  name: string;
  mode: CloneMode;
  /** The person has said yes to copying entries. Required for `with_records`, ignored otherwise. */
  confirmedRecords?: boolean;
}

export interface CloneContext {
  /** A fresh app id, e.g. `app_k3f9x2ab`. */
  newId: () => string;
  now: number;
  /** Every entry of the original app. Only read for `with_records`. */
  records?: readonly KalamRecord[];
  /** Saved values of the original app (counters). Only read for `with_records`. */
  state?: Readonly<Record<string, RecordValue>>;
}

export interface PlannedRecord {
  collectionId: string;
  /** Id of the entry in the original. `applyClonePlan` maps it to the new entry's id. */
  sourceId: string;
  /** When the entry was first added. Carried for ordering only: the repository stamps a copied entry with the copy time. */
  createdAt: number;
  values: Record<string, RecordValue>;
}

export interface ClonePlan {
  app: StoredApp;
  /** Text for the new app's first version. */
  summary: string;
  records: PlannedRecord[];
  state: Array<{ key: string; value: RecordValue }>;
  skipped: { pictures: number };
}

export type CloneErrorCode = 'invalid_name' | 'needs_confirmation' | 'invalid_design' | 'invalid_id';
export type CloneResult = { ok: true; plan: ClonePlan } | { ok: false; code: CloneErrorCode; message: string };

const E = CLONE_COPY.errors;
const own = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** Whether a mode brings the original's colours and style across. */
export const copiesLook = (mode: CloneMode): boolean => mode !== 'design';
export const copiesRecords = (mode: CloneMode): boolean => mode === 'with_records';

/**
 * "Name (copy)", then "Name (copy 2)" and so on, never the same as an app that already exists and never longer than
 * an app name may be (the original name is shortened, the suffix is kept).
 */
export function defaultCloneName(sourceName: string, existing: readonly string[] = []): string {
  const taken = new Set(existing.map((n) => n.trim().toLowerCase()));
  for (let n = 1; n < 1000; n++) {
    const suffix = ` ${CLONE_COPY.copySuffix(n)}`;
    const name = `${sourceName.trim().slice(0, LIMITS.nameLength - suffix.length).trimEnd()}${suffix}`;
    if (!taken.has(name.toLowerCase())) return name;
  }
  return `${sourceName.trim().slice(0, LIMITS.nameLength - 8)} (copy)`;
}

/** The colours, type and icon colour of `source`, applied to `target`. Nothing else changes ("copy the look"). */
export function applyLookFrom(target: KalamSpec, source: KalamSpec): KalamSpec {
  const out = cloneSpec(target);
  out.theme = { ...source.theme };
  if (out.icon) out.icon = { ...out.icon, background: source.icon?.background ?? source.theme.primary, foreground: source.icon?.foreground ?? '#FFFFFF' };
  return out;
}

/** The standard look: what a new app has before anyone changes it. */
function withStandardLook(spec: KalamSpec): KalamSpec {
  const theme = themeFromPreset('calm_green');
  return { ...spec, theme, ...(spec.icon ? { icon: { ...spec.icon, background: theme.primary, foreground: '#FFFFFF' } } : {}) };
}

/** Fields of one collection that hold a picture (a reference to a local file). */
function pictureFields(spec: KalamSpec, collectionId: string): string[] {
  const def = own(spec.collections, collectionId) ? spec.collections[collectionId] : undefined;
  return def ? Object.entries(def.fields).filter(([, f]) => f.type === 'image').map(([id]) => id) : [];
}

/** How many of these entries a copy would carry: those in a list the design still has. The same filter as `planClone`. */
export function countCopyableEntries(spec: KalamSpec, records: readonly KalamRecord[]): number {
  return records.filter((r) => own(spec.collections, r.collectionId)).length;
}

/** How many saved pictures a copy of these entries would leave behind. Shown in the confirmation before copying. */
export function countPictures(spec: KalamSpec, records: readonly KalamRecord[]): number {
  let n = 0;
  for (const r of records) for (const f of pictureFields(spec, r.collectionId)) if (r.values[f] !== null && r.values[f] !== undefined && r.values[f] !== '') n++;
  return n;
}

export function planClone(source: StoredApp, request: CloneRequest, ctx: CloneContext): CloneResult {
  const name = request.name.trim();
  if (!name || name.length > LIMITS.nameLength) return { ok: false, code: 'invalid_name', message: E.name };
  const wantsRecords = copiesRecords(request.mode);
  if (wantsRecords && request.confirmedRecords !== true) return { ok: false, code: 'needs_confirmation', message: E.confirm };

  const id = ctx.newId();
  if (!appIdSchema.safeParse(id).success) return { ok: false, code: 'invalid_id', message: E.save };

  let spec = cloneSpec(source.spec);
  spec = { ...spec, id, version: 1, name };
  // The same rules as a Shelf duplicate (core/bazaar lineage): the original stays the parent, and its licence stays.
  spec.meta = { ...spec.meta, createdAt: ctx.now, updatedAt: ctx.now, basedOn: source.id, source: 'remix' };
  if (!copiesLook(request.mode)) spec = withStandardLook(spec);

  const checked = validateSpec(spec);
  if (!checked.ok) return { ok: false, code: 'invalid_design', message: E.design };

  const records: PlannedRecord[] = [];
  let pictures = 0;
  const state: ClonePlan['state'] = [];
  if (wantsRecords) {
    const ordered = [...(ctx.records ?? [])]
      .filter((r) => r.appId === source.id && own(spec.collections, r.collectionId))
      .sort((a, b) => a.createdAt - b.createdAt);
    for (const r of ordered) {
      const values: Record<string, RecordValue> = {};
      const fields = spec.collections[r.collectionId]?.fields ?? {};
      for (const [fid, v] of Object.entries(r.values)) {
        if (!own(fields, fid)) continue; // a value from an older design that no field holds any more
        if (fields[fid]?.type === 'image') {
          if (v !== null && v !== '') pictures++;
          continue;
        }
        values[fid] = v;
      }
      records.push({ collectionId: r.collectionId, sourceId: r.id, createdAt: r.createdAt, values });
    }
    for (const [key, value] of Object.entries(ctx.state ?? {})) state.push({ key, value });
  }

  const app: StoredApp = {
    id, spec, createdAt: ctx.now, updatedAt: ctx.now,
    // Where the design came from stays true; the original's own prompt and checks stay with the original.
    origin: { ...source.origin },
  };
  return { ok: true, plan: { app, summary: CLONE_COPY.summary(source.spec.name), records, state, skipped: { pictures } } };
}
