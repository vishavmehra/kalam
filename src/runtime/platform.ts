/**
 * Device capabilities the runtime needs: speech, photo picking, confirmation dialogs.
 * Everything here works offline; nothing makes a network call.
 */
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as Speech from 'expo-speech';
import { Alert, Platform } from 'react-native';
import type { AIImage } from '@/core/contracts';
import { limitsPolicy } from '@/core/limits/policy';

const MAX_EDGE = limitsPolicy.input.imageSide;

export function speakText(text: string, lang: string): void {
  try {
    void Speech.stop();
    Speech.speak(text, { language: lang });
  } catch {
    // Missing TTS must never break the app (docs/10 §4.4).
  }
}

/** Opens the system photo picker and returns a JPEG no larger than 1280px on its long edge (limits policy). */
export async function pickImageForAI(): Promise<AIImage | undefined> {
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
  if (result.canceled || !result.assets?.length) return undefined;
  const asset = result.assets[0];
  const landscape = (asset.width ?? 0) >= (asset.height ?? 0);
  const longEdge = Math.max(asset.width ?? 0, asset.height ?? 0);
  const ctx = ImageManipulator.manipulate(asset.uri);
  if (longEdge > MAX_EDGE) ctx.resize(landscape ? { width: MAX_EDGE } : { height: MAX_EDGE });
  const ref = await ctx.renderAsync();
  const saved = await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.82, base64: true });
  if (!saved.base64) return undefined;
  return { mimeType: 'image/jpeg', base64: saved.base64 };
}

/** Platform confirmation dialog. Resolves false when dismissed. */
export function confirmDialog(message: string, confirmLabel = 'Delete'): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Promise.resolve(typeof window !== 'undefined' && typeof window.confirm === 'function' ? window.confirm(message) : false);
  }
  return new Promise((resolve) => {
    Alert.alert(message, undefined, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: confirmLabel, style: 'destructive', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}
