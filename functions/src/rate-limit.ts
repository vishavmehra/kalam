/**
 * Per-instance sliding-window rate limit for the specialist callable.
 * ponytail: memory per instance (maxInstances caps the total); move to Firestore if abused.
 * When the key table is full the least recently seen keys are evicted, never the whole table
 * (SECURITY_REVIEW R-02): rotating keys can no longer reset a busy caller's history.
 */
export function createRateLimiter(o: { windowMs: number; maxPerWindow: number; maxKeys: number }) {
  const hits = new Map<string, number[]>();
  return {
    /** Records one call for `key` and says whether it is over the limit. */
    limited(key: string, now = Date.now()): boolean {
      const recent = (hits.get(key) ?? []).filter((t) => now - t < o.windowMs);
      recent.push(now);
      hits.delete(key); // re-insert: Map iteration order is then least recently seen first
      hits.set(key, recent);
      for (const k of hits.keys()) {
        if (hits.size <= o.maxKeys) break;
        hits.delete(k);
      }
      return recent.length > o.maxPerWindow;
    },
    size: () => hits.size,
  };
}
