/**
 * Restoring a backup can hand an entry a new id, when its old id already belongs to another app or
 * collection on this device. Links between entries (KalamSpec 1.1 relations) store the id, so every
 * link that pointed at a moved entry has to follow it.
 */
import type { KalamRecord } from '@/core/contracts';
import { remapLinks } from '@/core/spec/v11';
import type { KalamSpec } from '@/core/spec/schema';
import type { StorageTables } from './driver';

type Incoming = Pick<KalamRecord, 'id' | 'appId' | 'collectionId'>;

/** Old id to new id, for incoming entries whose id is already used by an entry of another app or collection. */
export async function claimNewIds(t: StorageTables, incoming: readonly Incoming[], newId: () => string): Promise<Map<string, string>> {
  const moved = new Map<string, string>();
  for (const r of incoming) {
    if (moved.has(r.id)) continue;
    const clash = await t.records.get(r.id);
    if (clash && (clash.appId !== r.appId || clash.collectionId !== r.collectionId)) moved.set(r.id, newId());
  }
  return moved;
}

/** The record with its links pointed at the new ids. Returns the same object when nothing moved or it has no links. */
export function followMoved<R extends KalamRecord>(spec: KalamSpec | undefined, record: R, moved: ReadonlyMap<string, string>): R {
  if (!moved.size || !spec) return record;
  const values = remapLinks(spec, record.collectionId, record.values, moved);
  return Object.keys(values).some((k) => values[k] !== record.values[k]) ? { ...record, values } : record;
}
