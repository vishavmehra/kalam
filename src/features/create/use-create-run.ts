/**
 * Runs one compilation from the current draft (docs/03 §6.5): snapshot → createApplication with
 * live stages → result. Cancelling aborts the request and keeps every input.
 */
import { useCallback } from 'react';

import type { CreationResult } from '@/core/contracts';
import { reportError } from '@/core/telemetry';
import { createBlocker, mediaEvent, prepareCreation } from '@/features/media';
import { t } from '@/i18n/active';
import { getServices } from '@/services';
import { selectDraft, useCreationStore } from '@/state/creation-store';

let controller: AbortController | undefined;

export function useCreateRun() {
  const startRun = useCreationStore((s) => s.startRun);
  const onStage = useCreationStore((s) => s.onStage);
  const finishRun = useCreationStore((s) => s.finishRun);
  const cancelRun = useCreationStore((s) => s.cancelRun);

  const run = useCallback(async (): Promise<CreationResult | undefined> => {
    const state = useCreationStore.getState();
    if (state.run.status === 'running') return undefined;
    const draft = selectDraft(state);
    if (createBlocker(draft)) return undefined;
    // Snapshot: store updates replace arrays/objects immutably, so later edits never mutate this request.
    // The media session's notes, answers, video steps and recordings ride along (docs/06 §13).
    const input = prepareCreation(draft).input;
    controller?.abort();
    const ac = new AbortController();
    controller = ac;
    startRun();
    mediaEvent('compile_started');
    try {
      const result = await getServices().createApplication(input, { signal: ac.signal, onStage });
      if (ac.signal.aborted) return undefined;
      finishRun(result, draft);
      mediaEvent(result.ok ? 'compile_succeeded' : 'compile_failed');
      return result;
    } catch (e) {
      if (ac.signal.aborted) return undefined;
      reportError(e); // an error code only, never the message (it may quote the person's input)
      const failed: CreationResult = {
        ok: false,
        classification: {
          taskType: 'create_app', complexity: 'simple', estimatedScreens: 0, estimatedCollections: 0, estimatedActions: 0,
          requiresMultimodalReasoning: false, requiresCloudReasoning: false, confidence: 0, method: 'deterministic', reasons: [],
        },
        route: 'manual', provider: 'none', warnings: [], errors: [],
        // Plain words in the UI language; a raw error text (TypeError, fetch) is never shown.
        message: t('create.error.generic'),
        latencyMs: 0,
      };
      finishRun(failed, draft);
      mediaEvent('compile_failed');
      return failed;
    } finally {
      if (controller === ac) controller = undefined;
    }
  }, [finishRun, onStage, startRun]);

  const cancel = useCallback(() => {
    controller?.abort();
    controller = undefined;
    cancelRun();
    mediaEvent('cancelled');
  }, [cancelRun]);

  return { run, cancel };
}
