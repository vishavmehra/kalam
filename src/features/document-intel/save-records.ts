/**
 * Saves the records a person approved from documents, with the same checks the app's own Add button runs
 * (runtime/engine insertRecord): every record is checked against the WHOLE list, so a required field the
 * photo step does not read, a link or a signature is caught here and not by the storage layer. Then all
 * records are written as one transaction (applyOps), so a failure leaves the list as it was and nothing
 * is saved twice when the person presses Add again. Messages are in the app's language, as the engine's are.
 * ponytail: if the fallback rollback itself fails (a repository without `batch`, a removal that errors), a
 * few records may remain; the local database has `batch`, so this does not happen there.
 */
import type { RecordRepository, RecordValue } from '@/core/contracts';
import type { KalamSpec } from '@/core/spec/schema';
import { engineText } from '@/i18n/engine-messages';
import { ownMessage } from '@/runtime/engine/dispatch';
import { checkForm, collectionFieldDefs } from '@/runtime/engine/fields';
import { applyOps } from '@/runtime/engine/transaction';
import { machineValueErrors } from '@/runtime/engine/v11/relations';

export type SaveOutcome = { ok: true } | { ok: false; message: string };

export async function saveDocumentRecords(
  repo: RecordRepository,
  spec: KalamSpec,
  appId: string,
  collection: string,
  records: ReadonlyArray<Readonly<Record<string, RecordValue>>>,
  now: Date = new Date(),
): Promise<SaveOutcome> {
  const lang = spec.lang;
  const defs = collectionFieldDefs(spec, collection);
  if (!defs) return { ok: false, message: engineText(lang, 'missingCollection') };

  let existing;
  try {
    existing = await repo.listAll(appId);
  } catch {
    return { ok: false, message: engineText(lang, 'saveFailed') };
  }

  const ops: Array<{ op: 'insert'; collection: string; values: Record<string, RecordValue> }> = [];
  for (const form of records) {
    const { values, errors } = checkForm(defs, form, now, lang);
    for (const [f, m] of Object.entries(machineValueErrors(spec, collection, values, existing))) errors[f] ??= m;
    const [field, message] = Object.entries(errors)[0] ?? [];
    if (field) return { ok: false, message: `${defs[field]?.label ?? field}: ${message}` };
    ops.push({ op: 'insert', collection, values });
  }

  const done = await applyOps(repo, appId, ops);
  return done.ok ? { ok: true } : { ok: false, message: ownMessage(lang, done.error) ?? engineText(lang, 'saveFailed') };
}
