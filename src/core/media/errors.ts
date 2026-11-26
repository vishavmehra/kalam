/** Named media errors (docs/06 §14.2). The message is already plain English for the person. */
import { mediaErrorMessage, type ErrorDetail } from './copy';
import type { MediaErrorCode } from './types';

export class MediaError extends Error {
  constructor(readonly code: MediaErrorCode, readonly detail: ErrorDetail = {}, message?: string) {
    super(message ?? mediaErrorMessage(code, detail));
    this.name = 'MediaError';
  }
  toJSON(): { code: MediaErrorCode; message: string } {
    return { code: this.code, message: this.message.slice(0, 400) };
  }
}

export function isMediaError(e: unknown): e is MediaError {
  return e instanceof Error && e.name === 'MediaError' && typeof (e as MediaError).code === 'string';
}

/** Any thrown value as a MediaError; unknown failures get `fallback`. */
export function toMediaError(e: unknown, fallback: MediaErrorCode): MediaError {
  if (isMediaError(e)) return e;
  const name = e instanceof Error ? e.name : '';
  const msg = e instanceof Error ? e.message : '';
  if (name === 'MediaPermissionError' || /permission|not-allowed|denied/i.test(msg)) return new MediaError('PERMISSION_DENIED');
  if (/offline|network/i.test(msg)) return new MediaError('NETWORK_UNAVAILABLE');
  return new MediaError(fallback);
}
