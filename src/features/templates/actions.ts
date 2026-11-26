/**
 * What the gallery, the clone sheet and the packs do to storage, as plain async functions over repository
 * interfaces. The hooks wrap these; tests run them against memory.
 */
import type { AppRepository, KalamRecord, KeyValueRepository, RecordRepository, StoredApp } from '@/core/contracts';
import {
  CLONE_COPY, CloneLeftoverError, applyClonePlan, copiesRecords, planClone, type CloneOutcome, type CloneRequest,
} from '@/core/clone';
import { instantiateCatalogEntry, type InstallChoices } from '@/core/templates/catalog';
import { copy } from './copy';

export interface TemplateDb {
  apps: Pick<AppRepository, 'save' | 'remove'>;
  records: Pick<RecordRepository, 'insert' | 'update' | 'listAll'>;
  state: Pick<KeyValueRepository, 'set' | 'all'>;
}

export interface Ids { newId: () => string; now: number; lang?: string }

export type ActionResult<T> = ({ ok: true } & T) | { ok: false; error: string };

/** Adds an app made from a gallery template to the shelf. Nothing is saved unless the design passes the checks. */
export async function installTemplate(
  db: Pick<TemplateDb, 'apps'>, entryId: string, choices: InstallChoices, ids: Ids,
): Promise<ActionResult<{ app: StoredApp }>> {
  const built = instantiateCatalogEntry(entryId, { appId: ids.newId(), now: ids.now, lang: ids.lang ?? 'en' }, choices);
  if (!built.ok) return { ok: false, error: built.error };
  const { spec, origin } = built.value;
  const app: StoredApp = { id: spec.id, spec, createdAt: ids.now, updatedAt: ids.now, origin: { ...origin } };
  try {
    await db.apps.save(app, { summary: 'Created from a template', source: 'create', origin: 'user' });
  } catch {
    return { ok: false, error: copy.preview.failed };
  }
  return { ok: true, app };
}

/** Makes a separate copy of an app. Entries are read and copied only when the request asks and is confirmed. */
export async function cloneApp(
  db: TemplateDb, source: StoredApp, request: CloneRequest, ids: Ids,
): Promise<ActionResult<{ app: StoredApp; outcome: CloneOutcome }>> {
  let records: KalamRecord[] = [];
  let state: Record<string, string | number | boolean | null> = {};
  try {
    if (copiesRecords(request.mode)) {
      records = Object.values(await db.records.listAll(source.id)).flat();
      state = await db.state.all(source.id);
    }
  } catch {
    return { ok: false, error: CLONE_COPY.errors.save };
  }
  const planned = planClone(source, request, { newId: ids.newId, now: ids.now, records, state });
  if (!planned.ok) return { ok: false, error: planned.message };
  try {
    const outcome = await applyClonePlan(planned.plan, db);
    return { ok: true, app: outcome.app, outcome };
  } catch (error) {
    return { ok: false, error: error instanceof CloneLeftoverError ? CLONE_COPY.errors.leftover : CLONE_COPY.errors.save };
  }
}
