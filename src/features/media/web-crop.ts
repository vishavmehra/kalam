/**
 * Cuts the chosen part out of a picture (docs/06 §7.3). The browser has no crop screen of its own, so the
 * cropper sheet picks the box and this makes the picture: a new JPEG that then goes through the same checks
 * and the same preparation as any picked file. The original file is not touched.
 *
 * The result carries a File as well as the address the image library gave it. The production content security
 * policy does not let the page fetch a data: address (connect-src), and the checks read a File directly.
 */
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { base64ToBytes } from '@/core/backup/base64';
import { cropPixels, type CropRect } from '@/core/media/crop';
import type { MediaSource } from '@/infrastructure/media/source';

const withJpgName = (name: string | undefined) => `${(name ?? 'photo').replace(/\.[A-Za-z0-9]{1,5}$/, '')}-cropped.jpg`;

export async function cropSource(src: MediaSource, rect: CropRect): Promise<MediaSource> {
  const whole = await ImageManipulator.manipulate(src.uri).renderAsync();
  const cut = await ImageManipulator.manipulate(whole).crop(cropPixels(rect, whole.width, whole.height)).renderAsync();
  const saved = await cut.saveAsync({ format: SaveFormat.JPEG, compress: 0.95, base64: true });
  if (!saved.base64) throw new Error('The cropped picture could not be encoded.');
  const bytes = base64ToBytes(saved.base64);
  const name = withJpgName(src.name);
  const file = new File([bytes as BlobPart], name, { type: 'image/jpeg' });
  return { uri: saved.uri, file, name, sizeBytes: file.size, mimeType: 'image/jpeg', width: saved.width, height: saved.height };
}
