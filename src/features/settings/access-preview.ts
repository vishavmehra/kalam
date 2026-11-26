/**
 * Access mode changes (docs/03 §19.4): a change you can see (Large, High contrast, Simple, Left-handed) shows a
 * small preview of the result before it is applied; every change can be undone from the toast that follows.
 * Pure logic, so the rules are tested without a screen.
 */
import type { AccessModes } from '@/core/contracts';
import type { TranslationKey } from '@/i18n/keys';

export type AccessModeKey = keyof AccessModes;

/** Modes that change how the screen looks: worth showing before they apply. */
const VISIBLE: ReadonlySet<AccessModeKey> = new Set<AccessModeKey>(['large', 'highContrast', 'simple', 'leftHanded']);

/** Turning something on asks first (with a preview); turning off, and sound-only modes, apply at once. */
export function needsPreview(key: AccessModeKey, turningOn: boolean): boolean {
  return turningOn && VISIBLE.has(key);
}

export function withMode(modes: AccessModes, key: AccessModeKey, value: boolean): AccessModes {
  return { ...modes, [key]: value };
}

/** The sentence for the undo toast, as a key and its `{mode}` label key, so it reads in the chosen language. */
export const MODE_LABEL: Record<AccessModeKey, TranslationKey> = {
  large: 'settings.access.large',
  highContrast: 'settings.access.highContrast',
  simple: 'settings.access.simple',
  readAloud: 'settings.access.readAloud',
  leftHanded: 'settings.access.leftHanded',
  voiceOnly: 'settings.access.voiceOnly',
};

export const toastKey = (turnedOn: boolean): TranslationKey => (turnedOn ? 'settings.access.toastOn' : 'settings.access.toastOff');

/** The shell destinations a sample menu shows for a set of modes, in the order a hand reaches them. */
export function sampleKeys(modes: AccessModes): Array<'shelf' | 'make' | 'activity' | 'settings'> {
  const base: Array<'shelf' | 'make' | 'activity' | 'settings'> = modes.simple ? ['shelf', 'make', 'settings'] : ['shelf', 'make', 'activity', 'settings'];
  return modes.leftHanded ? [...base].reverse() : base;
}
