import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { SVG_MAX_INPUT } from '@/core/bazaar';

/** Android: lets the person choose an .svg file and returns its text (sanitised later by the caller). */
export async function pickSvgText(): Promise<string | undefined> {
  const res = await DocumentPicker.getDocumentAsync({ type: 'image/svg+xml', copyToCacheDirectory: true });
  if (res.canceled || !res.assets?.[0]) return undefined;
  const asset = res.assets[0];
  const file = new File(asset.uri);
  try {
    if ((asset.size ?? file.size ?? 0) > SVG_MAX_INPUT) throw new Error('The icon file is too large.');
    return await file.text();
  } finally {
    try { if (file.exists) file.delete(); } catch { /* best effort: the OS clears the cache too */ }
  }
}
