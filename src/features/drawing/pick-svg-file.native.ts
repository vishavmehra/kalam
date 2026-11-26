import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { SVG_IMPORT_LIMITS } from './model';

const TOO_LARGE = 'That file is too large to open. The limit is about 1 MB.';

/** Android: lets the person choose an .svg file and returns its text, or undefined if they cancel. */
export async function pickSvgFile(): Promise<string | undefined> {
  const res = await DocumentPicker.getDocumentAsync({ type: 'image/svg+xml', copyToCacheDirectory: true });
  if (res.canceled || !res.assets?.[0]) return undefined;
  const asset = res.assets[0];
  const file = new File(asset.uri);
  try {
    if ((asset.size ?? file.size ?? 0) > SVG_IMPORT_LIMITS.maxChars) throw new Error(TOO_LARGE);
    return await file.text();
  } finally {
    // The picker copied the file into our cache; do not leave a second copy behind.
    try { if (file.exists) file.delete(); } catch { /* the system clears the cache too */ }
  }
}
