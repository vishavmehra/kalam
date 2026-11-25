/**
 * Smart Reports for one app. Records come in through an injected repository (the same shape the
 * App Assistant uses) and only the report's own collection is read.
 */
import type { AIOrchestrator, RecordRepository } from '../contracts';
import type { KalamSpec } from '../spec/schema';
import { REPORT_COPY } from './copy';
import type { ReportDefinition } from './definition';
import { type ReportOutcome, type ReportResult, runReport } from './engine';
import { type ExplainContext, explainReport, type ReportExplanation } from './explain';
import { suggestReports } from './suggest';

export interface ReportServiceDeps {
  ai: AIOrchestrator;
  records?: Pick<RecordRepository, 'list'>;
  now?: () => Date;
  /** IANA zone. Absent: the device zone. */
  timeZone?: string;
}

export interface ReportService {
  suggest(spec: KalamSpec): ReportDefinition[];
  /** Validates the definition, reads its one collection, computes on this device. */
  run(spec: KalamSpec, def: ReportDefinition, ctx?: { appId?: string }): Promise<ReportOutcome>;
  explain(result: ReportResult, ctx?: ExplainContext): Promise<ReportExplanation>;
}

export function createReportService(deps: ReportServiceDeps): ReportService {
  const now = () => deps.now?.() ?? new Date();
  return {
    suggest: (spec) => suggestReports(spec),
    async run(spec, def, ctx = {}) {
      if (!deps.records) return { ok: false, errors: [REPORT_COPY.noData] };
      // Validate before reading anything, so a bad definition never touches the records.
      const check = runReport(spec, def, [], { now: now(), timeZone: deps.timeZone });
      if (!check.ok) return check;
      try {
        const rows = await deps.records.list(ctx.appId ?? spec.id, def.sourceCollection);
        return runReport(spec, def, rows, { now: now(), timeZone: deps.timeZone });
      } catch {
        return { ok: false, errors: [REPORT_COPY.noData] };
      }
    },
    explain: (result, ctx) => explainReport(deps.ai, result, ctx),
  };
}
