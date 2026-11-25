import { useCallback, useEffect, useState } from 'react';

import type { AIOrchestrator } from '@/core/contracts';
import { getServices } from '@/services';

export type AIStatus = Awaited<ReturnType<AIOrchestrator['status']>>;

/** Live online/offline state from the shared network monitor (offline-first UI, docs/03 §21). */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    try {
      const net = getServices().network;
      setOnline(net.online());
      return net.subscribe(setOnline);
    } catch {
      return undefined;
    }
  }, []);
  return online;
}

/**
 * Real hybrid-AI status from the orchestrator: on-device (Gemini Nano) availability, cloud
 * configuration, specialist availability. `null` while loading; `error` if services failed.
 */
export function useAIStatus(): { status: AIStatus | null; error: string | null; refresh: () => Promise<void> } {
  const [status, setStatus] = useState<AIStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      setStatus(await getServices().ai.status());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI status is unavailable');
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return { status, error, refresh };
}

/** Short user-facing description of on-device availability. */
export function describeOnDevice(s: AIStatus['onDevice'] | undefined): { label: string; short: string; ready: boolean } {
  switch (s?.availability) {
    case 'available': return { label: 'On-device AI ready', short: 'On-device AI', ready: true };
    case 'downloading': return { label: 'Preparing on-device AI', short: 'Preparing AI', ready: false };
    case 'downloadable': return { label: 'On-device AI not downloaded', short: 'Set up AI', ready: false };
    case 'unavailable': return { label: 'On-device AI unavailable', short: 'No on-device AI', ready: false };
    default: return { label: 'Checking on-device AI', short: 'Checking AI', ready: false };
  }
}
