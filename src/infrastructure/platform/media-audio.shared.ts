/**
 * Recording hygiene (docs/11 §7.3, lead decision 3): a raw recording is a temporary file. It is
 * deleted as soon as it has been turned into text unless the person turned on "Keep recordings on
 * this device". Recordings are never uploaded. Pure TypeScript.
 */
export type DiscardFn = (uri: string) => Promise<boolean>;

/**
 * Applies the keep-or-delete rule to a finished recording.
 * Returns the uri when the recording is kept, and undefined when it was deleted (or there was none).
 */
export async function settleRecording(
  uri: string | undefined | null, keep: boolean, discard: DiscardFn,
): Promise<string | undefined> {
  if (!uri) return undefined;
  if (keep) return uri;
  try {
    await discard(uri);
  } catch {
    // A file that cannot be deleted is still not reported as kept.
  }
  return undefined;
}
