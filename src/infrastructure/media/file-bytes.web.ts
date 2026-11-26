/**
 * Web: read a local file's first bytes, size and contents. Only browser Files and blob:/data: URLs
 * are read; network URLs are refused (docs/06 §16.2: no arbitrary URL fetching).
 */
import { bytesToBase64 } from '@/core/backup/base64';
import { MediaError } from '@/core/media/errors';
import type { MediaSource } from './source';

async function toBlob(src: MediaSource): Promise<Blob> {
  if (src.file) return src.file;
  if (!/^(blob:|data:)/i.test(src.uri)) throw new MediaError('FILE_UNSUPPORTED');
  const res = await fetch(src.uri);
  return res.blob();
}

export async function readHead(src: MediaSource, length: number): Promise<Uint8Array> {
  const blob = await toBlob(src);
  return new Uint8Array(await blob.slice(0, length).arrayBuffer());
}

export async function sizeOf(src: MediaSource): Promise<number> {
  return src.file?.size ?? src.sizeBytes ?? (await toBlob(src)).size;
}

export async function readBase64(src: MediaSource): Promise<string> {
  return bytesToBase64(new Uint8Array(await (await toBlob(src)).arrayBuffer()));
}

/** Web object URLs die with the page, so they are not worth keeping across a reload. */
export const isDurableUri = (_uri: string) => false;

export function fileExists(_uri: string): boolean {
  return false;
}
