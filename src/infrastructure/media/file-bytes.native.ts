/** Android and iOS: read a local file's first bytes, size and contents with expo-file-system. */
import { File as FsFile } from 'expo-file-system';
import { MediaError } from '@/core/media/errors';
import type { MediaSource } from './source';

function local(src: MediaSource | string): FsFile {
  const uri = typeof src === 'string' ? src : src.uri;
  if (!/^(file:|content:)/i.test(uri)) throw new MediaError('FILE_UNSUPPORTED');
  return new FsFile(uri);
}

export async function readHead(src: MediaSource, length: number): Promise<Uint8Array> {
  const handle = local(src).open();
  try {
    return await handle.readBytes(length);
  } finally {
    handle.close();
  }
}

export async function sizeOf(src: MediaSource): Promise<number> {
  return src.sizeBytes ?? local(src).size;
}

export function readBase64(src: MediaSource): Promise<string> {
  return local(src).base64();
}

/** Picker files in the app cache usually survive a restart; the OS may still clear them. */
export const isDurableUri = (uri: string) => /^file:/i.test(uri);

export function fileExists(uri: string): boolean {
  try {
    return local(uri).exists;
  } catch {
    return false;
  }
}
