import { useCallback, useEffect, useRef, useState } from 'react';

import {
  createReportService, type ReportDefinition, type ReportExplanation, type ReportOutcome, type ReportResult, type ReportService,
} from '@/core/reports';
import type { KalamSpec } from '@/core/spec/schema';
import { getServices } from '@/services';
import { useSettingsStore } from '@/state/settings-store';

import { COPY } from './copy';

let shared: ReportService | undefined;

/** One report service for the whole app, wired to the central orchestrator and this device's records. */
export function getReportService(): ReportService {
  if (!shared) {
    const { ai, db } = getServices();
    shared = createReportService({ ai, records: db.records });
  }
  return shared;
}

/**
 * Runs a report while `active`, and again whenever the app's entries change. The outcome is tied to
 * the definition it was computed for, so after picking another report nothing old is shown.
 */
export function useReport(spec: KalamSpec, appId: string, def: ReportDefinition | undefined, active: boolean) {
  const [state, setState] = useState<{ def: ReportDefinition; outcome: ReportOutcome } | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!def || !active) return undefined;
    let latest = 0;
    let alive = true;
    const run = () => {
      const mine = ++latest;
      setLoading(true);
      getReportService().run(spec, def, { appId })
        .catch((): ReportOutcome => ({ ok: false, errors: [COPY.failed] }))
        .then((outcome) => {
          if (!alive || mine !== latest) return; // a newer run started
          setState({ def, outcome });
          setLoading(false);
        });
    };
    run();
    const unsubscribe = getServices().db.records.subscribe(appId, run);
    return () => { alive = false; unsubscribe(); };
  }, [spec, appId, def, active]);
  return { outcome: def && state?.def === def ? state.outcome : undefined, loading };
}

/**
 * Optional explanation of one computed result. Cleared when the result changes. The first ask stays
 * on this device; Gemini online is used only when the person asks again for it (docs/14 §7.6).
 */
export function useExplanation(result: ReportResult | undefined, appId: string) {
  const cloudAllowed = useSettingsStore((s) => s.settings.allowCloud && s.settings.aiMode === 'hybrid');
  const [explanation, setExplanation] = useState<ReportExplanation | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    setExplanation(undefined);
    setBusy(false);
    return () => abort.current?.abort();
  }, [result]);

  const explain = useCallback(async (online = false) => {
    if (!result) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    const e = await getReportService().explain(result, { appId, signal: controller.signal, onDeviceOnly: !(online && cloudAllowed) });
    if (controller.signal.aborted) return;
    setExplanation(e);
    setBusy(false);
  }, [result, appId, cloudAllowed]);
  return { explanation, busy, explain, canAskOnline: cloudAllowed && !!explanation?.cloudOffer };
}
