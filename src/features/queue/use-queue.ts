/** React bindings for the queue: the live list of operations, the connection state, and app names. */
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { PendingOperation } from '@/core/queue';
import { getDatabase } from '@/infrastructure/storage/database';
import { getServices } from '@/services';
import { getOperationQueue } from './queue-service';

/** Every queued operation, kept current as the queue changes. Empty until the first read. */
export function useQueueOps(): PendingOperation[] {
  const [ops, setOps] = useState<PendingOperation[]>([]);
  useEffect(() => {
    let alive = true;
    let queue: ReturnType<typeof getOperationQueue>;
    try {
      queue = getOperationQueue();
    } catch {
      return undefined; // storage could not open: show nothing rather than break the screen
    }
    const load = () => void queue.list().then((rows) => alive && setOps(rows), () => undefined);
    load();
    const off = queue.subscribe(load);
    return () => {
      alive = false;
      off();
    };
  }, []);
  return ops;
}

/** Whether the connectivity monitor says the device is online. A hint, not proof that the cloud is reachable. */
export function useQueueOnline(): boolean {
  return useSyncExternalStore(
    (notify) => getServices().network.subscribe(() => notify()),
    () => getServices().network.online(),
    () => true,
  );
}

/** App id to app name, for the apps these operations belong to. */
export function useAppNames(ops: readonly PendingOperation[]): Record<string, string> {
  const [names, setNames] = useState<Record<string, string>>({});
  const key = [...new Set(ops.map((o) => o.appId).filter(Boolean))].sort().join(',');
  useEffect(() => {
    if (!key) return undefined;
    let alive = true;
    void getDatabase().apps.list().then(
      (apps) => alive && setNames(Object.fromEntries(apps.map((a) => [a.id, a.spec.name]))),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [key]);
  return names;
}

/** Finished AI steps for one app, for the runtime to show as a proposal. See `readAiStepResult`. */
export function useQueuedAiResults(appId: string): PendingOperation[] {
  return useQueueOps().filter((o) => o.kind === 'ai_step' && o.status === 'completed' && o.appId === appId);
}
