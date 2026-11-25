/**
 * Native (Android) JSON file I/O: save via the system share sheet, open via the document picker.
 * Web implementation: json-file.web.ts. Parsed content is untrusted — callers must validate it.
 */
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { MAX_IMPORT_BYTES, TOO_LARGE_MESSAGE } from './limits';

/**
 * Writes `data` as pretty JSON and opens the share sheet. Resolves false if sharing is unavailable.
 * The plaintext copy in the cache is deleted once the share sheet closes (docs/11 §7.6, R-06).
 */
export async function saveJsonFile(filename: string, data: unknown): Promise<boolean> {
  const file = new File(Paths.cache, filename);
  if (file.exists) file.delete();
  file.create();
  try {
    await file.write(JSON.stringify(data, null, 2));
    if (!(await Sharing.isAvailableAsync())) return false;
    await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: filename });
    return true;
  } finally {
    try { if (file.exists) file.delete(); } catch { /* best effort: the OS clears the cache too */ }
  }
}

/**
 * Lets the user pick a JSON file; returns the parsed value, or undefined if cancelled. Refuses
 * files over MAX_IMPORT_BYTES before reading them into memory. Throws on invalid JSON.
 */
export async function pickJsonFile(): Promise<unknown | undefined> {
  const res = await DocumentPicker.getDocumentAsync({ type: 'application/json', copyToCacheDirectory: true });
  if (res.canceled || !res.assets?.[0]) return undefined;
  const asset = res.assets[0];
  const file = new File(asset.uri);
  try {
    const size = asset.size ?? file.size ?? 0;
    if (size > MAX_IMPORT_BYTES) throw new Error(TOO_LARGE_MESSAGE);
    return JSON.parse(await file.text()) as unknown;
  } finally {
    // The picker copied the file into our cache; do not leave a second plaintext copy behind.
    try { if (file.exists) file.delete(); } catch { /* best effort */ }
  }
}

/** Filesystem-safe name from a user-provided app name. */
export function safeFilename(name: string, ext: string): string {
  const base = name.trim().replace(/[^\p{L}\p{N}\-_ ]+/gu, '').replace(/\s+/g, '-').slice(0, 60) || 'kalam';
  return `${base}.${ext}`;
}
