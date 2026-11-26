/** The report names the failing compile stage and validator codes (docs/13 §6.1, §21; eval 2026-11-25 fix 1). */
import { describe, expect, it } from 'vitest';
import { buildReport } from './metrics';
import { makeResult } from './test-helpers';
import type { CaseResult } from './types';

const built = (id: string, attempts: NonNullable<CaseResult['build']['attempts']>): CaseResult =>
  makeResult({
    id,
    build: {
      stage: 'cloud', ok: attempts.at(-1)?.stage === 'ok', valid: attempts.at(-1)?.stage === 'ok', describeOk: true,
      route: attempts.length > 1 ? 'cloud+repair' : 'cloud', provider: 'firebase', errors: [], warnings: 0, attempts,
    },
  });

describe('compileFailures in the eval report', () => {
  it('counts every pass and tallies the failed ones by stage and by code', () => {
    const r = buildReport({
      mode: 'live', cloudCalls: 4, datasetVersion: '1', platform: 'node-test', promptVersion: 'p', datasetHash: 'h',
      createdAt: new Date('2026-11-25T12:00:00Z'),
      results: [
        built('t15', [
          { pass: 'first', stage: 'structured_output', category: 'OUTPUT_INVALID', errorCode: 'invalid_output', issues: ['IR actions.1.thenFeedback: Too big'], repairs: [] },
          { pass: 'repair', stage: 'validation', category: 'REPAIR_FAILED', errorCode: 'invalid_output', issues: ['UNKNOWN_FIELD screens[1].children[2].field', 'UNKNOWN_FIELD screens[1].children[3].field'], repairs: [] },
        ]),
        built('s07', [{ pass: 'first', stage: 'ok', issues: [], repairs: ['collections.entries.fields.customer: added'] }]),
      ],
    });
    expect(r.compileFailures).toEqual({
      passes: 3,
      byStage: { 'first:structured_output': 1, 'repair:validation': 1 },
      byCode: { IR: 1, UNKNOWN_FIELD: 2 },
    });
  });
});
