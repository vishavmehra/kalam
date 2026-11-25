/** Shared helpers for the evaluation tests (Node only; never imported by app code). */
import { readFileSync } from 'node:fs';
import type { CaseResult, GoldenModalityCase, GoldenSketchCase, GoldenTextCase } from './types';

const goldenPath = (name: string) => new URL(`../golden/${name}`, import.meta.url);

export function loadGolden(): {
  text: GoldenTextCase[];
  sketches: GoldenSketchCase[];
  modalities: GoldenModalityCase[];
  meta: { datasetVersion: string; handDrawnPhotos?: { required: number; present: number; note: string } };
} {
  const read = (n: string) => JSON.parse(readFileSync(goldenPath(n), 'utf8'));
  return {
    meta: read('dataset.json'),
    text: (read('text-requests.json') as { cases: GoldenTextCase[] }).cases,
    sketches: (read('sketches.json') as { cases: GoldenSketchCase[] }).cases,
    modalities: (read('modalities.json') as { cases: GoldenModalityCase[] }).cases,
  };
}

const ok = { ok: true };

/** A passing text case result; override what the test cares about. */
export function makeResult(over: Partial<CaseResult> & { id: string }): CaseResult {
  return {
    dataset: 'text',
    ambiguous: false,
    review: 'needs_human_review',
    classification: {
      complexity: 'simple',
      taskType: 'create_app',
      route: 'template',
      template: 'counter',
      confidence: 0.9,
      multimodal: false,
      requiresCloud: false,
      method: 'deterministic',
    },
    checks: {
      complexity: { ok: true, expected: 'simple', actual: 'simple' },
      taskType: ok,
      route: ok,
      multimodal: ok,
    },
    build: { stage: 'template', ok: true, valid: true, describeOk: true, errors: [], warnings: 0 },
    latencyMs: { classify: 1, build: 5, total: 6 },
    failures: [],
    ...over,
  };
}
