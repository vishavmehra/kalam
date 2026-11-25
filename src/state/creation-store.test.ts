import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreationResult, NormalizedImage } from '@/core/contracts';
import { fixtureSpec, PNG_BASE64 } from '@/core/backup/test-fixtures';

// AsyncStorage and the database survive a simulated reload (vi.resetModules), like on a device.
vi.mock('@react-native-async-storage/async-storage', () => {
  const g = globalThis as { __asyncData?: Map<string, string> };
  const data = (g.__asyncData ??= new Map<string, string>());
  return {
    default: {
      getItem: async (k: string) => data.get(k) ?? null,
      setItem: async (k: string, v: string) => void data.set(k, v),
      removeItem: async (k: string) => void data.delete(k),
    },
  };
});
vi.mock('@/infrastructure/storage/database', async () => {
  const web = await vi.importActual<typeof import('@/infrastructure/storage/database.web')>('@/infrastructure/storage/database.web');
  const db = web.createWebDatabase('creation-store-test');
  return { getDatabase: () => db };
});

const asyncData = () => ((globalThis as { __asyncData?: Map<string, string> }).__asyncData ??= new Map<string, string>());
const image = (id: string, source: NormalizedImage['source'] = 'photo'): NormalizedImage => ({
  id, mimeType: 'image/png', base64: PNG_BASE64, width: 1, height: 1, source,
});

/** Fresh module = app start. Resolves once the stored draft has been read. */
async function boot() {
  vi.resetModules();
  const mod = await import('./creation-store');
  const db = (await import('@/infrastructure/storage/database')).getDatabase();
  await new Promise<void>((resolve) => {
    if (mod.useCreationStore.persist.hasHydrated()) resolve();
    else mod.useCreationStore.persist.onFinishHydration(() => resolve());
  });
  return { ...mod, db };
}

const warn = vi.spyOn(console, 'warn');
beforeEach(() => warn.mockClear());

describe('creation session privacy and recovery', () => {
  it('moves a wave-1 AsyncStorage draft into the local database and deletes the old entry', async () => {
    asyncData().set('kalam.creation-session', JSON.stringify({
      state: { text: 'Old shop idea', preferences: { language: 'hi' }, modality: 'voice', voice: { transcript: 'old words', recognizedBy: 'on_device' } },
      version: 1,
    }));
    const { useCreationStore, db } = await boot();
    const s = useCreationStore.getState();
    expect(s.text).toBe('Old shop idea');
    expect(s.voice).toEqual({ transcript: 'old words', recognizedBy: 'on_device' });
    expect(s.preferences.language).toBe('hi');
    expect(asyncData().has('kalam.creation-session')).toBe(false);
    expect((await db.sessions.latest())?.audioTranscript).toBe('old words');
  });

  it('keeps text, transcript and pictures only in the local database, and restores them after a reload', async () => {
    let app = await boot();
    const s = app.useCreationStore.getState();
    s.setText('Credit book for my kirana shop');
    s.addPhotos([image('img_1')]);
    s.setVoice({ transcript: 'customers pay at month end', recognizedBy: 'cloud_service', audioUri: 'blob:raw-audio', durationSec: 4 });
    s.setVideo({ durationSec: 12, frames: [image('vf_1', 'video_frame')], droppedFrames: 2 });
    s.attachDrawing({
      title: 'Shop sketch',
      summary: { drawingId: 'drw_1', pageCount: 1, elements: [{ kind: 'stamp:list', label: 'Customers', page: 1, bbox: [0, 0, 10, 10] }], texts: ['Customers'], images: [image('pg_1_png', 'drawing')] },
    });
    s.setPreferences({ currency: 'INR' });
    await app.flushCreationDraft();

    const session = await app.db.sessions.latest();
    expect(session).toMatchObject({ text: 'Credit book for my kirana shop', audioTranscript: 'customers pay at month end', drawingId: 'drw_1', state: 'draft' });
    expect(session?.attachmentIds).toHaveLength(3);
    expect((await app.db.blobs.usage()).count).toBe(3);
    const stored = [...asyncData().values()].join(' ');
    expect(stored).not.toContain('kirana');
    expect(stored).not.toContain('month end');
    expect(stored).not.toContain('raw-audio');

    app = await boot();
    const r = app.useCreationStore.getState();
    expect(r.text).toBe('Credit book for my kirana shop');
    expect(r.photos).toEqual([image('img_1')]);
    expect(r.voice).toEqual({ transcript: 'customers pay at month end', recognizedBy: 'cloud_service', durationSec: 4 }); // no raw audio
    expect(r.video).toEqual({ durationSec: 12, frames: [image('vf_1', 'video_frame')], droppedFrames: 2 });
    expect(r.drawing?.summary.images).toEqual([image('pg_1_png', 'drawing')]);
    expect(r.drawing?.summary.elements[0].label).toBe('Customers');
    expect(r.preferences.currency).toBe('INR');
    expect(r.run.status).toBe('idle');

    r.removePhoto('img_1');
    await app.flushCreationDraft();
    expect((await app.db.blobs.usage()).count).toBe(2);
  });

  it('restores a built but unsaved app, and deletes the draft and its files once the app is saved', async () => {
    let app = await boot();
    const result: CreationResult = {
      ok: true, spec: fixtureSpec(), route: 'cloud', provider: 'firebase', warnings: [], errors: [], latencyMs: 5,
      classification: {
        taskType: 'create_app', complexity: 'medium', estimatedScreens: 1, estimatedCollections: 1, estimatedActions: 1,
        requiresMultimodalReasoning: false, requiresCloudReasoning: true, confidence: 0.9, method: 'deterministic', reasons: [],
      },
    };
    const s = app.useCreationStore.getState();
    s.startRun();
    s.finishRun(result, { text: 'x', photos: [], preferences: { language: 'en' } });
    await app.flushCreationDraft();
    expect((await app.db.sessions.latest())?.state).toBe('review');

    app = await boot();
    const r = app.useCreationStore.getState();
    expect(r.result?.spec?.id).toBe('app_expenses');
    expect(r.run.status).toBe('succeeded');
    expect(r.resultDraft?.text).toBe('Credit book for my kirana shop');

    r.resetSession();
    await app.flushCreationDraft();
    expect(await app.db.sessions.latest()).toBeUndefined();
    expect((await app.db.blobs.usage()).count).toBe(0);
    expect(app.useCreationStore.getState().preferences.currency).toBe('INR'); // preferences stay
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('[kalam/creation]'), expect.anything());
  });

  it('can keep the pictures with the saved app when the person asks', async () => {
    const app = await boot();
    app.useCreationStore.getState().addPhotos([image('img_keep')]);
    await app.flushCreationDraft();
    const [blobId] = (await app.db.sessions.latest())?.attachmentIds ?? [];
    app.useCreationStore.getState().resetSession({ keepInputsWith: 'app_expenses' });
    await app.flushCreationDraft();
    expect(await app.db.sessions.latest()).toBeUndefined();
    expect((await app.db.blobs.get(blobId))?.ownerId).toBe('app_expenses');
  });
});
