/**
 * Save a copy of the drawing as a Kalam drawing file, and open one (docs/08 §14.1, §14.5). Opening always makes a new
 * drawing, so the one on screen is saved first and never touched. Everything happens on this device.
 */
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import type { StoreApi } from 'zustand/vanilla';

import { useToast } from '@/design';
import { t as gt } from '@/i18n/active';
import { getServices } from '@/services';

import { saveExportFiles } from './export';
import {
  asNewDrawing, buildDrawingFile, drawingFileName, DRAWING_FILE_MIME, newId, parseDrawingFile, placedImageIds, type DrawingFileAsset, type DrawingFileNotice,
} from './model';
import { pickDrawingFile } from './pick-drawing-file';
import type { StudioState } from './studio-store';
import { flushStudio, serializeDrawing } from './use-studio';

/** One sentence about what was left out or changed when a file opened. */
export function noticeText(n: DrawingFileNotice): string {
  if (n.code === 'dropped') return gt('studio.kalamFile.dropped', { count: n.count });
  if (n.code === 'photosMissing') return gt('studio.kalamFile.photosMissing', { count: n.count });
  return gt('studio.kalamFile.newer');
}

export function useKalamDrawingFile(store: StoreApi<StudioState>): { save: () => Promise<void>; open: () => Promise<void>; busy: boolean } {
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const save = useCallback(async () => {
    setBusy(true);
    try {
      store.getState().commitTextEdit();
      const s = store.getState();
      const doc = serializeDrawing(s.history.present, s.pageId);
      const blobs = getServices().db.blobs;
      const assets: DrawingFileAsset[] = [];
      for (const id of placedImageIds(doc)) {
        const b = await blobs?.get(id).catch(() => undefined);
        if (b && (b.mimeType === 'image/png' || b.mimeType === 'image/jpeg' || b.mimeType === 'image/webp')) assets.push({ id, mimeType: b.mimeType, base64: b.base64 });
      }
      const name = drawingFileName(doc.title);
      const bytes = new TextEncoder().encode(buildDrawingFile(doc, assets));
      await saveExportFiles([{ name, bytes, mimeType: DRAWING_FILE_MIME }], name);
      toast.show({ message: gt('studio.kalamFile.saved', { name }), tone: 'success' });
    } catch {
      toast.show({ message: gt('studio.kalamFile.saveFailed'), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }, [store, toast]);

  const open = useCallback(async () => {
    setBusy(true);
    try {
      let text: string | undefined;
      try {
        text = await pickDrawingFile();
      } catch (e) {
        toast.show({ message: gt(e instanceof RangeError ? 'studio.kalamFile.tooLarge' : 'studio.kalamFile.openFailed'), tone: 'danger' });
        return;
      }
      if (text === undefined) return; // cancelled
      const parsed = parseDrawingFile(text);
      if (parsed.status === 'failed') {
        toast.show({ message: gt(`studio.kalamFile.problem.${parsed.problem}` as const), tone: 'danger' });
        return;
      }
      const made = asNewDrawing(parsed, newId);
      const blobs = getServices().db.blobs;
      for (const a of made.assets) await blobs?.put({ id: a.id, kind: 'image', mimeType: a.mimeType, base64: a.base64, ownerId: made.doc.id });
      await getServices().db.drawings.save(made.doc);
      // The drawing on screen is kept as it is; the opened one is its own drawing.
      await flushStudio(store);
      toast.show({ message: [gt('studio.kalamFile.opened', { title: made.doc.title }), ...parsed.notices.map(noticeText)].join(' '), tone: 'success' });
      router.replace({ pathname: '/create/draw', params: { id: made.doc.id } } as never);
    } catch {
      toast.show({ message: gt('studio.kalamFile.openFailed'), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }, [store, toast, router]);

  return { save, open, busy };
}
