/**
 * KalamSpec 1.1 runtime behaviour: relations, layout groups, per-component style, timer, reminder
 * and signature. Pure TypeScript, tested under Vitest; renderers are in src/runtime/ui/v11.
 */
import type { KalamRecord, RecordValue } from '@/core/contracts';
import type { KalamSpec } from '@/core/spec/schema';
import { isSignatureField } from '@/core/spec/v11';
import { v11Words } from './copy';
import { relationLabel, relationOf } from './relations';
import { isSignature } from './signature';

export { V11_COPY, v11Words, type V11Words } from './copy';
export * from './layout';
export * from './relations';
export * from './reminder';
export * from './signature';
export * from './style';
export * from './timer';
export { offeredAccessModes, safeLocale, statCurrency, SUGGESTED_MODES_KEY } from '@/core/spec/v11';

/**
 * What a list row shows for a 1.1 value: a linked entry's label, or "Signed" for a signature in a
 * field a signature component fills (typed text that merely looks like one stays as typed).
 * Undefined means "not a 1.1 value, format it as before".
 */
export function v11FieldText(
  spec: KalamSpec, collection: string, field: string, value: RecordValue | undefined,
  allRecords: Readonly<Record<string, readonly KalamRecord[]>> | undefined,
): string | undefined {
  const relation = relationOf(spec, collection, field);
  if (relation) return relationLabel(spec, relation, allRecords?.[relation.collection] ?? [], value) ?? '';
  return isSignatureField(spec, collection, field) && isSignature(value) ? v11Words(spec.lang).signed : undefined;
}
