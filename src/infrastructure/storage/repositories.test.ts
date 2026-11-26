import { describe, expect, it } from 'vitest';
import { DEFAULT_SPEECH, type CreationSession } from '@/core/contracts';
import { fixtureApp, fixtureSpec, PNG_BASE64 } from '@/core/backup/test-fixtures';
import { createWebDatabase } from './database.web';
import { BlobTooLargeError, isRecordLimitError, RecordLimitError, type DatabaseOptions } from './kalam-database';
import { aiCacheKey } from './repositories';
import { AI_CACHE_CAP, MAX_SESSIONS, RECORD_CAP, SESSION_TTL_MS } from './storage-limits';

let n = 0;
const fresh = (opts?: DatabaseOptions) => createWebDatabase(`repo-test-${++n}-${Date.now()}`, opts);

const create = { summary: 'Created', source: 'create' } as const;
const session = (id: string, updatedAt: number, extra: Partial<CreationSession> = {}): CreationSession => ({
  id, state: 'draft', createdAt: updatedAt, updatedAt, text: 'a shop app', attachmentIds: [], ...extra,
});

describe('limits', () => {
  it('uses the documented caps', () => {
    expect(RECORD_CAP).toBe(5_000);
    expect(AI_CACHE_CAP).toBe(500);
  });
});

describe('translations', () => {
  it('stores per app + language, keeps optional translate-service fields, and goes with the app', async () => {
    const db = fresh();
    await db.apps.save(fixtureApp(fixtureSpec()), create);
    const entry = {
      appId: 'app_expenses', version: 1, lang: 'hi', sourceHash: 'h1', strings: { name: 'खर्च' }, createdAt: 5, source: 'on_device' as const,
      engineVersion: 'translate-v2', model: 'gemini-nano', corrected: { name: 'ख़र्च' },
    };
    await db.translations.put(entry);
    expect(await db.translations.get('app_expenses', 'hi')).toEqual(entry);
    expect(await db.translations.listForApp('app_expenses')).toHaveLength(1);
    // A hostile key never pollutes prototypes or lands as an own "__proto__" label.
    await db.translations.put({ ...entry, lang: 'ta', strings: JSON.parse('{"__proto__":"x","name":"y"}') }).catch(() => undefined);
    const hostile = await db.translations.get('app_expenses', 'ta');
    expect(hostile === undefined || !Object.prototype.hasOwnProperty.call(hostile.strings, '__proto__')).toBe(true);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
    await expect(db.translations.put({ ...entry, lang: 'not a lang' })).rejects.toThrow(/expected shape/);
    await db.apps.remove('app_expenses');
    expect(await db.translations.get('app_expenses', 'hi')).toBeUndefined();
  });
});

describe('blobs', () => {
  it('stores local files with size, removes by owner and cascades with apps, drawings and sessions', async () => {
    const db = fresh();
    await db.apps.save(fixtureApp(fixtureSpec()), create);
    await db.drawings.save({ id: 'drw_1', title: 'Sketch', createdAt: 1, updatedAt: 1, pages: [] });
    const put = (id: string, ownerId?: string) => db.blobs.put({ id, kind: 'image', mimeType: 'image/png', base64: PNG_BASE64, ...(ownerId ? { ownerId } : {}) });
    const first = await put('b1', 'app_expenses');
    expect(first.bytes).toBe(68);
    expect(first.createdAt).toBeGreaterThan(0);
    await put('b2', 'app_expenses');
    await put('b3', 'drw_1');
    await put('b4', 's_1');
    await put('b5');
    expect(await db.blobs.usage()).toEqual({ count: 5, bytes: 5 * 68 });
    expect(await db.blobs.removeByOwner('nobody')).toBe(0);

    await db.apps.remove('app_expenses');
    await db.drawings.remove('drw_1');
    await db.sessions.save(session('s_1', Date.now()));
    await db.sessions.remove('s_1');
    expect((await db.blobs.usage()).count).toBe(1);
    expect(await db.blobs.get('b5')).toBeDefined();
  });

  it('rejects files that are too large or not valid', async () => {
    const db = fresh();
    await expect(db.blobs.put({ id: 'big', kind: 'image', mimeType: 'image/png', base64: 'A'.repeat(14_000_000) })).rejects.toBeInstanceOf(BlobTooLargeError);
    await expect(db.blobs.put({ id: 'bad', kind: 'image', mimeType: 'image/png', base64: 'not base64!' })).rejects.toThrow(/not a valid/);
    await expect(db.blobs.put({ id: '../escape', kind: 'image', mimeType: 'image/png', base64: PNG_BASE64 })).rejects.toThrow();
  });
});

describe('AI cache (LRU)', () => {
  it('evicts the least recently used entry, and a read counts as a use', async () => {
    let clock = 1_000;
    const db = fresh({ now: () => ++clock, aiCacheCap: 3 });
    const meta = { taskType: 'classify' as const, source: 'on_device' as const };
    await db.aiCache.set('a', { label: 'Food' }, meta);
    await db.aiCache.set('b', { label: 'Travel' }, meta);
    await db.aiCache.set('c', 3, meta);
    expect(await db.aiCache.get('a')).toEqual({ label: 'Food' }); // a is now the newest use
    await db.aiCache.set('d', 4, meta);
    expect(await db.aiCache.size()).toBe(3);
    expect(await db.aiCache.get('b')).toBeUndefined(); // b was least recently used
    expect(await db.aiCache.get('a')).toEqual({ label: 'Food' });
    await db.aiCache.clear();
    expect(await db.aiCache.size()).toBe(0);
  });

  it('expires old entries, skips huge or unserialisable values, and builds order-free keys', async () => {
    let clock = 0;
    const db = fresh({ now: () => clock, aiCacheTtlMs: 100 });
    const meta = { taskType: 'summarize' as const, source: 'cloud' as const };
    await db.aiCache.set('k', 'value', meta);
    clock = 50;
    expect(await db.aiCache.get('k')).toBe('value');
    clock = 200;
    expect(await db.aiCache.get('k')).toBeUndefined();
    await db.aiCache.set('huge', 'x'.repeat(300_000), meta);
    await db.aiCache.set('fn', { f: () => 1, n: 1n } as unknown, meta);
    expect(await db.aiCache.size()).toBe(0);
    expect(aiCacheKey('translate', { lang: 'hi', input: 'abc', v: 1 })).toBe(aiCacheKey('translate', { v: 1, input: 'abc', lang: 'hi' }));
    expect(aiCacheKey('translate', { lang: 'hi' })).not.toBe(aiCacheKey('translate', { lang: 'ta' }));
  });
});

describe('AI cache and app deletion', () => {
  it('removes one answer, and every answer of an app when the app is deleted, and no other', async () => {
    const db = fresh();
    await db.apps.save(fixtureApp(fixtureSpec()), create);
    const meta = { taskType: 'classify' as const, source: 'on_device' as const };
    await db.aiCache.set('mine-1', 1, { ...meta, appId: 'app_expenses' });
    await db.aiCache.set('mine-2', 2, { ...meta, appId: 'app_expenses' });
    await db.aiCache.set('theirs', 3, { ...meta, appId: 'app_other' });
    await db.aiCache.set('nobody', 4, meta);
    await db.aiCache.remove?.('mine-1');
    expect(await db.aiCache.get('mine-1')).toBeUndefined();
    await db.aiCache.removeForApp?.('app_other');
    expect(await db.aiCache.get('theirs')).toBeUndefined();
    expect(await db.aiCache.get('mine-2')).toBe(2);
    await db.apps.remove('app_expenses');
    expect(await db.aiCache.get('mine-2')).toBeUndefined();
    expect(await db.aiCache.get('nobody')).toBe(4); // an answer with no owner is left alone
  });
});

describe('sessions', () => {
  it('saves, returns the latest, keeps draft details, and prunes old or expired drafts with their files', async () => {
    let clock = 10 * SESSION_TTL_MS;
    const db = fresh({ now: () => clock });
    for (let i = 0; i < MAX_SESSIONS + 2; i++) {
      await db.blobs.put({ id: `f${i}`, kind: 'image', mimeType: 'image/png', base64: PNG_BASE64, ownerId: `s_${i}` });
      await db.sessions.save(session(`s_${i}`, clock + i, { draft: { modality: 'photo' } } as Partial<CreationSession>));
    }
    const list = await db.sessions.list();
    expect(list).toHaveLength(MAX_SESSIONS);
    expect(list[0].id).toBe(`s_${MAX_SESSIONS + 1}`);
    expect(list[0].draft).toEqual({ modality: 'photo' });
    expect(await db.blobs.get('f0')).toBeUndefined(); // pruned with its session
    expect((await db.sessions.latest())?.id).toBe(`s_${MAX_SESSIONS + 1}`);

    clock += SESSION_TTL_MS + 100;
    expect(await db.sessions.latest()).toBeUndefined(); // expired drafts are removed
    expect((await db.blobs.usage()).count).toBe(0);
    await expect(db.sessions.save({ ...session('bad id!', 1) })).rejects.toThrow(/expected shape/);
  });
});

describe('records cap', () => {
  it('refuses the record after the cap with a clear error, and import skips the rest', async () => {
    const db = fresh({ recordCap: 2 });
    await db.apps.save(fixtureApp(fixtureSpec()), create);
    await db.records.insert('app_expenses', 'expenses', { title: 'Tea', amount: 1 });
    await db.records.insert('app_expenses', 'expenses', { title: 'Bus', amount: 2 });
    const error = await db.records.insert('app_expenses', 'expenses', { title: 'Rice', amount: 3 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RecordLimitError);
    expect(isRecordLimitError(error)).toBe(true);
    expect((error as Error).message).toBe('This list is full. It can hold 2 entries. Delete or export some entries, then add new ones.');

    const other = fresh({ recordCap: 2 });
    const summary = await other.importAll({
      format: 'kalam-backup', formatVersion: 1, exportedAt: 1, apps: [fixtureApp(fixtureSpec())], state: [],
      records: [1, 2, 3].map((i) => ({ id: `r${i}`, appId: 'app_expenses', collectionId: 'expenses', values: { title: `T${i}`, amount: i } })),
    });
    expect(summary.records).toBe(2);
    expect(summary.skippedRecords).toBe(1);
  });
});

describe('app flags and version origin', () => {
  it('keeps archived across a metadata-only save without adding a version', async () => {
    const db = fresh();
    const app = await db.apps.save(fixtureApp(fixtureSpec()), create);
    const archived = await db.apps.save({ ...app, archived: true }, { summary: 'Archived', source: 'edit' });
    expect(archived.archived).toBe(true);
    expect((await db.apps.get('app_expenses'))?.archived).toBe(true);
    expect(await db.versions.list('app_expenses')).toHaveLength(1);
    await db.apps.save({ ...archived, archived: false }, { summary: 'Restored to the shelf', source: 'edit' });
    expect((await db.apps.get('app_expenses'))?.archived).toBe(false);
  });

  it('records who made a change on the version it creates', async () => {
    const db = fresh();
    const app = await db.apps.save(fixtureApp(fixtureSpec()), create);
    await db.apps.save({ ...app, spec: { ...app.spec, name: 'Expenses by AI' } }, { summary: 'Renamed', source: 'edit', origin: 'ai' });
    const versions = await db.versions.list('app_expenses');
    const edit = versions.find((v) => v.version === 2);
    expect(edit?.origin).toBe('ai');
    expect(versions.find((v) => v.version === 1)?.origin).toBeUndefined();
  });
});

describe('import, remix and settings', () => {
  it('resets claimed AI verification and provenance on import (R-09)', async () => {
    const db = fresh();
    await db.importAll({ format: 'kalam-backup', formatVersion: 1, exportedAt: 1, apps: [fixtureApp(fixtureSpec())], records: [], state: [] });
    const spec = (await db.apps.get('app_expenses'))?.spec;
    expect(spec?.aiBlocks.sort_it.verified).toBe('unverified');
    expect(spec?.aiBlocks.sort_it.verification).toBeUndefined();
    expect(spec?.meta.generator).toEqual({ route: 'deterministic', provider: 'import' });
  });

  it('remix copies do not carry the original creation prompt', async () => {
    const db = fresh();
    await db.apps.save(fixtureApp(fixtureSpec()), create);
    const copy = await db.duplicate('app_expenses');
    expect(copy.creationInput).toBeUndefined();
    expect((await db.apps.get('app_expenses'))?.creationInput?.text).toBe('my private shop notes');
  });

  it('keeps optional settings such as speech preferences', async () => {
    const db = fresh();
    await db.settings.update({ speech: { ...DEFAULT_SPEECH, rate: 1.5 }, newAppLanguage: 'hi' });
    const s = await db.settings.get();
    expect(s.speech?.rate).toBe(1.5);
    expect(s.newAppLanguage).toBe('hi');
  });
});

describe('storage manager', () => {
  it('reports usage per app, files, drafts, cache and unused files, and clears them safely', async () => {
    const db = fresh();
    let app = await db.apps.save(fixtureApp(fixtureSpec()), create);
    for (let v = 2; v <= 4; v++) app = await db.apps.save({ ...app, spec: { ...app.spec, name: `Expenses ${v}` } }, { summary: `v${v}`, source: 'edit' });
    await db.records.insert('app_expenses', 'expenses', { title: 'Tea', amount: 2 });
    await db.blobs.put({ id: 'p1', kind: 'image', mimeType: 'image/png', base64: PNG_BASE64, ownerId: 'app_expenses' });
    await db.blobs.put({ id: 'p2', kind: 'image', mimeType: 'image/png', base64: PNG_BASE64, ownerId: 'gone_app' });
    await db.sessions.save(session('s_1', Date.now()));
    await db.blobs.put({ id: 'p3', kind: 'video_frame', mimeType: 'image/png', base64: PNG_BASE64, ownerId: 's_1' });
    await db.aiCache.set('k', { a: 1 }, { taskType: 'classify', source: 'on_device' });

    const usage = await db.usage();
    expect(usage.apps).toHaveLength(1);
    expect(usage.apps[0]).toMatchObject({ appId: 'app_expenses', name: 'Expenses 4', versions: 3, records: 1, fileBytes: 68 });
    expect(usage.apps[0].collections).toEqual([{ id: 'expenses', label: 'Expenses', records: 1 }]);
    expect(usage.files).toEqual({ count: 3, bytes: 204 });
    expect(usage.drafts).toEqual({ sessions: 1, fileBytes: 68 });
    expect(usage.aiCache.entries).toBe(1);
    expect(usage.unusedFiles).toEqual({ count: 1, bytes: 68, owners: ['gone_app'] });

    expect(await db.removeUnusedFiles()).toBe(1);
    expect(await db.blobs.get('p2')).toBeUndefined();
    expect(await db.blobs.get('p3')).toBeDefined();

    expect(await db.clearHistory('app_expenses')).toBe(3);
    const versions = await db.versions.list('app_expenses');
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ version: 4, kind: 'snapshot' });
    expect((await db.versions.materialize('app_expenses', 4))?.name).toBe('Expenses 4');
    expect(await db.records.list('app_expenses', 'expenses')).toHaveLength(1);
    expect(await db.clearHistory('app_expenses')).toBe(0);
  });
});
