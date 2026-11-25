import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ComplexityLevel, NormalizedImage, NormalizedInput, TaskType, TemplateId } from '../contracts';
import { getTemplate } from '../templates';
import { classifyRequest } from './index';

interface Case {
  id: string;
  text: string;
  audioTranscript?: string;
  images?: number;
  drawingPages?: number;
  videoFrames?: number;
  existingTemplate?: TemplateId;
  expected: { complexity: ComplexityLevel; template?: TemplateId; taskType?: TaskType; multimodal?: boolean; lowConfidence?: boolean };
  tags: string[];
}

const fixture = JSON.parse(
  readFileSync(new URL('../../../tests/fixtures/requests/classifier-cases.json', import.meta.url), 'utf8'),
) as { cases: Case[] };

const img = (i: number, source: NormalizedImage['source']): NormalizedImage => ({
  id: `img_${i}`, mimeType: 'image/png', base64: 'iVBORw0KGgo=', width: 800, height: 1200, source,
});

function toInput(c: Case): NormalizedInput {
  const input: NormalizedInput = { text: c.text, modalities: ['text'], images: [] };
  if (c.audioTranscript) { input.audioTranscript = c.audioTranscript; input.modalities.push('audio'); }
  if (c.images) { input.images = Array.from({ length: c.images }, (_, i) => img(i, 'photo')); input.modalities.push('image'); }
  if (c.drawingPages) {
    input.modalities.push('drawing');
    input.drawing = {
      drawingId: 'd1', pageCount: c.drawingPages, texts: [],
      elements: Array.from({ length: c.drawingPages * 6 }, (_, i) => ({ kind: 'rect', page: i % c.drawingPages!, bbox: [0, 0, 10, 10] as [number, number, number, number] })),
      images: Array.from({ length: c.drawingPages }, (_, i) => img(i, 'drawing')),
    };
  }
  if (c.videoFrames) {
    input.modalities.push('video');
    input.video = { frames: Array.from({ length: c.videoFrames }, (_, i) => img(i, 'video_frame')), durationSec: 20 };
  }
  if (c.existingTemplate) {
    const t = getTemplate(c.existingTemplate)!;
    input.existingSpec = t.build(t.defaults, { appId: 'app_existing', now: 0, lang: 'en' });
  }
  return input;
}

describe('classifier benchmark (tests/fixtures/requests/classifier-cases.json)', () => {
  const results = fixture.cases.map((c) => ({ c, r: classifyRequest(toInput(c)) }));

  it('has ≥ 40 labelled cases including Hinglish/Hindi and edge cases', () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(40);
    expect(fixture.cases.filter((c) => c.tags.includes('hinglish') || c.tags.includes('hindi')).length).toBeGreaterThanOrEqual(8);
    expect(fixture.cases.filter((c) => c.tags.includes('edge')).length).toBeGreaterThanOrEqual(3);
  });

  it('complexity-level accuracy ≥ 90%', () => {
    const misses = results.filter(({ c, r }) => r.complexity !== c.expected.complexity);
    const accuracy = 1 - misses.length / results.length;
    // Printed so the benchmark result is visible in CI logs and reports.
    console.log(`classifier level accuracy: ${(accuracy * 100).toFixed(1)}% (${results.length - misses.length}/${results.length})`);
    for (const { c, r } of misses) console.log(`  MISS ${c.id}: expected ${c.expected.complexity}, got ${r.complexity} — ${r.reasons.join(' | ')}`);
    expect(accuracy).toBeGreaterThanOrEqual(0.9);
  });

  it('template, task type, multimodal and low-confidence labels', () => {
    const wrong: string[] = [];
    for (const { c, r } of results) {
      const e = c.expected;
      if (e.template && r.matchingTemplate !== e.template) wrong.push(`${c.id}: template ${r.matchingTemplate} ≠ ${e.template}`);
      if (!e.template && r.matchingTemplate && e.complexity !== 'simple') wrong.push(`${c.id}: unexpected template ${r.matchingTemplate}`);
      if (e.taskType && r.taskType !== e.taskType) wrong.push(`${c.id}: taskType ${r.taskType} ≠ ${e.taskType}`);
      if (e.multimodal !== undefined && r.requiresMultimodalReasoning !== e.multimodal) wrong.push(`${c.id}: multimodal`);
      if (e.lowConfidence && r.confidence >= 0.5) wrong.push(`${c.id}: confidence ${r.confidence} should be low`);
    }
    const labelled = results.filter(({ c }) => c.expected.template || c.expected.taskType || c.expected.lowConfidence).length;
    console.log(`classifier secondary-label accuracy: ${labelled - wrong.length}/${labelled}`);
    for (const w of wrong) console.log(`  MISS ${w}`);
    expect(wrong.length / labelled).toBeLessThanOrEqual(0.1);
  });
});

describe('classifyRequest behaviour', () => {
  const text = (t: string): NormalizedInput => ({ text: t, modalities: ['text'], images: [] });

  it('docs/07 §3.4: four-operation calculator is simple, template, no cloud', () => {
    const r = classifyRequest(text('Make a calculator with addition, subtraction, multiplication and division'));
    expect(r).toMatchObject({
      taskType: 'create_app', complexity: 'simple', matchingTemplate: 'calculator', requiresCloudReasoning: false,
      requiresMultimodalReasoning: false, method: 'deterministic',
    });
    expect(r.confidence).toBeGreaterThanOrEqual(0.8);
    expect(r.estimatedScreens).toBe(1);
    expect(r.reasons.join(' ')).toMatch(/Calculator template/);
  });

  it('complex requests require cloud and never carry a template', () => {
    const r = classifyRequest(text('CRM with leads, deals, customers, follow-up workflow and sales dashboards'));
    expect(r.complexity).toBe('complex');
    expect(r.requiresCloudReasoning).toBe(true);
    expect(r.matchingTemplate).toBeUndefined();
    expect(r.estimatedCollections).toBeGreaterThan(1);
  });

  it('vague text fails safely: low confidence, no cloud, explains why', () => {
    const r = classifyRequest(text('app banao'));
    expect(r.confidence).toBeLessThan(0.5);
    expect(r.requiresCloudReasoning).toBe(false);
    expect(r.reasons[0]).toMatch(/vague|clearly/);
  });

  it('sketches always go to cloud vision, even with a template word', () => {
    const r = classifyRequest({ ...text('make this calculator'), images: [img(0, 'photo')], modalities: ['text', 'image'] });
    expect(r.taskType).toBe('interpret_sketch');
    expect(r.requiresCloudReasoning).toBe(true);
    expect(r.matchingTemplate).toBeUndefined();
  });

  it('simple request without a template still needs generation (cloud), honestly flagged', () => {
    const r = classifyRequest(text('Track my weight every morning'));
    expect(r.complexity).toBe('simple');
    expect(r.matchingTemplate).toBeUndefined();
    expect(r.requiresCloudReasoning).toBe(true);
  });

  it('is cheap: well under 2 ms per request (a model call takes ~1 s)', () => {
    const run = () => classifyRequest(text('roz ka kharcha likhne ka app chahiye, rupaye mein'));
    for (let i = 0; i < 50; i += 1) run(); // warm the JIT first
    // Best of 5 batches: a shared CI/dev machine can stall any single batch; the fastest one shows the real cost.
    const batches = Array.from({ length: 5 }, () => {
      const start = performance.now();
      for (let i = 0; i < 100; i += 1) run();
      return (performance.now() - start) / 100;
    });
    expect(Math.min(...batches)).toBeLessThan(2);
  });
});
