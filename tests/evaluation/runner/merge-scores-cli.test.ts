import { describe, expect, it } from 'vitest';
import { markReviewer, relabelForReviewer, reviewerTypeOf } from '../../../scripts/eval-merge-scores.mjs';
import { buildReport } from './metrics';
import { formatFinal, mergeScores } from './scores';
import { makeResult } from './test-helpers';
import type { HumanScoresFile } from './types';

function final(over: Partial<HumanScoresFile> = {}) {
  const a = makeResult({ id: 'a' });
  a.aiPreScore = { score: 'correct', reasons: ['ok'], confidence: 0.9 };
  const r = buildReport({
    mode: 'live',
    datasetVersion: '1',
    results: [a],
    platform: 'test',
    promptVersion: 'p',
    datasetHash: 'h',
    cloudCalls: 0,
    createdAt: new Date('2026-11-25T00:00:00Z'),
  });
  const file: HumanScoresFile = {
    schema: 'kalam-human-scores/1',
    evaluationId: r.evaluationId,
    exportedAt: '2026-11-25T01:00:00Z',
    scores: [{ id: 'a', score: 'partly' }],
    ...over,
  };
  return { file, merged: mergeScores(r, file) };
}

describe('eval-merge-scores reviewer type', () => {
  it('defaults to human and leaves the person-worded summary alone', () => {
    const { file, merged } = final();
    expect(reviewerTypeOf(file)).toBe('human');
    const marked = markReviewer(merged, 'human');
    expect(marked.reviewerType).toBe('human');
    expect(marked.caveats).toEqual(merged.caveats);
    const text = formatFinal(marked);
    expect(relabelForReviewer(text, 'human')).toBe(text);
  });

  it('never presents AI-delegated scores as a person', () => {
    const over = { reviewer: 'AI reviewer (Claude)', reviewerType: 'ai-delegated' } as Partial<HumanScoresFile>;
    const { file, merged } = final(over);
    const type = reviewerTypeOf(file);
    expect(type).toBe('ai-delegated');
    // The wording relabelForReviewer rewrites must still exist, or the relabel silently does nothing.
    expect(formatFinal(merged)).toMatch(/person scored[\s\S]*against the person[\s\S]*Human scores judge/);
    const marked = markReviewer(merged, type);
    expect(marked.reviewerType).toBe('ai-delegated');
    expect(marked.caveats[0]).toContain('not from a person');
    const text = relabelForReviewer(formatFinal(marked), type);
    expect(text).not.toMatch(/person scored|against the person|Human scores|counted as a human score/);
    expect(text).toContain('reviewer scored 1');
  });
});
