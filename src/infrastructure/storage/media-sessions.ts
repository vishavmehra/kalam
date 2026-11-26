/**
 * Media session persistence (docs/06 §3.4, §15; lead decision 3). The session lives in the creation
 * session row (`draft.media`); originals, thumbnails and kept recordings live in the local blob store,
 * owned by the session id so they go when the session goes. Nothing here uploads anything.
 */
import type { BlobRepository, CreationSession, StoredBlob } from '@/core/contracts';
import { base64ByteLength } from '@/core/backup/base64';
import { MEDIA_SESSION_VERSION, mediaSessionSchema, parseSession, storedState, type MediaSession } from '@/core/session';
import { MEDIA_DRAFT_KEY, type SessionRepository, type StoredSession } from './repositories';
import { MAX_BLOB_BYTES } from './storage-limits';

export interface MediaStorage {
  sessions: Pick<SessionRepository, 'saveMedia' | 'get' | 'latest' | 'remove'>;
  blobs: Pick<BlobRepository, 'put' | 'get' | 'remove'>;
}

export async function saveMediaSession(db: MediaStorage, s: MediaSession): Promise<void> {
  const parsed = mediaSessionSchema.parse(s);
  await db.sessions.saveMedia(parsed.id, parsed as unknown as Record<string, unknown>, storedState(parsed.status));
}

export const clearMediaSession = (db: MediaStorage, id: string) => db.sessions.saveMedia(id, null);

/**
 * "Start over" for the media part of session `id`: its files go, and the row goes too when the
 * media session was all it held (an audio file alone never writes the creation draft). A row the
 * creation draft still uses keeps its own data. Files already moved to a saved app (another owner)
 * stay with that app. Never creates a row.
 */
export async function discardMediaSession(db: MediaStorage, id: string, assetIds: readonly string[]): Promise<void> {
  for (const assetId of assetIds) if ((await db.blobs.get(assetId))?.ownerId === id) await db.blobs.remove(assetId);
  const row = (await db.sessions.get(id)) as (CreationSession & StoredSession) | undefined;
  if (!row) return;
  const others = Object.keys(row.draft ?? {}).filter((k) => k !== MEDIA_DRAFT_KEY);
  if (!row.text.trim() && !row.audioTranscript?.trim() && !row.drawingId && !others.length) await db.sessions.remove(id);
  else if (row.draft && MEDIA_DRAFT_KEY in row.draft) await clearMediaSession(db, id);
}

/** The media session of row `id` (or of the latest row), validated and recovered after a restart. */
export async function loadMediaSession(db: MediaStorage, id?: string): Promise<MediaSession | undefined> {
  const row = (id ? await db.sessions.get(id) : await db.sessions.latest()) as (CreationSession & StoredSession) | undefined;
  if (!row || row.state === 'saved') return undefined;
  const media = parseSession(row.draft?.[MEDIA_DRAFT_KEY]);
  return media && media.id === row.id && media.v === MEDIA_SESSION_VERSION ? media : undefined;
}

export type AssetVariant = 'orig' | 'thumb' | 'audio';
const KIND: Record<AssetVariant, StoredBlob['kind']> = { orig: 'image_original', thumb: 'image', audio: 'audio' };

export const assetId = (sessionId: string, attachmentId: string, variant: AssetVariant) => `${sessionId}.${attachmentId}.${variant}`;

export interface AssetInput {
  sessionId: string;
  attachmentId: string;
  base64: string;
  mimeType: string;
}

/** Stores one asset; undefined when it is over the per-file cap (the caller keeps going without it). */
async function put(db: MediaStorage, variant: AssetVariant, a: AssetInput): Promise<string | undefined> {
  if (base64ByteLength(a.base64) > MAX_BLOB_BYTES) return undefined;
  const id = assetId(a.sessionId, a.attachmentId, variant);
  await db.blobs.put({ id, kind: KIND[variant], mimeType: a.mimeType, base64: a.base64, ownerId: a.sessionId });
  return id;
}

/** The original picture, kept on this device only and never sent anywhere (lead decision 3). */
export const keepOriginal = (db: MediaStorage, a: AssetInput) => put(db, 'orig', a);

/** The display thumbnail. Disposable: it can always be made again from the original. */
export const keepThumbnail = (db: MediaStorage, a: AssetInput) => put(db, 'thumb', a);

/**
 * A raw recording is stored only when the person turned on "Keep recordings"
 * (settings.speech.keepRecordings, default off). Otherwise nothing is written.
 */
export function keepRecording(db: MediaStorage, a: AssetInput, keepRecordings: boolean): Promise<string | undefined> {
  return keepRecordings ? put(db, 'audio', a) : Promise.resolve(undefined);
}

export const loadAsset = (db: MediaStorage, id: string) => db.blobs.get(id);

export async function removeAssets(db: MediaStorage, ids: readonly string[]): Promise<void> {
  for (const id of ids) await db.blobs.remove(id);
}
