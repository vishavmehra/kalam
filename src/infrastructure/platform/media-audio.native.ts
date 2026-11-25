/** Android: delete a temporary recording file. Never throws. */
import { File } from 'expo-file-system';

export * from './media-audio.shared';

export async function discardRecording(uri: string | undefined | null): Promise<boolean> {
  if (!uri) return false;
  try {
    const file = new File(uri);
    if (!file.exists) return false;
    file.delete();
    return true;
  } catch {
    return false;
  }
}
