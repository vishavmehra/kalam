/**
 * Pictures into the session (docs/06 §7): picked, captured, dropped or pasted files are sniffed and
 * size-checked, duplicates are refused, then the ≤1280 px compiler copy joins the creation draft while
 * the original and a thumbnail stay in the local blob store (lead decision 3: never uploaded).
 * Each picture has its own status; one bad file never affects the others.
 */
import { useCallback, useRef, useState } from 'react';
import { attachmentCopy } from '@/core/media/copy';
import { isMediaError, MediaError, toMediaError } from '@/core/media/errors';
import { findDuplicate } from '@/core/media/hash';
import { displayDimensions } from '@/core/media/sniff';
import type { MediaAttachment } from '@/core/media/types';
import { timings } from '@/core/observability';
import { attachmentName } from '@/core/session/handoff';
import { addAttachment, newMediaId, removeAttachment, replaceAttachment, updateAttachment } from '@/core/session/session';
import { MAX_PHOTOS } from '@/features/input/normalize';
import { isDurableUri, readBase64 } from '@/infrastructure/media/file-bytes';
import { CancelledError, isCancelled, prepareImage, rotatedImage } from '@/infrastructure/media/images';
import { inspectMedia } from '@/infrastructure/media/inspect';
import { pickImages } from '@/infrastructure/media/pick';
import type { MediaSource } from '@/infrastructure/media/source';
import { getDatabase } from '@/infrastructure/storage/database';
import { keepOriginal, keepThumbnail, loadAsset } from '@/infrastructure/storage/media-sessions';
import { useCreationStore } from '@/state/creation-store';
import { dropAssets, endJob, ensureSession, isAttached, startJob, updateSession, useMediaStore } from './media-store';

const now = () => Date.now();
const find = (id: string) => useMediaStore.getState().session?.attachments.find((a) => a.id === id);

/**
 * One picture through validation, preparation and local keeping. Returns a message for the person, if any.
 * A replacement stays off the list until it is ready, so a bad, duplicate or cancelled file never
 * costs the old picture (docs/06 §3.5, §14.1). Removing the row while it works stops the work, and
 * nothing it made reaches the draft or the blob store afterwards.
 */
async function ingest(src: MediaSource, batch: AbortSignal, replaceId?: string): Promise<string | undefined> {
  const session = ensureSession();
  const id = newMediaId('att');
  const old = replaceId ? find(replaceId) : undefined;
  const signal = startJob(id, batch);
  const row: MediaAttachment = {
    id, type: 'image', mimeType: 'application/octet-stream', sizeBytes: src.sizeBytes ?? 0, status: 'validating', createdAt: now(), updatedAt: now(),
  };
  if (!old) updateSession((s) => addAttachment(s, row, now()).session);
  const stored: string[] = [];
  const alive = () => {
    if (signal.aborted || !isAttached(old?.id ?? id)) throw new CancelledError();
  };
  try {
    const count = useMediaStore.getState().session!.attachments.filter((a) => a.type === 'image').length;
    const info = await inspectMedia(src, 'image', attachmentCopy.photoName(count));
    alive();
    const dup = findDuplicate(info.contentHash, useMediaStore.getState().session!.attachments, old?.id ?? id);
    if (dup) {
      if (!old) updateSession((s) => removeAttachment(s, id, now()).session);
      return attachmentCopy.duplicate(attachmentName(useMediaStore.getState().session!, dup));
    }
    // A dropped or pasted file has no size from a picker: read it from the header, turned the way it is shown.
    const shown = src.width && src.height ? { width: src.width, height: src.height } : displayDimensions(info.head);
    const details: Partial<MediaAttachment> = {
      mimeType: info.mimeType, sizeBytes: info.sizeBytes, contentHash: info.contentHash,
      ...(info.name ? { name: info.name } : {}), ...(shown ?? {}),
    };
    if (!old) updateSession((s) => updateAttachment(s, id, { ...details, status: 'processing_local' }, now()));
    const prepared = await prepareImage(src.uri, 'photo', { signal, ...(info.name ? { label: info.name } : {}) });
    alive();
    const others = useCreationStore.getState().photos.filter((p) => p.id !== old?.preparedImageId).length;
    if (others >= MAX_PHOTOS) throw new MediaError('COMPILER_INPUT_TOO_LARGE');

    const db = getDatabase();
    const base = { sessionId: session.id, attachmentId: id };
    const [originalAssetId, previewAssetId] = await Promise.all([
      readBase64(src).then((b64) => keepOriginal(db, { ...base, base64: b64, mimeType: info.mimeType })).catch(() => undefined),
      keepThumbnail(db, { ...base, base64: prepared.thumbnail.base64, mimeType: 'image/jpeg' }).catch(() => undefined),
    ]);
    for (const x of [originalAssetId, previewAssetId]) if (x) stored.push(x);
    alive();
    const ready: Partial<MediaAttachment> = {
      ...details, status: 'ready', preparedImageId: prepared.image.id,
      ...(originalAssetId ? { originalAssetId } : {}), ...(previewAssetId ? { previewAssetId } : {}),
      ...(isDurableUri(src.uri) ? { localUri: src.uri } : {}),
    };
    // Commit: the draft and the session change together, with no await in between.
    const draft = useCreationStore.getState();
    if (old) {
      let dropped: string[] = [];
      updateSession((s) => {
        const r = replaceAttachment(s, old.id, { ...row, ...ready, updatedAt: now() }, now());
        dropped = r.removedAssetIds;
        return r.session;
      });
      if (old.preparedImageId) draft.removePhoto(old.preparedImageId);
      void dropAssets(dropped);
    } else {
      updateSession((s) => updateAttachment(s, id, ready, now()));
    }
    draft.addPhotos([prepared.image]);
    stored.length = 0;
    return originalAssetId ? undefined : attachmentCopy.originalTooLarge;
  } catch (e) {
    void dropAssets(stored);
    if (signal.aborted || isCancelled(e)) {
      if (!old) updateSession((s) => removeAttachment(s, id, now()).session);
      return undefined;
    }
    const err = isMediaError(e) ? e : toMediaError(e, 'IMAGE_DECODE_FAILED');
    // A failed replacement leaves the old picture as it was; the message says why.
    if (!old) updateSession((s) => updateAttachment(s, id, { status: 'failed', error: err.toJSON() }, now()));
    return err.message;
  } finally {
    endJob(id);
  }
}

/** Browser Files (drop, paste, file input) as sources. Call the returned `release` when done. */
export function filesToSources(files: readonly File[]): { sources: MediaSource[]; release(): void } {
  const sources = files.map((f) => ({ uri: URL.createObjectURL(f), file: f, name: f.name, sizeBytes: f.size, ...(f.type ? { mimeType: f.type } : {}) }));
  return { sources, release: () => sources.forEach((s) => URL.revokeObjectURL(s.uri)) };
}

export function useImageIntake() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const abort = useRef<AbortController | undefined>(undefined);

  const addSources = useCallback(async (sources: readonly MediaSource[], replaceId?: string) => {
    const room = MAX_PHOTOS - useCreationStore.getState().photos.length + (replaceId ? 1 : 0);
    const take = sources.slice(0, Math.max(0, room));
    const notes: string[] = [];
    if (sources.length > take.length) notes.push(attachmentCopy.photoLimit(MAX_PHOTOS));
    if (!take.length) return setMessage(notes.join(' ') || undefined);
    const ac = new AbortController();
    abort.current = ac;
    setBusy(true);
    setMessage(undefined);
    try {
      for (const [i, src] of take.entries()) {
        if (ac.signal.aborted) break;
        const note = await timings.time('attachment_intake', () => ingest(src, ac.signal, i === 0 ? replaceId : undefined));
        if (note) notes.push(note);
      }
    } finally {
      setBusy(false);
      if (abort.current === ac) abort.current = undefined;
      setMessage(notes.length ? notes.join(' ') : undefined);
    }
  }, []);

  /** Dropped or pasted browser Files. */
  const addFiles = useCallback(async (files: readonly File[]) => {
    const { sources, release } = filesToSources(files);
    try {
      await addSources(sources);
    } finally {
      release();
    }
  }, [addSources]);

  const pick = useCallback(async (from: 'camera' | 'library', opts: { crop?: boolean; replaceId?: string } = {}) => {
    setMessage(undefined);
    try {
      const room = opts.replaceId ? 1 : MAX_PHOTOS - useCreationStore.getState().photos.length;
      const picked = await pickImages(from, Math.max(1, room), opts.crop ? { crop: true } : {});
      if (picked.length) await addSources(picked, opts.replaceId);
    } catch (e) {
      setMessage(toMediaError(e, 'IMAGE_DECODE_FAILED').message);
    }
  }, [addSources]);

  /** One picture chosen but not added yet: the web cropper shows it first, then `addSources` takes the result. */
  const pickOne = useCallback(async (): Promise<MediaSource | undefined> => {
    setMessage(undefined);
    try {
      return (await pickImages('library', 1))[0];
    } catch (e) {
      setMessage(toMediaError(e, 'IMAGE_DECODE_FAILED').message);
      return undefined;
    }
  }, []);

  /** A quarter turn to the right, made again from the original so quality is not lost. */
  const rotate = useCallback(async (attachmentId: string) => {
    const att = find(attachmentId);
    if (!att?.preparedImageId) return;
    setBusy(true);
    try {
      const turn = (((att.rotation ?? 0) + 90) % 360) as 0 | 90 | 180 | 270;
      const original = att.originalAssetId ? await loadAsset(getDatabase(), att.originalAssetId) : undefined;
      const prepared = useCreationStore.getState().photos.find((p) => p.id === att.preparedImageId);
      const fromOriginal = att.localUri ?? (original ? `data:${original.mimeType};base64,${original.base64}` : undefined);
      const uri = fromOriginal ?? (prepared ? `data:${prepared.mimeType};base64,${prepared.base64}` : undefined);
      if (!uri) return;
      const next = await rotatedImage(uri, fromOriginal ? turn : 90, prepared?.label);
      // Removed while turning: nothing goes back into the draft.
      if (find(attachmentId)?.preparedImageId !== att.preparedImageId) return;
      const draft = useCreationStore.getState();
      draft.removePhoto(att.preparedImageId);
      draft.addPhotos([next.image]);
      updateSession((s) => updateAttachment(s, attachmentId, { preparedImageId: next.image.id, rotation: turn }, now()));
      const db = getDatabase();
      const previewAssetId = await keepThumbnail(db, { sessionId: ensureSession().id, attachmentId, base64: next.thumbnail.base64, mimeType: 'image/jpeg' }).catch(() => undefined);
      if (previewAssetId && !isAttached(attachmentId)) void dropAssets([previewAssetId]);
      else if (previewAssetId) updateSession((s) => updateAttachment(s, attachmentId, { previewAssetId }, now()));
    } catch (e) {
      setMessage(toMediaError(e, 'IMAGE_DECODE_FAILED').message);
    } finally {
      setBusy(false);
    }
  }, []);

  const cancel = useCallback(() => abort.current?.abort(), []);

  return { addSources, addFiles, pick, pickOne, rotate, cancel, busy, message, clearMessage: () => setMessage(undefined) };
}
