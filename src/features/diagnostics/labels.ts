/** Plain-English names for the stable error codes shown in the usage counts (docs/11 §17.3). */
import { diagnosticsCopy } from './copy';

const copy = diagnosticsCopy.usage;

/** A short label for an error code. Unknown codes read "Other error", never the raw code. */
export function errorLabel(code: string): string {
  if (Object.hasOwn(copy.errors, code)) return copy.errors[code];
  if (code.startsWith('PATCH_')) return copy.patchError;
  return /^[A-Z][A-Z_]+$/.test(code) ? copy.specError : copy.otherError;
}
