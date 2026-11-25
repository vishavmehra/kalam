/**
 * Android file and storage helpers for the Storage and Backup panels (web: platform.web.ts).
 * Exports are written to a private cache folder only long enough for the share sheet to hand them
 * over, then deleted (docs/11 §7.6): never left behind as plaintext copies.
 */
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

export interface PickedFile { name: string; bytes: Uint8Array }
export interface DeviceStorage {
  /** Bytes this app's data uses, when the platform reports it. */
  usage?: number;
  quota?: number;
  /** Free space on the device (Android). */
  free?: number;
  /** True when the platform will not clear this data on its own. */
  persisted: boolean;
  /** Whether `requestPersistence` can change `persisted`. */
  canRequestPersistence: boolean;
}

const exportDir = () => new Directory(Paths.cache, 'kalam-exports');
/** The share target reads the file after the sheet closes on some apps, so deletion waits a little. */
const DELETE_AFTER_MS = 2 * 60 * 1000;

/** Deletes every earlier export copy. Called before each export and when the panels open. */
export function cleanupTemporaryExports(): void {
  try {
    const dir = exportDir();
    if (!dir.exists) return;
    for (const entry of dir.list()) entry.delete();
  } catch {
    // Best effort: the OS also clears the cache folder when space runs low.
  }
}

/** Opens the share sheet with `data` as a file. Resolves false when sharing is not available. */
export async function saveFile(name: string, data: Uint8Array | string, mimeType: string): Promise<boolean> {
  cleanupTemporaryExports();
  const dir = exportDir();
  if (!dir.exists) dir.create();
  const file = new File(dir, name);
  file.create();
  try {
    await file.write(data);
    if (!(await Sharing.isAvailableAsync())) return false;
    await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: name });
    return true;
  } finally {
    setTimeout(() => {
      try {
        if (file.exists) file.delete();
      } catch {
        // Swept on the next export or panel visit.
      }
    }, DELETE_AFTER_MS);
  }
}

/** Lets the person choose a file. Undefined when cancelled. The cached copy is deleted after reading. */
export async function pickFile(maxBytes: number): Promise<PickedFile | undefined> {
  const res = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
  const asset = res.canceled ? undefined : res.assets?.[0];
  if (!asset) return undefined;
  const file = new File(asset.uri);
  try {
    if ((asset.size ?? file.size ?? 0) > maxBytes) throw new Error('That file is too large to be a Kalam backup.');
    return { name: asset.name, bytes: await file.bytes() };
  } finally {
    try {
      if (file.exists) file.delete();
    } catch {
      // The picker copy lives in the cache folder, which the OS clears.
    }
  }
}

export async function deviceStorage(): Promise<DeviceStorage> {
  let free: number | undefined;
  try {
    free = Paths.availableDiskSpace;
  } catch {
    free = undefined;
  }
  // App-private storage on Android is kept until the app is uninstalled or its data is cleared.
  return { free, persisted: true, canRequestPersistence: false };
}

export async function requestPersistence(): Promise<boolean> {
  return true;
}
