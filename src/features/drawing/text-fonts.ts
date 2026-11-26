/**
 * Noto fonts for drawing text on demand (docs/08 §6.6). The canvases ask `ensureTextFonts` the first time
 * they meet Hindi, Tamil or another Indic script; it loads that script through N9's loader
 * (`loadFontsForText`, the same files the app's own screens use) and tells every canvas to draw again.
 * Android's Skia keeps its own copy of the font data, so it registers a target here (see `skia-text.ts`).
 * Latin text never touches any of this.
 */
import type { NonLatinScript } from '@/i18n/scripts';
import { isScriptLoaded, loadFontsForText } from '@/i18n/use-script-fonts';
import { nonLatinScripts, pageTextOf } from './model';
import type { DrawingPage } from '@/core/contracts';

/** Something besides expo-font that needs the fonts too, such as Skia's typeface provider on Android. */
export interface FontTarget {
  has(script: NonLatinScript): boolean;
  load(scripts: readonly NonLatinScript[]): Promise<void>;
}

const targets = new Set<FontTarget>();
const listeners = new Set<() => void>();
const inflight = new Map<string, Promise<void>>();
const failedAt = new Map<string, number>();
let version = 0;
/** After a failed load, wait this long before asking again, so a missing font never loops. */
const RETRY_MS = 30_000;

export function registerFontTarget(target: FontTarget): void {
  targets.add(target);
}

export const textFontsVersion = (): number => version;

export function subscribeTextFonts(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

const missing = (scripts: readonly NonLatinScript[]): NonLatinScript[] =>
  scripts.filter((s) => !isScriptLoaded(s) || [...targets].some((t) => !t.has(s)));

/**
 * Starts loading the fonts `text` needs. Returns undefined when nothing is missing, otherwise a promise that
 * settles when loading is done or has failed (the canvas then keeps the system font). Safe to call every frame.
 */
export function ensureTextFonts(text: string): Promise<void> | undefined {
  const need = missing(nonLatinScripts(text));
  if (need.length === 0) return undefined;
  const key = need.join(',');
  const running = inflight.get(key);
  if (running) return running;
  const last = failedAt.get(key);
  if (last !== undefined && Date.now() - last < RETRY_MS) return undefined;
  const job = (async () => {
    try {
      await loadFontsForText(need.map((s) => scriptSample[s]).join(' '));
      await Promise.all([...targets].map((t) => t.load(need)));
      failedAt.delete(key);
    } catch {
      failedAt.set(key, Date.now());
    }
  })().finally(() => {
    inflight.delete(key);
    version += 1;
    for (const l of [...listeners]) l();
  });
  inflight.set(key, job);
  return job;
}

/** One letter of each script, so `loadFontsForText` loads exactly the scripts that are missing. */
const scriptSample: Record<NonLatinScript, string> = {
  devanagari: 'अ', bengali: 'অ', gurmukhi: 'ਅ', gujarati: 'અ', tamil: 'அ', telugu: 'అ', kannada: 'ಅ', malayalam: 'അ',
};

/** Waits for the fonts a page needs, so an export never draws a Hindi label in the wrong font. */
export async function textFontsReady(pages: readonly DrawingPage[]): Promise<void> {
  const jobs = pages.map((p) => ensureTextFonts(pageTextOf(p))).filter((j): j is Promise<void> => !!j);
  await Promise.all(jobs);
}
