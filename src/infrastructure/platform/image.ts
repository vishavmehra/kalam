/**
 * Photo / sketch / video picking and image normalisation (docs/06 §2.2). expo-image-picker and
 * expo-image-manipulator support both web and Android, so this module is shared.
 *
 * Every image is re-encoded as JPEG (q0.8, longest side ≤ 1280px). Re-encoding drops EXIF,
 * including GPS location, before anything can leave the device (docs/11).
 */
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import type { NormalizedImage } from '@/core/contracts';
import { fitWithin, JPEG_QUALITY, MAX_IMAGE_SIDE, MAX_VIDEO_SECONDS } from '@/features/input/media-math';

export class MediaPermissionError extends Error {
  constructor(public readonly what: 'camera' | 'library') {
    super(what === 'camera'
      ? 'Camera access is off. Allow it in system settings, or choose an existing photo instead.'
      : 'Photo library access is off. Allow it in system settings to choose a file.');
  }
}

const mediaId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** Resize to ≤1280px and re-encode as JPEG with base64 payload. */
export async function normalizeImageUri(
  uri: string, source: NormalizedImage['source'], label?: string, maxSide = MAX_IMAGE_SIDE,
): Promise<NormalizedImage> {
  const loaded = await ImageManipulator.manipulate(uri).renderAsync();
  const size = fitWithin(loaded.width, loaded.height, maxSide);
  const ref = size.scaled
    ? await ImageManipulator.manipulate(loaded).resize({ width: size.width, height: size.height }).renderAsync()
    : loaded;
  const saved = await ref.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY, base64: true });
  if (!saved.base64) throw new Error('The image could not be encoded.');
  return {
    id: mediaId('img'),
    mimeType: 'image/jpeg',
    base64: saved.base64,
    width: saved.width,
    height: saved.height,
    source,
    ...(label ? { label } : {}),
  };
}

async function ensurePermission(from: 'camera' | 'library'): Promise<void> {
  if (from === 'camera') {
    const res = await ImagePicker.requestCameraPermissionsAsync();
    if (!res.granted) throw new MediaPermissionError('camera');
  }
  // Library selection uses the system picker (Android photo picker / web file input): no permission.
}

/** Pick or capture up to `max` images. Returns [] when the user cancels. */
export async function pickImages(from: 'camera' | 'library', max: number): Promise<NormalizedImage[]> {
  await ensurePermission(from);
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    quality: 1,
    exif: false,
    allowsMultipleSelection: from === 'library' && max > 1,
    selectionLimit: max,
  };
  const res = from === 'camera'
    ? await ImagePicker.launchCameraAsync(options)
    : await ImagePicker.launchImageLibraryAsync(options);
  if (res.canceled) return [];
  const out: NormalizedImage[] = [];
  for (const asset of res.assets.slice(0, max)) {
    // File names are not forwarded: they can carry personal details and add nothing for the compiler.
    out.push(await normalizeImageUri(asset.uri, 'photo'));
  }
  return out;
}

export interface PickedVideo { uri: string; name?: string; durationSec: number }

/** Pick or record a video (≤60s). Duration may be 0 when the platform does not report it. */
export async function pickVideo(from: 'camera' | 'library'): Promise<PickedVideo | undefined> {
  await ensurePermission(from);
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['videos'],
    videoMaxDuration: MAX_VIDEO_SECONDS,
    allowsMultipleSelection: false,
  };
  const res = from === 'camera'
    ? await ImagePicker.launchCameraAsync(options)
    : await ImagePicker.launchImageLibraryAsync(options);
  if (res.canceled || !res.assets[0]) return undefined;
  const a = res.assets[0];
  return { uri: a.uri, ...(a.fileName ? { name: a.fileName } : {}), durationSec: a.duration ? a.duration / 1000 : 0 };
}
