/**
 * Chrome built-in AI (Prompt API, Gemini Nano) status + model preparation for the web. Inference
 * itself always goes through Firebase AI Logic's hybrid `GenerativeModel` (firebase-provider.ts);
 * this file only answers "can Nano run here?", triggers the one-time download and keeps the model warm.
 */
import type { LanguageModelCreateCoreOptions, LanguageModelDownloadMonitor } from 'firebase/ai';
import type { OnDeviceStatus } from '@/core/contracts';
import { textIO } from './prompt-io';

type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';
export interface LanguageModelStatic {
  availability(options?: LanguageModelCreateCoreOptions): Promise<Availability>;
  create(options?: LanguageModelCreateCoreOptions & { signal?: AbortSignal }): Promise<{ destroy(): void }>;
}

/**
 * English text, the provider's default for requests that name no language (prompt-io.ts), so the
 * availability answer, download and warm-up match what most requests ask for.
 */
export const TEXT_IO: LanguageModelCreateCoreOptions = textIO();

const KNOWN = new Set<string>(['unavailable', 'downloadable', 'downloading', 'available']);
let progress: number | undefined;

/**
 * Measured on Chrome 157: the first session per page load takes ~40 s (model load), later ones ~0.1 s.
 * One live session keeps the model in memory, so later prompts skip that cost.
 */
let warmSession: { destroy(): void } | undefined;
let warming: Promise<OnDeviceStatus> | undefined;

export function getLanguageModel(): LanguageModelStatic | undefined {
  return (globalThis as { LanguageModel?: LanguageModelStatic }).LanguageModel;
}

export async function onDeviceStatus(): Promise<OnDeviceStatus> {
  const lm = getLanguageModel();
  if (!lm) {
    return {
      platform: 'web', apiExposed: false, availability: 'unavailable',
      detail: 'This browser does not expose the Prompt API (LanguageModel). Use desktop Chrome 139+.',
    };
  }
  try {
    const a = await lm.availability(TEXT_IO);
    const availability = KNOWN.has(a) ? a : 'unknown';
    return {
      platform: 'web', apiExposed: true, availability,
      progress: availability === 'downloading' ? progress : undefined,
      ...(availability === 'available' ? { warm: !!warmSession } : {}),
    };
  } catch (e) {
    return { platform: 'web', apiExposed: true, availability: 'unknown', detail: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Starts (or joins) the Gemini Nano download and warms the model. A download-triggering `create()`
 * MUST come from a user gesture (Chrome requires transient user activation).
 */
export async function prepareOnDevice(onProgress?: (p: number) => void): Promise<OnDeviceStatus> {
  const lm = getLanguageModel();
  if (!lm) return onDeviceStatus();
  try {
    const session = await lm.create({
      ...TEXT_IO,
      monitor(m: LanguageModelDownloadMonitor) {
        m.addEventListener('downloadprogress', (e) => {
          progress = e.loaded;
          onProgress?.(e.loaded);
        });
      },
    });
    warmSession?.destroy();
    warmSession = session;
  } catch (e) {
    return { ...(await onDeviceStatus()), detail: e instanceof Error ? e.message : String(e) };
  }
  return onDeviceStatus();
}

/**
 * Loads an already-downloaded Nano into memory. Acts only when availability is `available`, so it
 * never starts a download and needs no user gesture. Concurrent calls share one load.
 */
export function warmUpOnDevice(): Promise<OnDeviceStatus> {
  warming ??= (async () => {
    const status = await onDeviceStatus();
    const lm = getLanguageModel();
    if (!lm || status.availability !== 'available' || warmSession) return status;
    try {
      warmSession = await lm.create(TEXT_IO);
    } catch (e) {
      return { ...status, warm: false, detail: e instanceof Error ? e.message : String(e) };
    }
    return { ...status, warm: true };
  })().finally(() => {
    warming = undefined;
  });
  return warming;
}
