import { describe, expect, it } from 'vitest';

import type { AccessModes } from '@/core/contracts';

import { MODE_LABEL, needsPreview, sampleKeys, toastKey, withMode } from './access-preview';

const OFF: AccessModes = { large: false, highContrast: false, simple: false, readAloud: false, leftHanded: false, voiceOnly: false };

describe('access mode preview and undo (D03-058)', () => {
  it('asks first only when a visible mode is turned on', () => {
    for (const k of ['large', 'highContrast', 'simple', 'leftHanded'] as const) {
      expect(needsPreview(k, true), k).toBe(true);
      expect(needsPreview(k, false), `${k} off`).toBe(false);
    }
    for (const k of ['readAloud', 'voiceOnly'] as const) expect(needsPreview(k, true), k).toBe(false);
  });

  it('builds the proposed modes without touching the current ones', () => {
    const next = withMode(OFF, 'large', true);
    expect(next.large).toBe(true);
    expect(OFF.large).toBe(false);
    expect(next.simple).toBe(false);
  });

  it('has a label and a toast sentence for every mode', () => {
    expect(Object.keys(MODE_LABEL).sort()).toEqual(Object.keys(OFF).sort());
    expect(toastKey(true)).toBe('settings.access.toastOn');
    expect(toastKey(false)).toBe('settings.access.toastOff');
  });

  it('shows the sample menu as it would be: Simple hides Activity, Left-handed reverses it', () => {
    expect(sampleKeys(OFF)).toEqual(['shelf', 'make', 'activity', 'settings']);
    expect(sampleKeys({ ...OFF, simple: true })).toEqual(['shelf', 'make', 'settings']);
    expect(sampleKeys({ ...OFF, leftHanded: true })).toEqual(['settings', 'activity', 'make', 'shelf']);
  });
});
