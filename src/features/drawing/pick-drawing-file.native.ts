import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { DRAWING_FILE_MAX_CHARS } from './model';

/** Phones: lets the person choose a .kalamdraw file and returns its text, or undefined if they cancel. */
export async function pickDrawingFile(): Promise<string | undefined> {
  // A .kalamdraw has no registered type on a phone, so any file can be picked; its content decides if it opens.
  const res = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
  if (res.canceled || !res.assets?.[0]) return undefined;
  const asset = res.assets[0];
  const file = new File(asset.uri);
  try {
    if ((asset.size ?? file.size ?? 0) > DRAWING_FILE_MAX_CHARS) throw new RangeError('too_large');
    return await file.text();
  } finally {
    // The picker copied the file into our cache; do not leave a second copy behind.
    try { if (file.exists) file.delete(); } catch { /* the system clears the cache too */ }
  }
}
