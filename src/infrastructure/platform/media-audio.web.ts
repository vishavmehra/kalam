/** Web: release a temporary recording. Recordings live as blob URLs, so revoking frees the audio. Never throws. */
export * from './media-audio.shared';

export async function discardRecording(uri: string | undefined | null): Promise<boolean> {
  if (!uri) return false;
  try {
    if (uri.startsWith('blob:')) {
      URL.revokeObjectURL(uri);
      return true;
    }
  } catch {
    // Nothing to release.
  }
  return false;
}
