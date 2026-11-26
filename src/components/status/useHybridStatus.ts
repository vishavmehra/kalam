import { useCallback, useEffect, useState } from 'react';

import type { AIOrchestrator } from '@/core/contracts';
import { t } from '@/i18n/active';
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
      setError(e instanceof Error ? e.message : t('aiStatus.failed'));
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return { status, error, refresh };
}

/** Short user-facing description of on-device availability, in the active UI language. */
export function describeOnDevice(s: AIStatus['onDevice'] | undefined): { label: string; short: string; ready: boolean } {
  switch (s?.availability) {
    case 'available': return { label: t('aiStatus.ready'), short: t('aiStatus.short.ready'), ready: true };
    case 'downloading': return { label: t('aiStatus.preparing'), short: t('aiStatus.short.preparing'), ready: false };
    case 'downloadable': return { label: t('aiStatus.notDownloaded'), short: t('aiStatus.short.notDownloaded'), ready: false };
    case 'unavailable': return { label: t('aiStatus.unavailable'), short: t('aiStatus.short.unavailable'), ready: false };
    default: return { label: t('aiStatus.checking'), short: t('aiStatus.short.checking'), ready: false };
  }
}
