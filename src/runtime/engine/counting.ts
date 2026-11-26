/**
 * Opt-in use counters for the person's own apps (docs/01 §20): a new entry, and any entry saved with no
 * connection ("things done without internet").
 *
 * This wraps the persistent repository only. The engine itself never counts: it cannot tell a save from a
 * run over memory stores (the "Try it" tab, the edit preview, a Bazaar listing preview), and previews are
 * not counted on purpose (core/telemetry/counters.ts). A write that throws is not counted.
 */
import type { RecordOp, RecordRepository } from '@/core/contracts';
import { track } from '@/core/telemetry';

export function countingRecords(records: RecordRepository, online: () => boolean): RecordRepository {
  const offline = () => {
    if (!online()) track('flow', 'offline_operation_completed');
  };
  return {
    ...records,
    async insert(appId, collectionId, values) {
      const row = await records.insert(appId, collectionId, values);
      track('flow', 'record_created');
      offline();
      return row;
    },
    async update(appId, collectionId, id, values) {
      const row = await records.update(appId, collectionId, id, values);
      offline();
      return row;
    },
    // A batch counts like the single writes it stands for, and only when the whole batch went through.
    ...(records.batch && {
      async batch(appId: string, ops: RecordOp[]) {
        await records.batch!(appId, ops);
        for (const op of ops) {
          if (op.op === 'remove') continue;
          if (op.op === 'insert') track('flow', 'record_created');
          offline();
        }
      },
    }),
  };
}
