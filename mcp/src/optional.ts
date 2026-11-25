/**
 * Modules other packages are still building: src/core/history (R2), src/core/formula-assist (R3) and
 * src/core/reports (R1). When one is missing, the build (build.mjs) and the tests (vitest.config.ts)
 * swap in an empty module, and the tools that need it say it is not in this build yet.
 * Every call is wrapped: a module that throws or changes shape gives a plain error, never a crash.
 */
// @ts-ignore R2 builds src/core/history. Until it lands the build swaps in an empty module.
import * as history from '@/core/history';
// @ts-ignore R3 builds src/core/formula-assist.
import * as formulaAssist from '@/core/formula-assist';
// @ts-ignore R1 builds src/core/reports.
import * as reports from '@/core/reports';

import type { KalamRecord } from '@/core/contracts';
import type { KalamSpec } from '@/core/spec';

type AnyFn = (...args: unknown[]) => unknown;

function pick(mod: unknown, name: string): AnyFn | undefined {
  const f = (mod as Record<string, unknown> | undefined)?.[name];
  return typeof f === 'function' ? (f as AnyFn) : undefined;
}

export const optional = {
  /** R2: describeSpecChanges(before, after): ChangeEntry[]. */
  describeSpecChanges: pick(history, 'describeSpecChanges'),
  /** R2: summarizeChanges(entries): string. */
  summarizeChanges: pick(history, 'summarizeChanges'),
  /** R3: explainFormula(formula, spec): string. */
  explainFormula: pick(formulaAssist, 'explainFormula'),
  /** R1: suggestReports(spec) lists report definitions; computeReport(definition, input) computes one. */
  suggestReports: pick(reports, 'suggestReports'),
  computeReport: pick(reports, 'computeReport'),
};

export interface ReportInput {
  spec: KalamSpec;
  collectionId: string;
  records: KalamRecord[];
  definition?: Record<string, unknown>;
  now: Date;
}

/**
 * The one place that knows R1's call shape. ponytail: written before R1 landed, so the argument
 * order is an assumption; align this function with src/core/reports when it lands.
 * Without a definition, every suggested report for the collection is computed.
 */
export function runReport({ spec, collectionId, records, definition, now }: ReportInput): unknown {
  const compute = optional.computeReport;
  if (!compute) throw new Error('reports missing');
  const input = { spec, records, now };
  if (definition) return { definition, result: compute(definition, input) };
  const suggested = optional.suggestReports?.(spec, { collectionId, now });
  const list = (Array.isArray(suggested) ? suggested : []).slice(0, 12);
  return { reports: list.map((d) => ({ definition: d, result: compute(d, input) })) };
}

export const NOT_IN_BUILD = (what: string) =>
  `${what} is not in this build of the Kalam MCP server yet. Rebuild it after updating Kalam.`;
