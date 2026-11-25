/** Android decoder for placed images: SkImage from the stored base64 (docs/08 §6.7). */
import { Skia, type SkImage } from '@shopify/react-native-skia';
import { createImageCache, type BlobPayload } from './image-cache-core';

function decode({ base64 }: BlobPayload): SkImage | undefined {
  return Skia.Image.MakeImageFromEncoded(Skia.Data.fromBase64(base64)) ?? undefined;
}

export const images = createImageCache<SkImage>(decode);
