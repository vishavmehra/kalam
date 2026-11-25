/** Web file and storage helpers: Blob downloads, a hidden file input, and the StorageManager API. */
import type { DeviceStorage, PickedFile } from './platform';

export type { DeviceStorage, PickedFile } from './platform';

/** Nothing is written to disk by Kalam on the web; the browser owns the download. */
export function cleanupTemporaryExports(): void {}

export async function saveFile(name: string, data: Uint8Array | string, mimeType: string): Promise<boolean> {
  const part: BlobPart = typeof data === 'string' ? data : new Uint8Array(data);
  const url = URL.createObjectURL(new Blob([part], { type: mimeType }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

export function pickFile(maxBytes: number): Promise<PickedFile | undefined> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.kalambackup,application/json,application/octet-stream';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(undefined);
      if (file.size > maxBytes) return reject(new Error('That file is too large to be a Kalam backup.'));
      file.arrayBuffer().then((buf) => resolve({ name: file.name, bytes: new Uint8Array(buf) }), reject);
    };
    // Some browsers fire `cancel`; others never resolve. Callers must not block on it.
    input.addEventListener('cancel', () => resolve(undefined));
    input.click();
  });
}

export async function deviceStorage(): Promise<DeviceStorage> {
  const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
  if (!storage?.estimate) return { persisted: false, canRequestPersistence: false };
  const [estimate, persisted] = await Promise.all([
    storage.estimate().catch(() => undefined),
    storage.persisted?.().catch(() => false) ?? Promise.resolve(false),
  ]);
  return {
    ...(estimate?.usage !== undefined ? { usage: estimate.usage } : {}),
    ...(estimate?.quota !== undefined ? { quota: estimate.quota } : {}),
    persisted: !!persisted,
    canRequestPersistence: typeof storage.persist === 'function' && !persisted,
  };
}

/** Asks the browser not to clear Kalam's data when space runs low (docs/11 §5.5). */
export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
