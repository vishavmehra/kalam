/** Kalam shell settings, persisted locally (never in the cloud). Call `load()` once at startup. */
import { create } from 'zustand';
import { DEFAULT_SETTINGS, type KalamSettings } from '@/core/contracts';
import { getDatabase } from '@/infrastructure/storage/database';

interface SettingsState {
  settings: KalamSettings;
  /** False until the stored settings have been read; gate onboarding redirects on it. */
  hydrated: boolean;
  load(): Promise<void>;
  /** Optimistic: the UI updates immediately and rolls back if the write fails. */
  update(patch: Partial<KalamSettings>): Promise<void>;
}

export const useSettingsStore = create<SettingsState>()((set, get) => ({
  settings: DEFAULT_SETTINGS,
  hydrated: false,
  async load() {
    set({ settings: await getDatabase().settings.get(), hydrated: true });
  },
  async update(patch) {
    const previous = get().settings;
    set({ settings: { ...previous, ...patch, accessModes: { ...previous.accessModes, ...patch.accessModes } } });
    try {
      set({ settings: await getDatabase().settings.update(patch) });
    } catch (error) {
      set({ settings: previous });
      throw error;
    }
  },
}));
