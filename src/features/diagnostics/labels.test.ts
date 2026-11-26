import { describe, expect, it } from 'vitest';

import { KNOWN_ERROR_CODES } from '@/core/observability';

import { diagnosticsCopy } from './copy';
import { errorLabel } from './labels';

describe('errorLabel', () => {
  it('gives every known code a plain label that is not the code itself', () => {
    for (const code of KNOWN_ERROR_CODES) {
      const label = errorLabel(code);
      expect(label, code).not.toBe(code);
      expect(label, code).toMatch(/^[A-Z][^_]*$/);
      expect(label, code).not.toMatch(/[—–!]/);
    }
  });

  it('names a few codes, groups the design checks, and falls back to other', () => {
    expect(errorLabel('wrong_passphrase_or_damaged')).toBe('Wrong passphrase or damaged backup');
    expect(errorLabel('UNKNOWN_SCREEN')).toBe(diagnosticsCopy.usage.specError);
    expect(errorLabel('PATCH_TOO_LARGE')).toBe(diagnosticsCopy.usage.patchError);
    expect(errorLabel('other')).toBe('Other error');
    expect(errorLabel('something_new')).toBe('Other error');
    expect(errorLabel('')).toBe('Other error');
    expect(errorLabel('constructor')).toBe('Other error');
  });
});
