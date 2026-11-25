/** App Shelf state. Every mutation goes through the local database, then the shelf list is re-read. */
import { create } from 'zustand';
import type { AppVersion, StoredApp } from '@/core/contracts';
import { syncReminders } from '@/features/reminders/runtime';
import { getDatabase } from '@/infrastructure/storage/database';

interface AppsState {
  /** Shelf order: pinned first, then most recently opened/updated. */
  apps: StoredApp[];
  loading: boolean;
  refresh(): Promise<void>;
  /** Validates, persists and appends a version atomically. Throws InvalidSpecError on a bad design. */
  save(app: StoredApp, change: { summary: string; source: AppVersion['source'] }): Promise<StoredApp>;
  remove(id: string): Promise<void>;
  pin(id: string, pinned: boolean): Promise<void>;
  /** Remix: new id, meta.basedOn = id, version 1. Records are not copied. */
  duplicate(id: string): Promise<StoredApp>;
  /** Makes an older design the current one as a new version; history and records are kept. */
  restore(id: string, version: number): Promise<StoredApp>;
}

export const useAppsStore = create<AppsState>()((set, get) => {
  const db = () => getDatabase();
  const after = async <T>(result: T): Promise<T> => {
    await get().refresh();
    return result;
  };
  return {
    apps: [],
    loading: false,
    async refresh() {
      set({ loading: true });
      try {
        set({ apps: await db().apps.list() });
      } finally {
        set({ loading: false });
      }
    },
    save: async (app, change) => after(await db().apps.save(app, change)),
    async remove(id) {
      await db().apps.remove(id);
      set({ apps: get().apps.filter((a) => a.id !== id) });
      // Cancel the deleted app's notifications now. Never throws.
      void syncReminders(id);
    },
    async pin(id, pinned) {
      const app = await db().apps.get(id);
      if (!app) return;
      await after(await db().apps.save({ ...app, pinned }, { summary: pinned ? 'Pinned' : 'Unpinned', source: 'edit' }));
    },
    duplicate: async (id) => after(await db().duplicate(id)),
    restore: async (id, version) => after(await db().restore(id, version)),
  };
});
