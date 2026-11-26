import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { classifyRequest } from '@/core/classifier';
import type { ComplexityLevel } from '@/core/contracts';
import { summarizeDrawing } from '@/features/drawing/model/summarize';
import { sketchCaseInput } from './evaluate';
import { buildSketchDocument } from './sketch-builder';
import { loadGolden } from './test-helpers';
import type { GoldenSketchCase } from './types';

/**
 * The classifier's sketch thresholds (drawingLevel) were fitted to sketches.json, so its score there is a fitted
 * result. sketches-heldout.json was written afterwards from docs/07 sections 3.1 and 3.2 and was never used to set a
 * threshold. The two are scored apart: only the held-out figure says anything about unseen sketches.
 */
type Case = Pick<GoldenSketchCase, 'id' | 'title' | 'pages'> & { ambiguous?: boolean; expected: { complexity: ComplexityLevel } };
const heldOut = (JSON.parse(readFileSync(new URL('../golden/sketches-heldout.json', import.meta.url), 'utf8')) as { cases: Case[] }).cases;

const RANK: Record<ComplexityLevel, number> = { simple: 0, medium: 1, complex: 2 };
const score = (cases: readonly Case[]) => {
  const rows = cases.map((c) => ({
    id: c.id, ambiguous: !!c.ambiguous, expected: c.expected.complexity,
    got: classifyRequest(sketchCaseInput(summarizeDrawing(buildSketchDocument(c)))).complexity,
  }));
  return { rows, hit: rows.filter((r) => r.got === r.expected).length, misses: rows.filter((r) => r.got !== r.expected) };
};

describe('sketch complexity: fitted vs held-out', () => {
  it('fitted set (in-sample) still scores every case', () => {
    const r = score(loadGolden().sketches);
    expect(r.misses).toEqual([]);
    expect(r.hit).toBe(25);
  });

  it('held-out set: measured 7/12 (7/8 clear cases, 0/4 ambiguous), and every miss is one level too high', () => {
    const r = score(heldOut);
    expect(heldOut).toHaveLength(12);
    expect(new Set(heldOut.map((c) => c.id)).size).toBe(12);
    // Floor, not a target. Do not tune drawingLevel to these cases: that would make them in-sample too.
    expect(r.hit).toBeGreaterThanOrEqual(7);
    // The safe direction: a too-high level sends a simple sketch to cloud vision, never a hard one to a template.
    for (const m of r.misses) expect(RANK[m.got]).toBeGreaterThan(RANK[m.expected]);
  });
});
