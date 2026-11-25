/**
 * Share a text through the system share sheet, or copy it when there is no share sheet. Pure: the
 * device calls are passed in (see share.ts), so the fallback rules are tested without a device.
 */
export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed';

export interface ShareDeps {
  /** Opens the share sheet. Resolves `dismissed` if the person closes it. Rejects if sharing is unavailable. */
  share(text: string): Promise<'shared' | 'dismissed'>;
  copy(text: string): Promise<void>;
}

export async function copyOnly(text: string, deps: Pick<ShareDeps, 'copy'>): Promise<'copied' | 'failed'> {
  try {
    await deps.copy(text);
    return 'copied';
  } catch {
    return 'failed';
  }
}

/** A closed share sheet is a choice, not an error: nothing is copied behind the person's back. */
export async function shareOrCopy(text: string, deps: ShareDeps): Promise<ShareOutcome> {
  try {
    return (await deps.share(text)) === 'shared' ? 'shared' : 'cancelled';
  } catch {
    return copyOnly(text, deps);
  }
}
