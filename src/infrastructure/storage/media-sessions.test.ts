import { describe, expect, it, vi } from 'vitest';
import type { CreationSession } from '@/core/contracts';
import { PNG_BASE64 } from '@/core/backup/test-fixtures';
import { addAttachment, applyEvent, createSession } from '@/core/session';
import { createWebDatabase } from './database.web';
import {
  assetId, clearMediaSession, discardMediaSession, keepOriginal, keepRecording, keepThumbnail, loadMediaSession, removeAssets, saveMediaSession,
} from './media-sessions';
import { MAX_BLOB_BYTES } from './storage-limits';

let n = 0;
const fresh = () => createWebDatabase(`media-test-${++n}-${Date.now()}`);
const row = (id: string, extra: Partial<CreationSession> & { draft?: Record<string, unknown> } = {}) => ({
  id, state: 'draft' as const, createdAt: Date.now(), updatedAt: Date.now(), text: 'shop app', attachmentIds: [], ...extra,
});
const attachment = { id: 'att_1', type: 'image' as const, mimeType: 'image/png', sizeBytes: 68, status: 'ready' as const, createdAt: 1, updatedAt: 1 };

describe('media session persistence', () => {
  it('survives a reload next to the creation draft, in either write order', async () => {
    const db = fresh();
    let s = addAttachment(createSession('s_a', Date.now()), attachment, Date.now()).session;
    await saveMediaSession(db, s);
    // The creation draft writes its own row later without knowing about the media session.
    await db.sessions.save(row('s_a', { draft: { images: [] } }));
    let back = await loadMediaSession(db);
    expect(back?.attachments.map((a) => a.id)).toEqual(['att_1']);
    expect((await db.sessions.get('s_a'))?.text).toBe('shop app');

    s = applyEvent(back!, 'compile_started', Date.now());
    await saveMediaSession(db, s);
    expect((await db.sessions.get('s_a'))?.text).toBe('shop app'); // media writes keep the draft
    back = await loadMediaSession(db, 's_a');
    expect(back?.status).toBe('interrupted'); // building was running when the app closed
  });

  it('clears the media session and ignores rows that are not media sessions', async () => {
    const db = fresh();
    await saveMediaSession(db, createSession('s_b', Date.now()));
    await clearMediaSession(db, 's_b');
    expect(await loadMediaSession(db, 's_b')).toBeUndefined();
    await db.sessions.save(row('s_c', { draft: { media: { v: 1, id: 'someone_else' } } }));
    expect(await loadMediaSession(db, 's_c')).toBeUndefined();
    await expect(db.sessions.saveMedia('s_d', [] as unknown as Record<string, unknown>)).rejects.toThrow();
    await expect(db.sessions.saveMedia('bad id!', {})).rejects.toThrow(/expected shape/);
  });

  it('a removed session takes its media files with it', async () => {
    const db = fresh();
    await saveMediaSession(db, createSession('s_e', Date.now()));
    const orig = await keepOriginal(db, { sessionId: 's_e', attachmentId: 'att_1', base64: PNG_BASE64, mimeType: 'image/png' });
    const thumb = await keepThumbnail(db, { sessionId: 's_e', attachmentId: 'att_1', base64: PNG_BASE64, mimeType: 'image/png' });
    expect(orig).toBe(assetId('s_e', 'att_1', 'orig'));
    expect((await db.blobs.get(orig!))?.kind).toBe('image_original');
    expect((await db.blobs.get(thumb!))?.kind).toBe('image');
    await db.sessions.remove('s_e');
    expect(await db.blobs.get(orig!)).toBeUndefined();
    expect(await db.blobs.get(thumb!)).toBeUndefined();
  });

  it('start over removes a media-only row and its files, but not the draft or a saved app', async () => {
    const db = fresh();
    // An audio file alone: the creation draft never wrote this row.
    await saveMediaSession(db, addAttachment(createSession('s_m', Date.now()), attachment, Date.now()).session);
    const kept = await keepRecording(db, { sessionId: 's_m', attachmentId: 'att_1', base64: PNG_BASE64, mimeType: 'audio/wav' }, true);
    await discardMediaSession(db, 's_m', [kept!]);
    expect(await db.sessions.get('s_m')).toBeUndefined();
    expect(await db.blobs.get(kept!)).toBeUndefined();

    // A row the creation draft also uses keeps its own data; a file moved to a saved app stays.
    await db.sessions.save(row('s_n', { draft: { images: [] } }));
    await saveMediaSession(db, createSession('s_n', Date.now()));
    const orig = await keepOriginal(db, { sessionId: 's_n', attachmentId: 'att_1', base64: PNG_BASE64, mimeType: 'image/png' });
    const blob = await db.blobs.get(orig!);
    await db.blobs.put({ id: blob!.id, kind: blob!.kind, mimeType: blob!.mimeType, base64: blob!.base64, ownerId: 'app_1' });
    await discardMediaSession(db, 's_n', [orig!]);
    expect((await db.sessions.get('s_n'))?.text).toBe('shop app');
    expect(await loadMediaSession(db, 's_n')).toBeUndefined();
    expect(await db.blobs.get(orig!)).toBeDefined();

    await discardMediaSession(db, 's_none', []);
    expect(await db.sessions.get('s_none')).toBeUndefined();
  });
});

describe('privacy', () => {
  it('never stores a raw recording unless keep recordings is on', async () => {
    const db = fresh();
    const audio = { sessionId: 's_f', attachmentId: 'att_a', base64: PNG_BASE64, mimeType: 'audio/wav' };
    expect(await keepRecording(db, audio, false)).toBeUndefined();
    expect(await db.blobs.get(assetId('s_f', 'att_a', 'audio'))).toBeUndefined();
    expect((await db.blobs.usage()).count).toBe(0);
    const kept = await keepRecording(db, audio, true);
    expect((await db.blobs.get(kept!))?.kind).toBe('audio');
    await removeAssets(db, [kept!]);
    expect((await db.blobs.usage()).count).toBe(0);
  });

  it('skips files over the local cap instead of failing the session', async () => {
    const db = fresh();
    const big = 'A'.repeat(Math.ceil(MAX_BLOB_BYTES / 3) * 4 + 8);
    expect(await keepOriginal(db, { sessionId: 's_g', attachmentId: 'att_b', base64: big, mimeType: 'image/jpeg' })).toBeUndefined();
  });

  // Covers the storage helpers only; the intake code's network use is limited by its imports (no fetch, no upload).
  it('the storage helpers make no network calls', async () => {
    const fetchSpy = vi.fn(async () => new Response(''));
    const original = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      const db = fresh();
      const s = addAttachment(createSession('s_h', Date.now()), attachment, Date.now()).session;
      await saveMediaSession(db, s);
      const base = { sessionId: 's_h', attachmentId: 'att_1', base64: PNG_BASE64, mimeType: 'image/png' };
      await keepOriginal(db, base);
      await keepThumbnail(db, base);
      await keepRecording(db, { ...base, mimeType: 'audio/wav' }, true);
      await loadMediaSession(db, 's_h');
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = original;
    }
  });
});
