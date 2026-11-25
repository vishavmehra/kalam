/**
 * Where links live. The device database implements this (`src/infrastructure/storage/share-links.ts`);
 * the in-memory version below is for tests and previews. Both validate every link on the way in and out.
 */
import { parseShareLink, type ShareLink } from './model';

export interface ShareLinkStore {
  /** Every valid link, newest first. Rows that no longer pass validation are left out. */
  list(): Promise<ShareLink[]>;
  /** Links where `appId` is the source or the destination. */
  forApp(appId: string): Promise<ShareLink[]>;
  get(id: string): Promise<ShareLink | undefined>;
  /** Validates, then stores. Throws a `ShareStoreError` for a link that is malformed or names an app that is not there. */
  put(link: ShareLink): Promise<void>;
  remove(id: string): Promise<void>;
  /** Deletes every link where `appId` is either side. Returns how many were removed. */
  removeForApp(appId: string): Promise<number>;
  /** Called after any change. Returns unsubscribe. */
  subscribe(listener: () => void): () => void;
}

export class ShareStoreError extends Error {
  constructor(message = 'This link is not in a form Kalam can keep.') {
    super(message);
    this.name = 'ShareStoreError';
  }
}

/** Sorts newest first, the order every store returns. */
export const newestFirst = (a: ShareLink, b: ShareLink): number => b.createdAt - a.createdAt;

export function createMemoryShareLinkStore(initial: readonly ShareLink[] = []): ShareLinkStore {
  const rows = new Map<string, ShareLink>(initial.map((l) => [l.id, l]));
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const l of [...listeners]) l();
  };
  const valid = () => [...rows.values()].flatMap((r) => {
    const p = parseShareLink(r);
    return p.ok ? [p.link] : [];
  }).sort(newestFirst);
  return {
    list: async () => valid(),
    forApp: async (appId) => valid().filter((l) => l.sourceAppId === appId || l.destinationAppId === appId),
    get: async (id) => valid().find((l) => l.id === id),
    async put(link) {
      const p = parseShareLink(link);
      if (!p.ok) throw new ShareStoreError();
      rows.set(p.link.id, JSON.parse(JSON.stringify(p.link)) as ShareLink);
      changed();
    },
    async remove(id) {
      if (rows.delete(id)) changed();
    },
    async removeForApp(appId) {
      const gone = [...rows.values()].filter((l) => l.sourceAppId === appId || l.destinationAppId === appId);
      for (const l of gone) rows.delete(l.id);
      if (gone.length) changed();
      return gone.length;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
