/**
 * Wires the operation queue to the real app: the device database, the connectivity monitor and the same
 * services the live screens use. One queue per app run.
 *
 * Mount once at startup: `void startOperationQueue()` (after settings have loaded).
 */
import { createOperationQueue, type OperationQueue, type PendingOperation } from '@/core/queue';
import { isActive } from '@/core/queue/model';
import { getServices } from '@/services';
import { getConnectivity } from '@/infrastructure/platform/connectivity';
import { getDatabase } from '@/infrastructure/storage/database';
import { useCreationStore } from '@/state/creation-store';
import { createQueueActions, type QueueActions } from './actions';
import { createQueueHandlers } from './handlers';
import { readBuildResult, restoreBuild } from './snapshot';

let queue: OperationQueue | undefined;
let actions: QueueActions | undefined;
/** Waiting and running operations. The connectivity count is read synchronously, the queue is read asynchronously, so it is kept here. */
let activeCount = 0;
let countWired = false;

export function getOperationQueue(): OperationQueue {
  if (queue) return queue;
  const services = getServices();
  const db = getDatabase();
  queue = createOperationQueue({
    store: db.pendingOps,
    network: services.network,
    handlers: createQueueHandlers({
      apps: db.apps, blobs: db.blobs, network: services.network, createApplication: services.createApplication,
      translate: services.translate, aiBlocks: services.aiBlocks,
    }),
    // Consent is re-read before every attempt: turning cloud help off stops queued work from leaving the device.
    gate: async () => {
      const s = await db.settings.get();
      if (!s.allowCloud || s.aiMode === 'offline_only') return 'cloud_off';
      return (await services.ai.status()).cloudConfigured ? undefined : 'not_configured';
    },
    cleanup: async (op) => void (await db.blobs.removeByOwner(op.id)),
  });
  return queue;
}

/** Recovers what a closed app left, then resumes whenever the connection is back. Safe to call twice. */
export function startOperationQueue(): Promise<void> {
  const q = getOperationQueue();
  if (!countWired) {
    countWired = true;
    const refresh = () => void q.list().then((ops) => { activeCount = ops.filter((op) => isActive(op.status)).length; }, () => undefined);
    q.subscribe(refresh);
    // Queued work counts as pending in the connectivity service (docs/09 §13.4), so "Saving" and sync notes tell the truth.
    getConnectivity().addPendingSource(() => activeCount);
  }
  return q.start();
}

export function getQueueActions(): QueueActions {
  return (actions ??= createQueueActions({ queue: getOperationQueue(), blobs: getDatabase().blobs }));
}

/**
 * Hands a finished build to the review screen as if it had just been built here, then removes the row.
 * `busy` while a live build is running (it would be replaced); `unavailable` when the result or the
 * pictures it was built from can no longer be read.
 */
export async function openQueuedBuild(op: PendingOperation): Promise<'opened' | 'busy' | 'unavailable'> {
  const store = useCreationStore.getState();
  if (store.run.status === 'running') return 'busy';
  const result = readBuildResult(op);
  const draft = await restoreBuild(op.snapshot, (id) => getDatabase().blobs.get(id));
  if (!result || !draft) return 'unavailable';
  store.finishRun(result, draft);
  await getOperationQueue().dismiss(op.id);
  return 'opened';
}
