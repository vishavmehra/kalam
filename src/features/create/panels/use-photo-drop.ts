/**
 * Web conveniences for the photo panel (docs/03 §8.1): drop image files on the panel, paste an
 * image from the clipboard, and hide the camera button when this computer has no camera.
 * On Android these are no-ops: the picker and camera buttons cover it.
 */
import { type RefObject, useEffect, useState } from 'react';
import { Platform } from 'react-native';

/** Largest image file accepted before re-encoding (the copy that may be sent is ≤1280px anyway). */
const MAX_FILE_BYTES = 20 * 1024 * 1024;

function imageFiles(list: FileList | DataTransferItemList | null | undefined): File[] {
  if (!list) return [];
  const out: File[] = [];
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    const file = item instanceof File ? item : (item as DataTransferItem).kind === 'file' ? (item as DataTransferItem).getAsFile() : null;
    if (file && file.type.startsWith('image/')) out.push(file);
  }
  return out;
}

/**
 * Calls `onFiles` with image files dropped on `target` or pasted anywhere while it is mounted.
 * Returns whether a drag is over the target, for a visual cue. Files over 20 MB are skipped.
 */
export function usePhotoDrop(target: RefObject<unknown>, onFiles: (files: File[], skipped: number) => void, enabled = true): boolean {
  const [over, setOver] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'web' || !enabled) return undefined;
    const el = target.current as HTMLElement | null;
    if (!el || typeof el.addEventListener !== 'function') return undefined;
    const take = (files: File[]) => {
      const ok = files.filter((f) => f.size <= MAX_FILE_BYTES);
      if (files.length) onFiles(ok, files.length - ok.length);
    };
    const onDragOver = (e: DragEvent) => {
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes('Files')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setOver(true);
    };
    const onLeave = (e: DragEvent) => { if (!el.contains(e.relatedTarget as Node | null)) setOver(false); };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      setOver(false);
      take(imageFiles(e.dataTransfer?.files));
    };
    const onPaste = (e: ClipboardEvent) => {
      const files = imageFiles(e.clipboardData?.items);
      if (!files.length) return;
      e.preventDefault();
      take(files);
    };
    el.addEventListener('dragover', onDragOver);
    el.addEventListener('dragleave', onLeave);
    el.addEventListener('drop', onDrop);
    window.addEventListener('paste', onPaste);
    return () => {
      el.removeEventListener('dragover', onDragOver);
      el.removeEventListener('dragleave', onLeave);
      el.removeEventListener('drop', onDrop);
      window.removeEventListener('paste', onPaste);
    };
  }, [target, onFiles, enabled]);
  return over;
}

/** False on web when the browser reports no camera at all; true otherwise (Android, or unknown). */
export function useHasCamera(): boolean {
  const [has, setHas] = useState(true);
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return;
    let alive = true;
    navigator.mediaDevices.enumerateDevices()
      .then((devices) => { if (alive) setHas(devices.some((d) => d.kind === 'videoinput')); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);
  return has;
}
