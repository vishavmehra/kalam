/** The widget service over this device's real database (the web one, on an in-memory IndexedDB) and the device store. */
import { describe, expect, it, vi } from 'vitest';
import { newDraft, widgetSources } from '@/core/widgets';
import { chaiSpec, storedApp } from '@/core/widgets/test-kit';

const { asyncData } = vi.hoisted(() => ({ asyncData: new Map<string, string>() }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => asyncData.get(k) ?? null,
    setItem: async (k: string, v: string) => void asyncData.set(k, v),
    removeItem: async (k: string) => void asyncData.delete(k),
  },
}));

const { getDatabase } = await import('@/infrastructure/storage/database');
const { clearWidgets, getWidgetService, getWidgetStore, syncWidgets } = await import('./service');
const { WIDGETS_STORAGE_KEY } = await import('./device-store');

describe('the widget service on this device', () => {
  it('is built once, reads the real apps and entries, and forgets widgets of a deleted app', async () => {
    const db = getDatabase();
    const spec = chaiSpec('app_chai01');
    await db.apps.save(storedApp(spec), { summary: 'Created', source: 'create' });
    await db.records.insert(spec.id, 'orders', { name: 'Tea', qty: 4 });

    const service = getWidgetService();
    expect(getWidgetService()).toBe(service);
    const stat = (await service.candidates(spec.id)).find((c) => c.kind === 'stat');
    expect(stat?.key).toBe('stat:home:cups');

    const preview = await service.preview(newDraft(spec.id, 'Cups', widgetSources(spec)[0].ref));
    expect(preview).toMatchObject({ ok: true, body: { headline: '4 cups' } });

    const made = await service.create(newDraft(spec.id, 'Cups', widgetSources(spec)[0].ref));
    expect(made.ok).toBe(true);
    expect(await getWidgetStore().list()).toHaveLength(1);
    expect(asyncData.get(WIDGETS_STORAGE_KEY)).toContain('Cups');

    // The web has no home-screen widgets: sync says so and does not fail.
    expect(await syncWidgets('open')).toMatchObject({ platform: 'unsupported', removed: 0 });

    await db.apps.remove(spec.id);
    expect(await syncWidgets('open')).toMatchObject({ removed: 1 });
    expect(await getWidgetStore().list()).toEqual([]);
  });

  it('clearWidgets removes everything the feature keeps on the device', async () => {
    const db = getDatabase();
    const spec = chaiSpec('app_chai02');
    await db.apps.save(storedApp(spec), { summary: 'Created', source: 'create' });
    await getWidgetService().create(newDraft(spec.id, 'Cups', widgetSources(spec)[0].ref));
    await getWidgetService().setPrefs({ webShortcuts: true });
    expect(asyncData.has(WIDGETS_STORAGE_KEY)).toBe(true);
    await clearWidgets();
    expect(asyncData.has(WIDGETS_STORAGE_KEY)).toBe(false);
    expect(await getWidgetStore().list()).toEqual([]);
    expect(await getWidgetStore().prefs()).toEqual({ webShortcuts: false });
  });
});
