/**
 * Emergency copy of a drawing for the moment a browser tab closes (docs/08 §13.5). IndexedDB writes
 * are asynchronous and can be cut off when a page is hidden, so on `pagehide` the studio also stores
 * a copy in localStorage, which is synchronous. On the next open the newer copy wins and is saved
 * properly. Android has no localStorage; its writes finish when the app goes to the background.
 */
import type { DrawingDocument } from '@/core/contracts';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const key = (id: string) => `kalam.drawing.recovery.${id}`;
/** Skip huge drawings: localStorage is small and a failed write must not throw during unload. */
const MAX_CHARS = 2_500_000;

/** localStorage when the platform has it (web), otherwise undefined. */
export function defaultStorage(): StorageLike | undefined {
  try {
    const s = (globalThis as { localStorage?: StorageLike }).localStorage;
    return s ?? undefined;
  } catch {
    return undefined;
  }
}

export function writeRecovery(storage: StorageLike | undefined, doc: DrawingDocument, now = Date.now()): boolean {
  if (!storage) return false;
  try {
    const text = JSON.stringify({ ...doc, updatedAt: now });
    if (text.length > MAX_CHARS) return false;
    storage.setItem(key(doc.id), text);
    return true;
  } catch {
    return false;
  }
}

/** Raw (untrusted) recovery copy, or undefined. Callers must validate it with `migrateDrawing`. */
export function readRecovery(storage: StorageLike | undefined, id: string): unknown {
  if (!storage) return undefined;
  try {
    const text = storage.getItem(key(id));
    return text ? (JSON.parse(text) as unknown) : undefined;
  } catch {
    return undefined;
  }
}

export function clearRecovery(storage: StorageLike | undefined, id: string): void {
  try { storage?.removeItem(key(id)); } catch { /* storage can be blocked; nothing to clean */ }
}
