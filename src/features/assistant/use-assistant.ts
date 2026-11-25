import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { type AppAssistant, type AssistantAnswer, createAppAssistant } from '@/core/assistant';
import type { KalamSpec } from '@/core/spec/schema';
import { getServices } from '@/services';

let shared: AppAssistant | undefined;

/** One assistant for the whole app, wired to the central orchestrator and this device's records. */
export function getAppAssistant(): AppAssistant {
  if (!shared) {
    const { ai, db } = getServices();
    shared = createAppAssistant({ ai, records: db.records, state: db.state });
  }
  return shared;
}

export interface Exchange {
  id: number;
  question: string;
  /** Absent while the answer is being worked out. */
  answer?: AssistantAnswer;
}

const FAILED: AssistantAnswer = {
  kind: 'refused', text: 'Something went wrong. Try again.', source: 'deterministic', calculatedOnDevice: false, reason: 'error',
};

/** Session-only question and answer list for one app, newest first. Nothing is saved. */
export function useAssistantChat(spec: KalamSpec, appId: string) {
  const [items, setItems] = useState<Exchange[]>([]);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | undefined>(undefined);
  const nextId = useRef(1);
  useEffect(() => () => abort.current?.abort(), []);

  const ask = useCallback(async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    const id = nextId.current++;
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setItems((prev) => [{ id, question: q }, ...prev]);
    const answer = await getAppAssistant().ask(spec, q, { appId, signal: controller.signal }).catch(() => FAILED);
    if (controller.signal.aborted) return;
    setItems((prev) => prev.map((x) => (x.id === id ? { ...x, answer } : x)));
    setBusy(false);
  }, [spec, appId, busy]);

  const suggestions = useMemo(() => getAppAssistant().suggest(spec), [spec]);
  return { items, busy, ask, suggestions };
}
