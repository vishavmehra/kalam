import { describe, expect, it, vi } from 'vitest';
import { fixtureApp, fixtureSpec, PNG_BASE64 } from '@/core/backup/test-fixtures';

const { asyncData, syncAllReminders } = vi.hoisted(() => ({
  asyncData: new Map<string, string>(),
  syncAllReminders: vi.fn(async () => [] as unknown[]),
}));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => asyncData.get(k) ?? null,
    setItem: async (k: string, v: string) => void asyncData.set(k, v),
    removeItem: async (k: string) => void asyncData.delete(k),
  },
}));
vi.mock('@/infrastructure/storage/database', async () => {
  const web = await vi.importActual<typeof import('@/infrastructure/storage/database.web')>('@/infrastructure/storage/database.web');
  const db = web.createWebDatabase('wipe-test');
  return { getDatabase: () => db };
});
vi.mock('@/features/reminders/runtime', () => ({ syncAllReminders, syncReminders: vi.fn() }));
vi.mock('@/features/widgets/service', () => ({ clearWidgets: vi.fn(async () => undefined) }));

const { getDatabase } = await import('@/infrastructure/storage/database');
const { flushCreationDraft, useCreationStore } = await import('@/state/creation-store');
const { wipeLocalData } = await import('./wipe');

describe('Delete everything', () => {
  it('leaves no app, record, draft, saved answer or per-app choice, and clears the draft on screen', async () => {
    const db = getDatabase();
    await new Promise<void>((resolve) => {
      if (useCreationStore.persist.hasHydrated()) resolve();
      else useCreationStore.persist.onFinishHydration(() => resolve());
    });
    const spec = fixtureSpec();
    await db.apps.save(fixtureApp(spec), { summary: 'Created', source: 'create' });
    await db.records.insert(spec.id, 'expenses', { title: 'Tea for Asha', amount: 20 });
    await db.aiCache.set('k1', { answer: 'x' }, { taskType: 'classify', source: 'cloud' });
    asyncData.set(`kalam.appLanguage.${spec.id}`, 'hi');
    const s = useCreationStore.getState();
    s.setText('Credit book for my kirana shop');
    s.addPhotos([{ id: 'img_1', mimeType: 'image/png', base64: PNG_BASE64, width: 1, height: 1, source: 'photo' }]);
    s.setPreferences({ currency: 'INR' });
    await flushCreationDraft();
    expect(await db.sessions.list()).toHaveLength(1);

    await wipeLocalData();

    expect(await db.apps.list()).toEqual([]);
    expect(await db.records.listAll(spec.id)).toEqual({});
    expect(await db.sessions.list()).toEqual([]);
    expect(await db.aiCache.size()).toBe(0);
    expect((await db.blobs.usage()).count).toBe(0);
    expect(await db.events.list()).toEqual([]);
    expect(asyncData.has(`kalam.appLanguage.${spec.id}`)).toBe(false);
    const after = useCreationStore.getState();
    expect(after.text).toBe('');
    expect(after.photos).toEqual([]);
    expect(after.preferences.currency).toBe('INR'); // a preference, like settings, stays
    expect(syncAllReminders).toHaveBeenCalledTimes(1);

    // Nothing comes back once the autosave has run.
    await flushCreationDraft();
    expect(await db.sessions.list()).toEqual([]);
  });
});
