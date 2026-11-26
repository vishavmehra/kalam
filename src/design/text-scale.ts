/**
 * Text size (docs/10 §5.3): a four-step control in Settings that scales every shell label, on top of the Large
 * access mode. It is a preference about this screen, so it lives on this device (AsyncStorage: localStorage on
 * the web) and is not part of a backup or an app. Large mode keeps its 1.5 and this multiplies it, up to a ceiling
 * where the layout still holds.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

export const TEXT_SCALE_KEY = 'kalam.textScale.v1';
/** Smaller, Default, Larger, Largest. */
export const TEXT_SCALES = [0.9, 1, 1.15, 1.3] as const;
export type TextScale = (typeof TEXT_SCALES)[number];
export const DEFAULT_TEXT_SCALE: TextScale = 1;
export const MAX_FONT_SCALE = 1.75;
const MIN_FONT_SCALE = 0.85;

/** Anything that is not one of the four steps (a damaged value, an old build) means the default. */
export function parseTextScale(raw: unknown): TextScale {
  const n = typeof raw === 'string' ? Number(raw) : raw;
  return TEXT_SCALES.find((s) => s === n) ?? DEFAULT_TEXT_SCALE;
}

/** Large mode (1.5) times the chosen step, kept inside what the layout can hold. */
export function effectiveFontScale(large: boolean, step: number): number {
  const raw = (large ? 1.5 : 1) * step;
  return Math.round(Math.min(MAX_FONT_SCALE, Math.max(MIN_FONT_SCALE, raw)) * 100) / 100;
}

let current: TextScale = DEFAULT_TEXT_SCALE;
let hydrated = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Reads the saved step once. A storage that cannot be read leaves the default. */
export async function loadTextScale(): Promise<TextScale> {
  if (hydrated) return current;
  hydrated = true;
  try {
    const next = parseTextScale(await AsyncStorage.getItem(TEXT_SCALE_KEY));
    if (next !== current) { current = next; emit(); }
  } catch {
    // Nothing saved or storage blocked: the default stays.
  }
  return current;
}

export async function setTextScale(step: TextScale): Promise<void> {
  current = step;
  hydrated = true;
  emit();
  await AsyncStorage.setItem(TEXT_SCALE_KEY, String(step));
}

export const getTextScale = (): TextScale => current;

/** Test hook: back to a fresh module state. */
export function resetTextScaleForTests(): void {
  current = DEFAULT_TEXT_SCALE;
  hydrated = false;
  listeners.clear();
}

export function useTextScale(): TextScale {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => current,
    () => DEFAULT_TEXT_SCALE,
  );
}
