/**
 * Runs one compilation from the current draft (docs/03 §6.5): snapshot → createApplication with
 * live stages → result. Cancelling aborts the request and keeps every input.
 */
import { useCallback } from 'react';
import { getServices } from '@/services';
import { selectDraft, useCreationStore } from '@/state/creation-store';
import { buildNormalizedInput, draftBlocker } from '@/features/input/normalize';
import type { CreationResult } from '@/core/contracts';

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
    if (draftBlocker(draft)) return undefined;
    // Snapshot: store updates replace arrays/objects immutably, so later edits never mutate this request.
    const input = buildNormalizedInput(draft);
    controller?.abort();
    const ac = new AbortController();
    controller = ac;
    startRun();
    try {
      const result = await getServices().createApplication(input, { signal: ac.signal, onStage });
      if (ac.signal.aborted) return undefined;
      finishRun(result, draft);
      return result;
    } catch (e) {
      if (ac.signal.aborted) return undefined;
      const failed: CreationResult = {
        ok: false,
        classification: {
          taskType: 'create_app', complexity: 'simple', estimatedScreens: 0, estimatedCollections: 0, estimatedActions: 0,
          requiresMultimodalReasoning: false, requiresCloudReasoning: false, confidence: 0, method: 'deterministic', reasons: [],
        },
        route: 'manual', provider: 'none', warnings: [], errors: [],
        message: e instanceof Error && e.message.length < 200 ? e.message : 'Something went wrong while building. Your input is kept.',
        latencyMs: 0,
      };
      finishRun(failed, draft);
      return failed;
    } finally {
      if (controller === ac) controller = undefined;
    }
  }, [finishRun, onStage, startRun]);

  const cancel = useCallback(() => {
    controller?.abort();
    controller = undefined;
    cancelRun();
  }, [cancelRun]);

  return { run, cancel };
}
