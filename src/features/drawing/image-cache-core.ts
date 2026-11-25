/**
 * Decoded-bitmap cache for image objects (docs/08 §6.7, §17.1). Bytes live in the BlobRepository,
 * never in the drawing document; this keeps one decoded copy per blob while the studio is open.
 * Platform files supply `decode` (HTMLImageElement on web, SkImage on Android). Renderers call the
 * synchronous `get`, which starts a load on first use and notifies subscribers when it lands, so
 * drawing never waits on storage.
 */
export interface BlobPayload { base64: string; mimeType: string }
export type BlobLoader = (blobId: string) => Promise<BlobPayload | undefined>;

/** Only real image types are decoded; blob records are untrusted. */
const MIME_OK = /^image\/(jpeg|png|webp)$/;

export interface ImageCache<T> {
  /** Decoded image, or undefined while loading or if it is missing. */
  get(blobId: string): T | undefined;
  /** True once a load has failed or the blob does not exist. */
  isMissing(blobId: string): boolean;
  /** Stores bytes already in hand (a photo just placed), skipping the storage read. */
  put(blobId: string, payload: BlobPayload): Promise<void>;
  /** Resolves when every id has loaded or failed. Exports call this before rendering. */
  ensure(blobIds: readonly string[]): Promise<void>;
  setLoader(loader: BlobLoader | undefined): void;
  subscribe(listener: () => void): () => void;
  /** Bumps whenever a bitmap arrives; use as a React dependency. */
  version(): number;
}

export function createImageCache<T>(decode: (payload: BlobPayload) => Promise<T | undefined> | T | undefined): ImageCache<T> {
  const ready = new Map<string, T>();
  const missing = new Set<string>();
  const loading = new Map<string, Promise<void>>();
  const listeners = new Set<() => void>();
  let loader: BlobLoader | undefined;
  let version = 0;

  const done = (id: string, value: T | undefined) => {
    loading.delete(id);
    if (value !== undefined) ready.set(id, value); else missing.add(id);
    version += 1;
    listeners.forEach((l) => l());
  };

  const load = (id: string): Promise<void> => {
    const existing = loading.get(id);
    if (existing) return existing;
    const run = (async () => {
      try {
        const payload = await loader?.(id);
        if (!payload || !MIME_OK.test(payload.mimeType)) { done(id, undefined); return; }
        done(id, await decode(payload));
      } catch {
        done(id, undefined);
      }
    })();
    loading.set(id, run);
    return run;
  };

  return {
    get(id) {
      const hit = ready.get(id);
      if (hit !== undefined) return hit;
      if (!missing.has(id) && !loading.has(id) && loader) void load(id);
      return undefined;
    },
    isMissing: (id) => missing.has(id),
    async put(id, payload) {
      if (ready.has(id)) return;
      if (!MIME_OK.test(payload.mimeType)) { done(id, undefined); return; }
      try { done(id, await decode(payload)); } catch { done(id, undefined); }
    },
    async ensure(ids) {
      const wanted = [...new Set(ids)].filter((id) => !ready.has(id) && !missing.has(id));
      await Promise.all(wanted.map((id) => (loader ? load(id) : Promise.resolve())));
    },
    setLoader(next) { loader = next; },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    version: () => version,
  };
}
