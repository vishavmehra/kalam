/**
 * The client side of the anonymous listing counters (docs/12 §21). Nothing is sent unless the person turned
 * "share view counts" on, and the same listing is counted once per ten minutes on this device. A count that
 * fails is dropped: it is never retried, queued or reported, so it cannot slow or break a screen.
 */
export type CountKind = 'view' | 'preview';

export const DEDUPE_MS = 10 * 60_000;

export function createListingEventRecorder(deps: {
  enabled: () => Promise<boolean>;
  send: (listingId: string, kind: CountKind) => Promise<unknown>;
  now?: () => number;
}) {
  const now = deps.now ?? Date.now;
  const last = new Map<string, number>();
  return async function record(listingId: string, kind: CountKind): Promise<void> {
    try {
      const key = `${listingId}:${kind}`;
      const at = now();
      if (at - (last.get(key) ?? -Infinity) < DEDUPE_MS) return;
      last.set(key, at); // before the await, so two calls at once count once
      if (last.size > 200) last.delete(last.keys().next().value as string);
      if (!(await deps.enabled())) { last.delete(key); return; }
      await deps.send(listingId, kind);
    } catch {
      // Counting must never break the screen it is on.
    }
  };
}
