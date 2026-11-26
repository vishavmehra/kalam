/**
 * Schema-v3 repository: app-to-app sharing links (docs/14 §16, §24 `appShares`). One table of plain
 * link rows, indexed by both apps so deleting either app removes its links in the same transaction
 * (see `removeAppCascade`). Every row is validated on the way in and again on the way out, so a row
 * written by a bug or an older build can never widen what a link allows.
 */
import { parseShareLink, type ShareLink } from '@/core/share/model';
import { newestFirst, reopens, ShareStoreError, type ShareLinkStore } from '@/core/share/store';
import type { StorageDriver, StorageTables } from './driver';

export interface ShareLinkRepository extends ShareLinkStore {
  /** Tells subscribers something changed without a write through this repository (a cascade delete). */
  notifyChanged(): void;
}

/** Deletes the links of an app inside an open transaction. Returns how many rows went. */
export async function removeLinksOfApp(t: StorageTables, appId: string): Promise<number> {
  const gone = (await t.shareLinks.where('sourceAppId', appId)).length + (await t.shareLinks.where('destinationAppId', appId)).length;
  await t.shareLinks.deleteWhere('sourceAppId', appId);
  await t.shareLinks.deleteWhere('destinationAppId', appId);
  return gone;
}

const valid = (rows: readonly unknown[]): ShareLink[] =>
  rows.flatMap((row) => {
    const parsed = parseShareLink(row);
    return parsed.ok ? [parsed.link] : [];
  });

export function createShareLinkRepository(driver: StorageDriver): ShareLinkRepository {
  const { tables } = driver;
  const listeners = new Set<() => void>();
  const notifyChanged = () => {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // A listener must not break a write that already happened.
      }
    }
  };
  return {
    notifyChanged,
    async list() {
      return valid(await tables.shareLinks.all()).sort(newestFirst);
    },
    async forApp(appId) {
      const rows = [...(await tables.shareLinks.where('sourceAppId', appId)), ...(await tables.shareLinks.where('destinationAppId', appId))];
      const unique = new Map(valid(rows).map((l) => [l.id, l]));
      return [...unique.values()].sort(newestFirst);
    },
    async get(id) {
      return valid([await tables.shareLinks.get(id)])[0];
    },
    async put(link) {
      const parsed = parseShareLink(link);
      if (!parsed.ok) throw new ShareStoreError();
      const row = parsed.link;
      await driver.transaction(async (t) => {
        // Both apps must exist when the link is written, so a link can never outlive an app deleted a moment ago.
        if (!(await t.apps.get(row.sourceAppId)) || !(await t.apps.get(row.destinationAppId))) {
          throw new ShareStoreError('One of the two apps is not on this device.');
        }
        // A turned off link stays off, even if a send that started earlier finishes later.
        if (reopens(valid([await t.shareLinks.get(row.id)])[0], row)) throw new ShareStoreError('This link was turned off.');
        await t.shareLinks.put(row);
      });
      notifyChanged();
    },
    async remove(id) {
      await tables.shareLinks.delete(id);
      notifyChanged();
    },
    async removeForApp(appId) {
      const n = await driver.transaction((t) => removeLinksOfApp(t, appId));
      if (n) notifyChanged();
      return n;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
