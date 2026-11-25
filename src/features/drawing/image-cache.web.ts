/** Web decoder for placed images: HTMLImageElement from the stored base64 (docs/08 §6.7). */
import { createImageCache, type BlobPayload } from './image-cache-core';

function decode({ base64, mimeType }: BlobPayload): Promise<HTMLImageElement | undefined> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(undefined);
    img.src = `data:${mimeType};base64,${base64}`;
  });
}

export const images = createImageCache<HTMLImageElement>(decode);
