/**
 * Pickers for the three media types (docs/06 §2.2-2.4). expo-image-picker and expo-document-picker
 * work on web, Android and iOS, so this module is shared. Nothing is read or sent here.
 */
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';
import { MediaError } from '@/core/media/errors';
import { DEFAULT_MEDIA_LIMITS } from '@/core/media/limits';
import type { MediaSource } from './source';

async function cameraAllowed(): Promise<void> {
  const res = await ImagePicker.requestCameraPermissionsAsync();
  if (!res.granted) throw new MediaError('PERMISSION_DENIED');
}

const fromAsset = (a: ImagePicker.ImagePickerAsset): MediaSource => ({
  uri: a.uri,
  ...(a.file ? { file: a.file } : {}),
  ...(a.fileName ? { name: a.fileName } : {}),
  ...(a.fileSize ? { sizeBytes: a.fileSize } : {}),
  ...(a.mimeType ? { mimeType: a.mimeType } : {}),
  ...(a.width ? { width: a.width } : {}),
  ...(a.height ? { height: a.height } : {}),
  ...(a.duration ? { durationSec: a.duration / 1000 } : {}),
});

/**
 * Up to `max` pictures. `crop` opens the system crop screen on Android and iOS for a single picture
 * (browsers have no built-in cropper, so it is ignored on web).
 */
export async function pickImages(from: 'camera' | 'library', max: number, opts: { crop?: boolean } = {}): Promise<MediaSource[]> {
  if (from === 'camera') await cameraAllowed();
  const crop = !!opts.crop && Platform.OS !== 'web';
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    quality: 1,
    exif: false,
    allowsEditing: crop,
    allowsMultipleSelection: from === 'library' && max > 1 && !crop,
    selectionLimit: crop ? 1 : max,
  };
  const res = from === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  return res.canceled ? [] : res.assets.slice(0, max).map(fromAsset);
}

export async function pickVideo(from: 'camera' | 'library', maxSeconds = DEFAULT_MEDIA_LIMITS.video.maxDurationSec): Promise<MediaSource | undefined> {
  if (from === 'camera') await cameraAllowed();
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['videos'], videoMaxDuration: maxSeconds, allowsMultipleSelection: false };
  const res = from === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  return res.canceled || !res.assets[0] ? undefined : fromAsset(res.assets[0]);
}

/** An existing recording from the device's files (docs/06 §2.3 "attach existing audio files"). */
export async function pickAudioFile(): Promise<MediaSource | undefined> {
  const res = await DocumentPicker.getDocumentAsync({ type: ['audio/*'], copyToCacheDirectory: true, multiple: false });
  const a = res.canceled ? undefined : res.assets[0];
  if (!a) return undefined;
  return {
    uri: a.uri,
    ...(a.file ? { file: a.file } : {}),
    ...(a.name ? { name: a.name } : {}),
    ...(a.size ? { sizeBytes: a.size } : {}),
    ...(a.mimeType ? { mimeType: a.mimeType } : {}),
  };
}
